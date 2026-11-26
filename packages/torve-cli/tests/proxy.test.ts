import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildChatRequestFromResponses,
  convertResponsesToolsToChat,
  getProxyStatus,
  startProxyServer,
  stopProxyServer,
} from '../src/proxy.js';
import type { TorveModel } from '../src/types.js';

type UpstreamHandler = (req: IncomingMessage, bodyText: string, res: ServerResponse) => void | Promise<void>;

async function readStreamText(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function withProxy(
  models: TorveModel[],
  upstreamHandler: UpstreamHandler,
  fn: (baseUrl: string) => Promise<void>,
  extraOptions: { headerTimeoutMs?: number; streamIdleTimeoutMs?: number } = {},
): Promise<void> {
  const prevApiUrl = process.env['TORVE_CLOUD_API_URL'];
  const upstream = createServer((req, res) => {
    void (async () => {
      const bodyText = await readStreamText(req);
      await upstreamHandler(req, bodyText, res);
    })();
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamAddr = upstream.address();
  if (!upstreamAddr || typeof upstreamAddr !== 'object') throw new Error('Failed to bind mock upstream');
  process.env['TORVE_CLOUD_API_URL'] = `http://127.0.0.1:${upstreamAddr.port}`;

  try {
    const port = await startProxyServer(0, {
      getApiKey: () => 'torve_test_api_key_123456',
      getModels: async () => models,
      resolveModel: async (_appId, requested, fallback) => (!requested || requested === 'torve' || requested === 'auto' ? fallback : requested),
      recordUsage: false,
      ...extraOptions,
    });
    expect(getProxyStatus().running).toBe(true);
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await stopProxyServer();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    if (prevApiUrl === undefined) delete process.env['TORVE_CLOUD_API_URL'];
    else process.env['TORVE_CLOUD_API_URL'] = prevApiUrl;
  }
}

afterEach(async () => {
  await stopProxyServer();
});

describe('standalone proxy server', () => {
  it('normalizes Codex namespace and custom tools to function tools with 32K output floor', () => {
    const tools = convertResponsesToolsToChat([
      { type: 'function', name: 'exec_command', description: 'Run command', parameters: { type: 'object', properties: { cmd: { type: 'string' } } } },
      { type: 'custom', name: 'apply_patch', description: 'Apply diff' },
      {
        type: 'namespace',
        name: 'fs',
        tools: [
          { type: 'function', name: 'read_file', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
          { type: 'custom', name: 'write_patch' },
        ],
      },
    ]);

    expect(tools).toHaveLength(4);
    expect(tools!.every((t) => t['type'] === 'function')).toBe(true);
    expect(tools!.map((t) => (t['function'] as Record<string, unknown>)['name'])).toEqual([
      'exec_command',
      'apply_patch',
      'read_file',
      'write_patch',
    ]);

    const chatReq = buildChatRequestFromResponses({
      model: 'gpt-5.4',
      max_output_tokens: 4096,
      reasoning: { effort: 'high' },
      input: 'hello',
      tools: [{ type: 'custom', name: 'apply_patch' }],
    }, 'gpt-5.4');
    expect(chatReq['max_tokens']).toBe(32_768);
    expect(chatReq['reasoning_effort']).toBe('high');
  });

  it('serves /_torve/health and /v1/models with 1M context and 32K output floors', async () => {
    await withProxy([{ id: 'small-model', context_window: 128_000, max_output_tokens: 4096 }], (_req, _body, res) => {
      res.writeHead(404).end();
    }, async (baseUrl) => {
      const health = await fetch(`${baseUrl}/_torve/health`);
      expect(health.status).toBe(200);
      const hJson = await health.json() as { ok: boolean; service: string };
      expect(hJson.ok).toBe(true);
      expect(hJson.service).toBe('torve-cli-proxy');

      const modelsResp = await fetch(`${baseUrl}/v1/models`);
      expect(modelsResp.status).toBe(200);
      const mJson = await modelsResp.json() as { data: Array<Record<string, unknown>> };
      expect(mJson.data[0]!['context_window']).toBe(1_000_000);
      expect(mJson.data[0]!['max_input_tokens']).toBe(1_000_000);
      expect(mJson.data[0]!['max_output_tokens']).toBe(32_768);
    });
  });

  it('translates /v1/responses, /v1/messages, and /v1beta cleanly', async () => {
    await withProxy([{ id: 'gpt-5.4' }], (_req, bodyText, res) => {
      const body = JSON.parse(bodyText) as { max_tokens: number; tools?: Array<{ function: { name: string } }> };
      expect(body.max_tokens).toBe(32_768);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chat_1',
        model: 'gpt-5.4',
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      }));
    }, async (baseUrl) => {
      const respRes = await fetch(`${baseUrl}/app/codex/v1/responses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'torve',
          input: 'hi',
          tools: [{ type: 'namespace', name: 'ns', tools: [{ type: 'custom', name: 'patch' }] }],
        }),
      });
      expect(respRes.status).toBe(200);
      const respJson = await respRes.json() as { object: string; output_text: string };
      expect(respJson.object).toBe('response');
      expect(respJson.output_text).toBe('ok');

      const anthRes = await fetch(`${baseUrl}/app/claude-code/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'torve', max_tokens: 1024, messages: [{ role: 'user', content: 'hi' }] }),
      });
      expect(anthRes.status).toBe(200);
      const anthJson = await anthRes.json() as { type: string; content: Array<{ text: string }> };
      expect(anthJson.type).toBe('message');
      expect(anthJson.content[0]!.text).toBe('ok');

      const gemRes = await fetch(`${baseUrl}/v1beta/models/torve:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }),
      });
      expect(gemRes.status).toBe(200);
      const gemJson = await gemRes.json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
      expect(gemJson.candidates[0]!.content.parts[0]!.text).toBe('ok');
    });
  });

  it('resets per-chunk SSE idle timeout on active streams and aborts stalled streams', async () => {
    await withProxy([{ id: 'gpt-5.4' }], (_req, _body, res) => {
      void (async () => {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.flushHeaders?.();
        for (let i = 0; i < 4; i++) {
          await new Promise((r) => setTimeout(r, 55));
          res.write(`data: ${JSON.stringify({ id: 'c1', choices: [{ index: 0, delta: { content: `k${i}` } }] })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
      })();
    }, async (baseUrl) => {
      const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-5.4', stream: true, messages: [{ role: 'user', content: 'go' }] }),
      });
      expect(resp.status).toBe(200);
      const text = await resp.text();
      expect(text).toContain('k3');
      expect(text).not.toContain('timed out');
    }, { headerTimeoutMs: 130, streamIdleTimeoutMs: 130 });
  });
});
