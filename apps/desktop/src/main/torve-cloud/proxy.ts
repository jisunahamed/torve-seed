/**
 * Loopback-only direct Torve Cloud adapter. It deliberately has no TLS MITM
 * role: open-config clients point here directly, while closed/pinned apps keep
 * using their documented connection path or show an unsupported status.
 */
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  createStreamingAdapter,
  detectRequestServiceApiProtocol,
  transformRequest,
  transformResponse,
  type SerializedHttpRequest,
  type SerializedHttpResponse,
  type ServiceApiProtocol,
} from '@torveai/api-adapter';
import { getTorveCloudApiKey } from '../ipc/torve-account.js';
import { refreshTorveCloudModels, torveCloudModelsStatus, torveCloudUpstream } from './models.js';
import { resolveDirectCloudModel } from './overrides.js';

const DEFAULT_PORT = Number(process.env['TORVE_CLOUD_PROXY_PORT']) || 8378;
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const HOP_BY_HOP = new Set(['connection', 'host', 'content-length', 'transfer-encoding', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'upgrade']);

export type DirectCloudProtocol = 'openai-chat' | 'openai-responses' | 'anthropic' | 'gemini' | 'models' | 'unknown';
export type TorveCloudActivity = {
  id: string;
  timestamp: number;
  appId: string | null;
  protocol: DirectCloudProtocol;
  requestedModel: string | null;
  resolvedModel: string | null;
  statusCode: number;
  latencyMs: number;
  stream: boolean;
  usage: { inputTokens: number; outputTokens: number } | null;
  errorSummary: string | null;
};
let server: Server | null = null;
let activePort: number | null = null;
const recentActivity: TorveCloudActivity[] = [];
let activitySink: ((activity: TorveCloudActivity) => void) | null = null;

export function setDirectCloudActivitySink(sink: ((activity: TorveCloudActivity) => void) | null): void { activitySink = sink; }
export function getDirectCloudActivity(): TorveCloudActivity[] { return [...recentActivity]; }
export function clearDirectCloudActivity(): void { recentActivity.length = 0; }

export function torveCloudProxyStatus(): { running: boolean; port: number; upstream: string; recentActivity: TorveCloudActivity[] } {
  return { running: Boolean(server?.listening), port: activePort ?? DEFAULT_PORT, upstream: torveCloudUpstream(), recentActivity: [...recentActivity] };
}

export async function startTorveCloudProxy(port = DEFAULT_PORT): Promise<void> {
  if (server?.listening && activePort === port) return;
  if (server) await stopTorveCloudProxy();
  server = createServer((req, res) => { void handle(req, res); });
  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));
  await new Promise<void>((resolve, reject) => {
    const listening = () => { server?.off('error', reject); resolve(); };
    server?.once('error', reject);
    server?.once('listening', listening);
    server?.listen(port, '127.0.0.1');
  });
  activePort = port;
}

export async function stopTorveCloudProxy(): Promise<void> {
  const running = server;
  server = null;
  activePort = null;
  if (!running?.listening) return;
  await new Promise<void>((resolve, reject) => running.close((err) => err ? reject(err) : resolve()));
}

