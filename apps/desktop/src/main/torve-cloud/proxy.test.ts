import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import test from 'node:test';
import {
  buildChatRequestFromResponses,
  startTorveCloudProxy,
  stopTorveCloudProxy,
  torveCloudProxyStatus,
} from './proxy.js';
import type { TorveModel } from './models.js';

type UpstreamHandler = (req: IncomingMessage, bodyText: string, res: ServerResponse) => void | Promise<void>;

async function readStreamText(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseSseEvents(raw: string): Array<{ event: string | null; data: string }> {
  const blocks = raw.replace(/\r\n/g, '\n').split('\n\n').filter((b) => b.trim().length > 0);
  const events: Array<{ event: string | null; data: string }> = [];
  for (const block of blocks) {
    let event: string | null = null;
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    }
    if (dataLines.length > 0) events.push({ event, data: dataLines.join('\n') });
  }
  return events;
}

async function withProxy(
  models: TorveModel[],
  upstreamHandler: UpstreamHandler,
  fn: (baseUrl: string) => Promise<void>,
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
  assert.ok(upstreamAddr && typeof upstreamAddr === 'object');
  process.env['TORVE_CLOUD_API_URL'] = `http://127.0.0.1:${upstreamAddr.port}`;

  try {
    await startTorveCloudProxy(0, {
      getApiKey: () => 'torve_test_api_key_123456',
      getModels: async () => models,
      resolveModel: async (_appId, requested, fallback) => {
        if (!requested || requested === 'torve' || requested === 'auto') return fallback;
        return requested;
      },
      recordUsage: false,
      debugLog: false,
    });
    const status = torveCloudProxyStatus();
    assert.equal(status.running, true);
    await fn(`http://127.0.0.1:${status.port}`);
  } finally {
    await stopTorveCloudProxy();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    if (prevApiUrl === undefined) delete process.env['TORVE_CLOUD_API_URL'];
    else process.env['TORVE_CLOUD_API_URL'] = prevApiUrl;
  }
}

test('GET /v1/models enforces 1M context_window and max_input_tokens floor and passes through codex catalog', async () => {
  const models: TorveModel[] = [
    { id: 'small-model', context_window: 128_000, max_output_tokens: 65_536 },
    { id: 'omitted-context-model' },
    { id: 'giant-model', context_window: 2_000_000, max_input_tokens: 2_000_000 },
  ];

  await withProxy(models, (_req, _body, res) => {
    res.writeHead(404);
    res.end();
  }, async (baseUrl) => {
    const resp = await fetch(`${baseUrl}/v1/models`);
    assert.equal(resp.status, 200);
    const json = await resp.json() as { object: string; data: Array<Record<string, unknown>> };
    assert.equal(json.object, 'list');
    assert.equal(json.data.length, 3);
    assert.equal(json.data[0]!['context_window'], 1_000_000);
    assert.equal(json.data[0]!['max_input_tokens'], 1_000_000);
    assert.equal(json.data[0]!['max_output_tokens'], 65_536);
    assert.equal(json.data[1]!['context_window'], 1_000_000);
    assert.equal(json.data[1]!['max_input_tokens'], 1_000_000);
    assert.equal(json.data[2]!['context_window'], 2_000_000);
    assert.equal(json.data[2]!['max_input_tokens'], 2_000_000);

    const codexResp = await fetch(`${baseUrl}/app/codex/v1/models?client_version=0.171.0`);
    assert.equal(codexResp.status, 200);
    const codexJson = await codexResp.json() as { models: Array<Record<string, unknown>> };
    const smallEntry = codexJson.models.find((m) => m['slug'] === 'small-model');
    assert.ok(smallEntry);
    assert.equal(smallEntry['context_window'], 1_000_000);
    assert.equal(smallEntry['max_context_window'], 1_000_000);
  });
});