function isLoopback(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress ?? '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const started = Date.now();
  const requestId = randomUUID();
  const rawPath = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  const scoped = scopedRequestPath(rawPath);
  const path = scoped.path;
  const appId = scoped.appId;
  let requestedModel: string | null = null;
  let resolvedModel: string | null = null;
  let protocol: DirectCloudProtocol = protocolForPath(path);
  let stream = false;
  let usage: TorveCloudActivity['usage'] = null;
  let errorSummary: string | null = null;
  let status = 500;
  try {
    if (!isLoopback(req)) { status = 403; errorSummary = 'Loopback connections only.'; return sendError(res, status, 'Direct Torve Cloud proxy only accepts loopback connections.'); }
    const apiKey = await getTorveCloudApiKey();
    if (!apiKey) { status = 401; errorSummary = 'Torve account is not connected.'; return sendError(res, status, 'Connect a Torve account in Torve Desktop first.'); }
    if (req.method === 'GET' && path === '/v1/models') {
      const catalog = await torveCloudModelsStatus();
      const models = catalog.models.length > 0 ? catalog.models : await refreshTorveCloudModels(apiKey);
      status = 200;
      return sendJson(res, 200, { object: 'list', data: models });
    }
    if (req.method !== 'POST') { status = 404; errorSummary = 'Unsupported endpoint.'; return sendError(res, status, 'Unsupported Torve Cloud endpoint.'); }
    if (isGeminiPath(path)) {
      const outcome = await handleGeminiRequest(req, res, path, apiKey, appId);
      requestedModel = outcome.requestedModel;
      resolvedModel = outcome.resolvedModel;
      stream = outcome.stream;
      status = outcome.status;
      return;
    }
    const body = await readBody(req);
    const incoming: SerializedHttpRequest = { requestId, method: req.method, path, headers: requestHeaders(req), body };
    const source = detectRequestServiceApiProtocol(incoming);
    if (!source || !['anthropic-messages', 'openai-chat-completions', 'openai-responses'].includes(source)) {
      status = 501; errorSummary = 'Unsupported protocol.';
      return sendError(res, status, 'This local proxy currently supports OpenAI Chat/Responses and Anthropic Messages endpoints.');
    }
    const target: ServiceApiProtocol = 'openai-chat-completions';
    const adapted = transformRequest(incoming, { from: source, to: target });
    if (!adapted) { status = 400; errorSummary = 'Request translation failed.'; return sendError(res, status, 'Could not translate this request.'); }
    requestedModel = adapted.requestedModel;
    stream = adapted.streamRequested;
    protocol = protocolForService(source);
    const routed = await resolveRoutedModel(adapted.request.body, appId, requestedModel);
    resolvedModel = routed.model;
    const upstream = await fetch(`${torveCloudUpstream()}${adapted.request.path}`, {
      method: 'POST',
      headers: upstreamHeaders(adapted.request.headers, apiKey),
      body: routed.body,
      signal: AbortSignal.timeout(10 * 60_000),
    });
    status = upstream.status;
    if (upstream.body && isSse(upstream.headers.get('content-type'))) {
      await pipeStreaming(res, upstream, incoming.requestId, source, target, requestedModel);
      return;
    }
    const upstreamBytes = new Uint8Array(await upstream.arrayBuffer());
    usage = usageFromJson(upstreamBytes);
    const response: SerializedHttpResponse = { requestId: incoming.requestId, statusCode: upstream.status, headers: responseHeaders(upstream.headers), body: upstreamBytes };
    const outgoing = transformResponse(response, { from: target, to: source, streamRequested: adapted.streamRequested, fallbackModel: requestedModel });
    if (!outgoing) { status = 502; errorSummary = 'Response translation failed.'; return sendError(res, status, 'Torve returned a response this client protocol cannot represent.'); }
    res.writeHead(outgoing.statusCode, outgoing.headers);
    res.end(outgoing.body);
  } catch (err) {
    status = 502;
    errorSummary = sanitizeError(err instanceof Error ? err.message : 'Torve Cloud request failed.');
    sendError(res, 502, errorSummary);
  } finally {
    const activity: TorveCloudActivity = { id: requestId, timestamp: started, appId, protocol, requestedModel, resolvedModel, statusCode: status, latencyMs: Date.now() - started, stream, usage, errorSummary };
    recentActivity.unshift(activity);
    recentActivity.splice(100);
    activitySink?.(activity);
  }
}

async function pipeStreaming(res: ServerResponse, upstream: Response, requestId: string, source: ServiceApiProtocol, target: ServiceApiProtocol, model: string | null): Promise<void> {
  const adapter = source === target ? null : createStreamingAdapter({ from: target, to: source, fallbackModel: model });
  const start: SerializedHttpResponse = { requestId, statusCode: upstream.status, headers: responseHeaders(upstream.headers), body: new Uint8Array() };
  const initial = adapter ? adapter.adaptStart(start) : start;
  res.writeHead(initial.statusCode, initial.headers);
  if (!upstream.body) { res.end(); return; }
  const reader = upstream.body.getReader();
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      const chunks = adapter ? adapter.adaptChunk({ requestId, data: next.value, done: false }) : [{ requestId, data: next.value, done: false }];
      for (const chunk of chunks) res.write(chunk.data);
    }
    if (adapter) for (const chunk of adapter.adaptChunk({ requestId, data: new Uint8Array(), done: true })) res.write(chunk.data);
  } finally { res.end(); }
}

function requestHeaders(req: IncomingMessage): Record<string, string> { const result: Record<string, string> = {}; for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') result[key] = value; return result; }
function responseHeaders(headers: Headers): Record<string, string> { const result: Record<string, string> = {}; headers.forEach((value, key) => { if (!HOP_BY_HOP.has(key.toLowerCase())) result[key] = value; }); return result; }
function upstreamHeaders(headers: Record<string, string>, apiKey: string): Record<string, string> { const result: Record<string, string> = { authorization: `Bearer ${apiKey}`, accept: 'application/json, text/event-stream' }; for (const [key, value] of Object.entries(headers)) if (!HOP_BY_HOP.has(key.toLowerCase()) && key.toLowerCase() !== 'authorization') result[key] = value; return result; }
function isSse(contentType: string | null): boolean { return contentType?.toLowerCase().includes('text/event-stream') === true; }
function sendJson(res: ServerResponse, status: number, body: unknown): void { const json = JSON.stringify(body); res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(json).toString(), 'cache-control': 'no-store' }); res.end(json); }
function sendError(res: ServerResponse, status: number, message: string): void { if (!res.headersSent) sendJson(res, status, { error: { message, type: 'torve_cloud_error' } }); else res.end(); }
function readBody(req: IncomingMessage): Promise<Uint8Array> { return new Promise((resolve, reject) => { const parts: Buffer[] = []; let size = 0; req.on('data', (chunk: Buffer) => { size += chunk.length; if (size > MAX_BODY_BYTES) { reject(new Error('Request body exceeds the local proxy limit.')); req.destroy(); return; } parts.push(chunk); }); req.on('end', () => resolve(new Uint8Array(Buffer.concat(parts)))); req.on('error', reject); }); }

function scopedRequestPath(pathname: string): { appId: string | null; path: string } {
  const match = /^\/app\/([a-z0-9][a-z0-9._-]{0,63})(\/.*)?$/i.exec(pathname);
  if (!match) return { appId: null, path: pathname };
  return { appId: match[1]!.toLowerCase(), path: match[2] || '/' };
}

function protocolForPath(path: string): DirectCloudProtocol {
  if (path === '/v1/models') return 'models';
  if (isGeminiPath(path)) return 'gemini';
  if (path.startsWith('/v1/messages')) return 'anthropic';
  if (path.startsWith('/v1/responses')) return 'openai-responses';
  if (path.startsWith('/v1/chat/completions')) return 'openai-chat';
  return 'unknown';
}

function protocolForService(value: ServiceApiProtocol): DirectCloudProtocol {
  if (value === 'anthropic-messages') return 'anthropic';
  if (value === 'openai-responses') return 'openai-responses';
  if (value === 'openai-chat-completions') return 'openai-chat';
  return 'unknown';
}

function isGeminiPath(path: string): boolean { return /^\/v1(?:beta)?\/models\/[^/]+:(?:generateContent|streamGenerateContent)$/.test(path); }