test('buildChatRequestFromResponses preserves parallel_tool_calls, history, tools, and never injects final_answer', () => {
  const chatReq = buildChatRequestFromResponses({
    model: 'gpt-5.4',
    instructions: 'Be concise.',
    stream: true,
    parallel_tool_calls: true,
    max_output_tokens: 131_072,
    reasoning: { effort: 'high' },
    input: [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Check files' }] },
      { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'exec_command', arguments: '{"cmd":"ls"}' },
      { type: 'function_call', id: 'fc_2', call_id: 'call_2', name: 'read_file', arguments: '{"path":"a.ts"}' },
      { type: 'function_call_output', call_id: 'call_1', output: 'a.ts' },
      { type: 'function_call_output', call_id: 'call_2', output: { lines: 10 } },
    ],
    tools: [
      { type: 'function', name: 'exec_command', description: 'Run shell', parameters: { type: 'object', properties: { cmd: { type: 'string' } } }, strict: false },
      { type: 'custom', name: 'apply_patch', description: 'Patch code' },
      { type: 'web_search' },
    ],
    tool_choice: { type: 'function', name: 'exec_command' },
    prompt_cache_key: 'cache-1',
  }, 'gpt-5.4');

  assert.equal(chatReq['model'], 'gpt-5.4');
  assert.equal(chatReq['stream'], true);
  assert.deepEqual(chatReq['stream_options'], { include_usage: true });
  assert.equal(chatReq['parallel_tool_calls'], true);
  assert.equal(chatReq['max_tokens'], 131_072);
  assert.equal(chatReq['reasoning_effort'], 'high');
  assert.equal(chatReq['prompt_cache_key'], 'cache-1');
  assert.deepEqual(chatReq['tool_choice'], { type: 'function', function: { name: 'exec_command' } });

  const tools = chatReq['tools'] as Array<Record<string, unknown>>;
  assert.equal(tools.length, 3);
  assert.equal(tools.some((t) => ((t['function'] as Record<string, unknown> | undefined)?.['name']) === 'final_answer'), false);

  const messages = chatReq['messages'] as Array<Record<string, unknown>>;
  assert.equal(messages.length, 5);
  assert.deepEqual(messages[0], { role: 'system', content: 'Be concise.' });
  assert.deepEqual(messages[1], { role: 'user', content: 'Check files' });
  const assistantTools = messages[2]!['tool_calls'] as Array<Record<string, unknown>>;
  assert.equal(messages[2]!['role'], 'assistant');
  assert.equal(assistantTools.length, 2);
  assert.equal(assistantTools[0]!['id'], 'call_1');
  assert.equal(assistantTools[1]!['id'], 'call_2');
  assert.deepEqual(messages[3], { role: 'tool', tool_call_id: 'call_1', content: 'a.ts' });
  assert.deepEqual(messages[4], { role: 'tool', tool_call_id: 'call_2', content: '{"lines":10}' });
});