async function handleGeminiRequest(req: IncomingMessage, res: ServerResponse, path: string, apiKey: string, appId: string | null): Promise<{ status: number; requestedModel: string | null; resolvedModel: string | null; stream: boolean }> {
  const input = JSON.parse(new TextDecoder().decode(await readBody(req))) as Record<string, unknown>;
  const encodedModel = /^\/v1(?:beta)?\/models\/([^/:]+):/.exec(path)?.[1] ?? 'torve';
  const requestedModel = decodeURIComponent(encodedModel);
  const fallback = (await torveCloudModelsStatus()).models[0]?.id ?? null;
  const model = await resolveDirectCloudModel(appId, requestedModel, fallback) ?? requestedModel;
  const messages = geminiMessages(input);
  const stream = path.includes(':streamGenerateContent');
  const upstream = await fetch(`${torveCloudUpstream()}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', accept: stream ? 'text/event-stream' : 'application/json' },
    body: JSON.stringify({ model, messages, tools: geminiTools(input), stream }),
    signal: AbortSignal.timeout(10 * 60_000),
  });
  if (!stream || !upstream.body || !isSse(upstream.headers.get('content-type'))) {
    const payload = await upstream.json() as Record<string, unknown>;
    if (!upstream.ok) { sendJson(res, upstream.status, payload); return { status: upstream.status, requestedModel, resolvedModel: model, stream }; }
    sendJson(res, upstream.status, openAiToGemini(payload));
    return { status: upstream.status, requestedModel, resolvedModel: model, stream };
  }
  res.writeHead(upstream.status, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const decoder = new TextDecoder(); let pending = '';
  const reader = upstream.body.getReader();
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      pending += decoder.decode(next.value, { stream: true });
      const events = pending.split(/\n\n/); pending = events.pop() ?? '';
      for (const event of events) {
        const data = event.split(/\r?\n/).find((line) => line.startsWith('data: '))?.slice(6);
        if (!data || data === '[DONE]') continue;
        try { res.write(`data: ${JSON.stringify(openAiToGemini(JSON.parse(data) as Record<string, unknown>))}\n\n`); } catch { /* ignore malformed upstream event */ }
      }
    }
  } finally { res.end(); }
  return { status: upstream.status, requestedModel, resolvedModel: model, stream };
}

function geminiMessages(input: Record<string, unknown>): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [];
  const system = input['systemInstruction'];
  if (system && typeof system === 'object') {
    const text = geminiText((system as Record<string, unknown>)['parts']);
    if (text) messages.push({ role: 'system', content: text });
  }
  for (const raw of Array.isArray(input['contents']) ? input['contents'] : []) {
    if (!raw || typeof raw !== 'object') continue;
    const content = raw as Record<string, unknown>;
    const text = geminiText(content['parts']);
    if (text) messages.push({ role: content['role'] === 'model' ? 'assistant' : 'user', content: text });
  }
  return messages.length > 0 ? messages : [{ role: 'user', content: '' }];
}
function geminiText(parts: unknown): string { return (Array.isArray(parts) ? parts : []).map((part) => part && typeof part === 'object' && typeof (part as Record<string, unknown>)['text'] === 'string' ? (part as Record<string, string>)['text'] : '').join(''); }
function geminiTools(input: Record<string, unknown>): Array<Record<string, unknown>> | undefined {
  const out: Array<Record<string, unknown>> = [];
  for (const group of Array.isArray(input['tools']) ? input['tools'] : []) {
    const declarations = group && typeof group === 'object' ? (group as Record<string, unknown>)['functionDeclarations'] : undefined;
    for (const fn of Array.isArray(declarations) ? declarations : []) if (fn && typeof fn === 'object') out.push({ type: 'function', function: fn });
  }
  return out.length > 0 ? out : undefined;
}
function openAiToGemini(payload: Record<string, unknown>): Record<string, unknown> {
  const choice = Array.isArray(payload['choices']) ? payload['choices'][0] as Record<string, unknown> | undefined : undefined;
  const message = choice?.['message'] && typeof choice['message'] === 'object' ? choice['message'] as Record<string, unknown> : {};
  const delta = choice?.['delta'] && typeof choice['delta'] === 'object' ? choice['delta'] as Record<string, unknown> : {};
  const text = typeof message['content'] === 'string' ? message['content'] : typeof delta['content'] === 'string' ? delta['content'] : '';
  const tools = Array.isArray(message['tool_calls']) ? message['tool_calls'] : [];
  const parts: Array<Record<string, unknown>> = text ? [{ text }] : [];
  for (const raw of tools) {
    const fn = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)['function'] : null;
    if (fn && typeof fn === 'object') parts.push({ functionCall: { name: (fn as Record<string, unknown>)['name'], args: safeJson((fn as Record<string, unknown>)['arguments']) } });
  }
  return { candidates: [{ content: { role: 'model', parts }, finishReason: choice?.['finish_reason'] === 'tool_calls' ? 'STOP' : 'STOP' }], usageMetadata: geminiUsage(payload['usage']) };
}
function safeJson(value: unknown): Record<string, unknown> { try { return typeof value === 'string' ? JSON.parse(value) as Record<string, unknown> : {}; } catch { return {}; } }
function geminiUsage(value: unknown): Record<string, number> { const usage = value && typeof value === 'object' ? value as Record<string, unknown> : {}; const prompt = typeof usage['prompt_tokens'] === 'number' ? usage['prompt_tokens'] : 0; const output = typeof usage['completion_tokens'] === 'number' ? usage['completion_tokens'] : 0; return { promptTokenCount: prompt, candidatesTokenCount: output, totalTokenCount: prompt + output }; }

/** Config-patched clients use the stable `torve` alias. Resolve it only at
 * the loopback boundary so individual tool configs never need a raw model id
 * or API key. The catalog's first available model is a safe initial default;
 * later per-app overrides can replace it without rewriting client configs. */
async function resolveRoutedModel(body: Uint8Array, appId: string | null, requestedModel: string | null): Promise<{ body: Uint8Array; model: string | null }> {
  try {
    const json = JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
    const catalog = await torveCloudModelsStatus();
    const model = await resolveDirectCloudModel(appId, requestedModel, catalog.models[0]?.id ?? null);
    if (!model || json['model'] === model) return { body, model };
    return { body: new TextEncoder().encode(JSON.stringify({ ...json, model })), model };
  } catch { return { body, model: requestedModel }; }
}

function usageFromJson(body: Uint8Array): TorveCloudActivity['usage'] {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
    const raw = parsed['usage'];
    if (!raw || typeof raw !== 'object') return null;
    const usage = raw as Record<string, unknown>;
    const input = Number(usage['prompt_tokens'] ?? usage['input_tokens'] ?? 0);
    const output = Number(usage['completion_tokens'] ?? usage['output_tokens'] ?? 0);
    return { inputTokens: Number.isFinite(input) ? input : 0, outputTokens: Number.isFinite(output) ? output : 0 };
  } catch { return null; }
}

function sanitizeError(message: string): string {
  return message.replace(/(?:sk|torve)_[A-Za-z0-9_-]{8,}/g, '[redacted]').slice(0, 240);
}