test('POST /app/codex/v1/responses streams unbuffered SSE tool calls before upstream closes', async () => {
  let capturedUpstreamBody: Record<string, unknown> | null = null;
  let releaseSecondChunk: (() => void) | null = null;
  const secondChunkGate = new Promise<void>((resolve) => { releaseSecondChunk = resolve; });

  await withProxy([{ id: 'gpt-5.4' }], async (req, bodyText, res) => {
    assert.equal(req.url, '/v1/chat/completions');
    capturedUpstreamBody = JSON.parse(bodyText) as Record<string, unknown>;
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' });
    res.flushHeaders?.();
    res.write(`data: ${JSON.stringify({
      id: 'chatcmpl_1',
      model: 'gpt-5.4',
      choices: [{
        index: 0,
        delta: {
          role: 'assistant',
          tool_calls: [{ index: 0, id: 'call_exec_1', type: 'function', function: { name: 'exec_command', arguments: '{"cmd":' } }],
        },
        finish_reason: null,
      }],
    })}\n\n`);

    await secondChunkGate;

    res.write(`data: ${JSON.stringify({
      id: 'chatcmpl_1',
      model: 'gpt-5.4',
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{ index: 0, function: { arguments: '"pwd"}' } }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 42, completion_tokens: 13, total_tokens: 55 },
    })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }, async (baseUrl) => {
    const resp = await fetch(`${baseUrl}/app/codex/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5.4',
        instructions: 'Codex system prompt',
        stream: true,
        parallel_tool_calls: true,
        input: [
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Where am I?' }] },
          { type: 'function_call', id: 'fc_prev', call_id: 'call_prev', name: 'list_dir', arguments: '{}' },
          { type: 'function_call_output', call_id: 'call_prev', output: 'src/' },
        ],
        tools: [
          { type: 'function', name: 'exec_command', description: 'Run command', parameters: { type: 'object', properties: { cmd: { type: 'string' } } } },
        ],
      }),
    });

    assert.equal(resp.status, 200);
    assert.equal(resp.headers.get('x-accel-buffering'), 'no');
    assert.ok(resp.body);

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let earlyText = '';
    // Read until the first tool_call item & delta arrive BEFORE releasing the second upstream chunk!
    while (!earlyText.includes('response.function_call_arguments.delta')) {
      const next = await reader.read();
      assert.equal(next.done, false, 'Stream closed before early unbuffered tool call delta arrived');
      earlyText += decoder.decode(next.value, { stream: true });
    }
    assert.ok(earlyText.includes('event: response.created'));
    assert.ok(earlyText.includes('event: response.in_progress'));
    assert.ok(earlyText.includes('event: response.output_item.added'));
    assert.ok(earlyText.includes('"name":"exec_command"'));
    assert.ok(earlyText.includes('{"cmd":') || earlyText.includes('{\\"cmd\\":'));

    // Now release the remainder of the upstream stream.
    releaseSecondChunk!();

    let restText = '';
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      restText += decoder.decode(next.value, { stream: true });
    }
    const fullText = earlyText + restText + decoder.decode();
    const events = parseSseEvents(fullText);
    const eventNames = events.map((e) => e.event);

    assert.deepEqual(eventNames.slice(0, 4), [
      'response.created',
      'response.in_progress',
      'response.output_item.added',
      'response.function_call_arguments.delta',
    ]);
    assert.ok(eventNames.includes('response.function_call_arguments.done'));
    assert.ok(eventNames.includes('response.output_item.done'));
    assert.ok(eventNames.includes('response.completed'));
    assert.equal(events[events.length - 1]!.data, '[DONE]');

    const completed = JSON.parse(events.find((e) => e.event === 'response.completed')!.data) as {
      sequence_number: number;
      response: {
        status: string;
        output_text: string;
        output: Array<Record<string, unknown>>;
        usage: { input_tokens: number; output_tokens: number; total_tokens: number };
      };
    };
    assert.equal(completed.response.status, 'completed');
    assert.equal(completed.response.output_text, '');
    assert.equal(completed.response.output.length, 1);
    assert.equal(completed.response.output[0]!['type'], 'function_call');
    assert.equal(completed.response.output[0]!['call_id'], 'call_exec_1');
    assert.equal(completed.response.output[0]!['name'], 'exec_command');
    assert.equal(completed.response.output[0]!['arguments'], '{"cmd":"pwd"}');
    assert.deepEqual(completed.response.usage, { input_tokens: 42, output_tokens: 13, total_tokens: 55 });

    // Verify no synthetic final_answer tool was sent upstream.
    const sentTools = capturedUpstreamBody!['tools'] as Array<{ function: { name: string } }>;
    assert.deepEqual(sentTools.map((t) => t.function.name), ['exec_command']);
    assert.equal(capturedUpstreamBody!['parallel_tool_calls'], true);
  });
});

test('POST /app/codex/v1/responses/compact supports upstream passthrough and chat fallback', async () => {
  // 1) Native upstream passthrough
  await withProxy([{ id: 'gpt-5.4' }], (req, _body, res) => {
    assert.equal(req.url, '/v1/responses/compact');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'cmp_native_1',
      object: 'response.compaction',
      created_at: 1700000000,
      output: [{
        id: 'msg_native_1',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'Native compacted summary', annotations: [] }],
      }],
      usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150 },
    }));
  }, async (baseUrl) => {
    const resp = await fetch(`${baseUrl}/app/codex/v1/responses/compact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.4', input: [{ type: 'message', role: 'user', content: 'Hello' }] }),
    });
    assert.equal(resp.status, 200);
    const json = await resp.json() as { id: string; object: string; output: Array<{ content: Array<{ text: string }> }> };
    assert.equal(json.id, 'cmp_native_1');
    assert.equal(json.object, 'response.compaction');
    assert.equal(json.output[0]!.content[0]!.text, 'Native compacted summary');
  });

  // 2) Fallback via /v1/chat/completions when /v1/responses/compact returns 404
  const seenUrls: string[] = [];
  await withProxy([{ id: 'gpt-5.4' }], (req, bodyText, res) => {
    seenUrls.push(req.url ?? '');
    if (req.url === '/v1/responses/compact') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Not found' } }));
      return;
    }
    assert.equal(req.url, '/v1/chat/completions');
    const body = JSON.parse(bodyText) as { stream: boolean; model: string; messages: Array<{ content: string }> };
    assert.equal(body.stream, false);
    assert.equal(body.model, 'gpt-5.4');
    assert.ok(body.messages[1]!.content.includes('proxy.ts'));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl_cmp',
      model: 'gpt-5.4',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Compacted: edited proxy.ts and verified build.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 200, completion_tokens: 25, total_tokens: 225 },
    }));
  }, async (baseUrl) => {
    const resp = await fetch(`${baseUrl}/app/codex/v1/responses/compact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'torve',
        instructions: 'Keep file paths.',
        input: [
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Update proxy.ts' }] },
          { type: 'function_call', call_id: 'call_1', name: 'edit_file', arguments: '{"path":"proxy.ts"}' },
          { type: 'function_call_output', call_id: 'call_1', output: 'ok' },
        ],
      }),
    });
    assert.equal(resp.status, 200);
    assert.deepEqual(seenUrls, ['/v1/responses/compact', '/v1/chat/completions']);
    const json = await resp.json() as {
      id: string;
      object: string;
      created_at: number;
      output: Array<{ id: string; type: string; role: string; status: string; content: Array<{ type: string; text: string }> }>;
      usage: { input_tokens: number; output_tokens: number; total_tokens: number };
    };
    assert.ok(json.id.startsWith('cmp_'));
    assert.equal(json.object, 'response.compaction');
    assert.equal(typeof json.created_at, 'number');
    assert.equal(json.output[0]!.type, 'message');
    assert.equal(json.output[0]!.role, 'assistant');
    assert.equal(json.output[0]!.status, 'completed');
    assert.equal(json.output[0]!.content[0]!.type, 'output_text');
    assert.equal(json.output[0]!.content[0]!.text, 'Compacted: edited proxy.ts and verified build.');
    assert.deepEqual(json.usage, { input_tokens: 200, output_tokens: 25, total_tokens: 225 });
  });
});

test('POST /v1/messages streams thinking, text, and tool_use blocks unbuffered', async () => {
  await withProxy([{ id: 'claude-sonnet-4' }], (_req, _body, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    const chunks = [
      { id: 'chat_anth_1', model: 'claude-sonnet-4', choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: 'Planning...' } }] },
      { id: 'chat_anth_1', model: 'claude-sonnet-4', choices: [{ index: 0, delta: { content: 'Running tool.' } }] },
      { id: 'chat_anth_1', model: 'claude-sonnet-4', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'toolu_1', type: 'function', function: { name: 'read_file', arguments: '{"path":' } }] } }] },
      { id: 'chat_anth_1', model: 'claude-sonnet-4', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"proxy.ts"}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 80, completion_tokens: 24 } },
    ];
    for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }, async (baseUrl) => {
    const resp = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4',
        max_tokens: 4096,
        stream: true,
        messages: [{ role: 'user', content: 'Read proxy.ts' }],
        tools: [{ name: 'read_file', input_schema: { type: 'object', properties: { path: { type: 'string' } } } }],
      }),
    });
    assert.equal(resp.status, 200);
    assert.equal(resp.headers.get('x-accel-buffering'), 'no');
    const raw = await resp.text();
    const events = parseSseEvents(raw);
    const types = events.map((e) => e.event);
    assert.deepEqual(types, [
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_stop',
      'content_block_start',
      'content_block_delta',
      'content_block_stop',
      'content_block_start',
      'content_block_delta',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ]);
    const payloads = events.map((e) => JSON.parse(e.data) as Record<string, unknown>);
    assert.equal((payloads[1]!['content_block'] as Record<string, unknown>)['type'], 'thinking');
    assert.equal((payloads[2]!['delta'] as Record<string, unknown>)['type'], 'thinking_delta');
    assert.equal((payloads[4]!['content_block'] as Record<string, unknown>)['type'], 'text');
    assert.equal((payloads[5]!['delta'] as Record<string, unknown>)['type'], 'text_delta');
    assert.equal((payloads[7]!['content_block'] as Record<string, unknown>)['type'], 'tool_use');
    assert.equal((payloads[8]!['delta'] as Record<string, unknown>)['type'], 'input_json_delta');
    assert.equal((payloads[11]!['delta'] as Record<string, unknown>)['stop_reason'], 'tool_use');
    assert.equal((payloads[11]!['usage'] as Record<string, unknown>)['output_tokens'], 24);
  });
});

test('POST /v1/chat/completions streams tool_calls, usage, and [DONE] unbuffered', async () => {
  await withProxy([{ id: 'gpt-4o' }], (_req, _body, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ id: 'chat_1', model: 'gpt-4o', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'ping', arguments: '{}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\n`);
    res.end();
  }, async (baseUrl) => {
    const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(resp.status, 200);
    assert.equal(resp.headers.get('x-accel-buffering'), 'no');
    const raw = await resp.text();
    const events = parseSseEvents(raw);
    assert.equal(events.length, 2);
    const first = JSON.parse(events[0]!.data) as { choices: Array<{ delta: { tool_calls: Array<{ id: string }> } }>; usage: { prompt_tokens: number } };
    assert.equal(first.choices[0]!.delta.tool_calls[0]!.id, 'call_1');
    assert.equal(first.usage.prompt_tokens, 10);
    assert.equal(events[1]!.data, '[DONE]');
  });
});

test('POST /v1beta/...:streamGenerateContent handles CRLF SSE, thought, text, tool_calls, and multi-turn history', async () => {
  let seenMessages: Array<Record<string, unknown>> = [];
  await withProxy([{ id: 'gemini-2.5-pro' }], (_req, bodyText, res) => {
    const parsedBody = JSON.parse(bodyText) as { messages: Array<Record<string, unknown>> };
    seenMessages = parsedBody.messages;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { reasoning_content: 'Thinking step' } }] })}\r\n\r\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Answer text' } }] })}\r\n\r\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_g1', function: { name: 'lookup', arguments: '{"q":' } }] } }] })}\r\n\r\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"torve"}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 30, completion_tokens: 12 } })}\r\n\r\n`);
    res.write('data: [DONE]\r\n\r\n');
    res.end();
  }, async (baseUrl) => {
    const resp = await fetch(`${baseUrl}/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: 'Be helpful.' }] },
        contents: [
          { role: 'user', parts: [{ text: 'Check weather' }] },
          { role: 'model', parts: [{ functionCall: { name: 'get_weather', args: { city: 'NYC' } } }] },
          { role: 'user', parts: [{ functionResponse: { name: 'get_weather', response: { temp: 72 } } }] },
        ],
        tools: [{ functionDeclarations: [{ name: 'lookup', parameters: { type: 'object', properties: { q: { type: 'string' } } } }] }],
      }),
    });
    assert.equal(resp.status, 200);
    assert.equal(resp.headers.get('x-accel-buffering'), 'no');
    assert.equal(seenMessages.length, 4);
    assert.deepEqual(seenMessages[0], { role: 'system', content: 'Be helpful.' });
    assert.deepEqual(seenMessages[1], { role: 'user', content: 'Check weather' });
    const assistantMsg = seenMessages[2]!;
    assert.equal(assistantMsg['role'], 'assistant');
    const tcId = ((assistantMsg['tool_calls'] as Array<Record<string, unknown>>)[0]!)['id'];
    assert.deepEqual(seenMessages[3], { role: 'tool', tool_call_id: tcId, content: '{"temp":72}' });

    const events = parseSseEvents(await resp.text()).map((e) => JSON.parse(e.data) as {
      candidates: Array<{ content: { parts: Array<Record<string, unknown>> }; finishReason?: string }>;
      usageMetadata: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number };
    });
    assert.equal(events.length, 3);
    assert.deepEqual(events[0]!.candidates[0]!.content.parts[0], { thought: true, text: 'Thinking step' });
    assert.deepEqual(events[1]!.candidates[0]!.content.parts[0], { text: 'Answer text' });
    assert.deepEqual(events[2]!.candidates[0]!.content.parts[0], { functionCall: { name: 'lookup', args: { q: 'torve' } } });
    assert.deepEqual(events[2]!.usageMetadata, { promptTokenCount: 30, candidatesTokenCount: 12, totalTokenCount: 42 });
  });
});

test('proxy accepts payloads larger than 32 MiB within the 64 MiB body limit', async () => {
  let receivedBytes = 0;
  await withProxy([{ id: 'gpt-5.4' }], (_req, bodyText, res) => {
    receivedBytes = Buffer.byteLength(bodyText);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl_big',
      model: 'gpt-5.4',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 1 },
    }));
  }, async (baseUrl) => {
    const bigText = 'x'.repeat(34 * 1024 * 1024);
    const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.4', stream: false, messages: [{ role: 'user', content: bigText }] }),
    });
    assert.equal(resp.status, 200);
    assert.ok(receivedBytes > 33 * 1024 * 1024);
  });
});
