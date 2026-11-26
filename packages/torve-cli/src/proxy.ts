import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { fetchTorveModelsUpstream, readModelsCache, torveCloudUpstream } from './api.js';
import { codexCatalogPayload, MIN_CONTEXT_WINDOW_FLOOR, MIN_OUTPUT_TOKENS_FLOOR } from './config-patch.js';
import { readDirectCloudOverrides, readJsonFile, resolveCredentials, usageStatsPath, writeJsonAtomic } from './state.js';
import type { TorveModel } from './types.js';

const DEFAULT_PORT = Number(process.env['TORVE_CLOUD_PROXY_PORT']) || 8378;
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 120_000;
const LOW_OUTPUT_TOKENS_THRESHOLD = 8_192;
const HOP_BY_HOP = new Set([
  'connection', 'host', 'content-length', 'transfer-encoding', 'keep-alive',
  'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'upgrade',
]);

export interface ProxyOptions {
  getApiKey?: () => Promise<string | null> | string | null;
  getModels?: (apiKey: string) => Promise<TorveModel[]>;
  resolveModel?: (appId: string | null, requestedModel: string | null, fallback: string | null) => Promise<string | null>;
  headerTimeoutMs?: number;
  streamIdleTimeoutMs?: number;
  recordUsage?: boolean;
}

type TokenUsageDetails = {
  inputTokens: number;
  outputTokens: number;
  freshInputTokens: number;
  cachedInputTokens: number;
};

class PayloadTooLargeError extends Error {
  constructor() {
    super('Request body exceeds the 64 MiB local proxy limit.');
    this.name = 'PayloadTooLargeError';
  }
}

let server: Server | null = null;
let activePort: number | null = null;
let activeOptions: ProxyOptions = {};

export function getProxyStatus(): { running: boolean; port: number; upstream: string } {
  return {
    running: Boolean(server?.listening),
    port: activePort ?? DEFAULT_PORT,
    upstream: torveCloudUpstream(),
  };
}

export async function startProxyServer(port = DEFAULT_PORT, options: ProxyOptions = {}): Promise<number> {
  if (server?.listening && activePort === port && port !== 0) {
    activeOptions = options;
    return activePort;
  }
  if (server) await stopProxyServer();
  activeOptions = options;
  server = createServer((req, res) => { void handleRequest(req, res); });
  server.requestTimeout = 0;
  server.headersTimeout = resolveHeaderTimeoutMs();
  server.on('clientError', (_err, socket) => socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));

  await new Promise<void>((resolve, reject) => {
    const onListening = () => {
      server?.off('error', reject);
      resolve();
    };
    server?.once('error', reject);
    server?.once('listening', onListening);
    server?.listen(port, '127.0.0.1');
  });

  const addr = server.address();
  activePort = addr && typeof addr === 'object' ? addr.port : port;
  return activePort;
}

export async function stopProxyServer(): Promise<void> {
  const active = server;
  server = null;
  activePort = null;
  activeOptions = {};
  if (!active?.listening) return;
  active.closeAllConnections?.();
  await new Promise<void>((resolve, reject) => active.close((err) => (err ? reject(err) : resolve())));
}

function resolveHeaderTimeoutMs(): number {
  const v = activeOptions.headerTimeoutMs;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : UPSTREAM_TIMEOUT_MS;
}

function resolveStreamIdleTimeoutMs(): number {
  const v = activeOptions.streamIdleTimeoutMs;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : UPSTREAM_TIMEOUT_MS;
}

type UpstreamFetchControl = {
  signal: AbortSignal;
  markHeadersReceived: (streaming: boolean) => void;
  touchChunk: () => void;
  clear: () => void;
};

function createUpstreamFetchControl(res?: ServerResponse): UpstreamFetchControl {
  const controller = new AbortController();
  const headerMs = resolveHeaderTimeoutMs();
  const idleMs = resolveStreamIdleTimeoutMs();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let currentWindowMs = headerMs;

  const arm = (ms: number): void => {
    if (timer) clearTimeout(timer);
    currentWindowMs = ms;
    timer = setTimeout(() => {
      controller.abort(new DOMException(`Upstream timed out after ${ms}ms`, 'TimeoutError'));
    }, ms);
    timer.unref?.();
  };

  const clear = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (res) res.off('close', onClientClose);
  };

  const onClientClose = (): void => {
    if (res && !res.writableFinished) {
      clear();
      controller.abort();
    }
  };
  if (res) res.once('close', onClientClose);

  arm(headerMs);

  return {
    signal: controller.signal,
    markHeadersReceived(streaming: boolean) {
      if (controller.signal.aborted) return;
      arm(streaming ? idleMs : headerMs);
    },
    touchChunk() {
      if (controller.signal.aborted) return;
      arm(currentWindowMs);
    },
    clear,
  };
}

async function resolveApiKey(): Promise<string | null> {
  if (activeOptions.getApiKey) return await activeOptions.getApiKey();
  return (await resolveCredentials())?.apiKey ?? null;
}

async function resolveModelsCatalog(apiKey: string): Promise<TorveModel[]> {
  if (activeOptions.getModels) return await activeOptions.getModels(apiKey);
  const cached = await readModelsCache();
  if (cached && cached.models.length > 0 && Date.now() - cached.updatedAt < 5 * 60_000) {
    return cached.models;
  }
  return await fetchTorveModelsUpstream(apiKey);
}

async function resolveModelForRequest(appId: string | null, requestedModel: string | null, apiKey: string): Promise<string | null> {
  const models = await resolveModelsCatalog(apiKey).catch(() => [] as TorveModel[]);
  const fallback = models[0]?.id ?? null;
  if (activeOptions.resolveModel) {
    return await activeOptions.resolveModel(appId, requestedModel, fallback);
  }
  const aliasRequested = !requestedModel || requestedModel === 'torve' || requestedModel === 'auto';
  if (!aliasRequested) return requestedModel;
  if (appId) {
    const overrides = await readDirectCloudOverrides();
    if (overrides[appId]?.enabled && overrides[appId]!.modelId) {
      return overrides[appId]!.modelId;
    }
  }
  return fallback;
}

function isLoopback(req: IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? '';
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function scopedRequestPath(pathname: string): { appId: string | null; path: string } {
  const match = /^\/app\/([a-z0-9][a-z0-9._-]{0,63})(\/.*)?$/i.exec(pathname);
  if (!match) return { appId: null, path: pathname };
  return { appId: match[1]!.toLowerCase(), path: match[2] || '/' };
}

export function sanitizeTorveClientApp(rawAppId: string | null | undefined): string {
  if (typeof rawAppId !== 'string') return 'torve-cli';
  const normalized = rawAppId
    .trim()
    .toLowerCase()
    .replace(/[_\s.]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[^a-z]+/, '')
    .slice(0, 64)
    .replace(/-+$/, '');
  return /^[a-z][a-z0-9-]{0,63}$/.test(normalized) ? normalized : 'torve-cli';
}

function requestHeaders(req: IncomingMessage): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') result[k] = v;
  }
  return result;
}

function responseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) result[key] = value;
  });
  return result;
}

function upstreamHeaders(headers: Record<string, string>, apiKey: string, appId: string | null): Record<string, string> {
  const result: Record<string, string> = {
    authorization: `Bearer ${apiKey}`,
    accept: 'application/json, text/event-stream',
    'x-torve-client-app': sanitizeTorveClientApp(appId),
  };
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (
      HOP_BY_HOP.has(lower)
      || lower === 'authorization'
      || lower === 'x-api-key'
      || lower === 'api-key'
      || lower === 'x-torve-client-app'
    ) {
      continue;
    }
    result[k] = v;
  }
  return result;
}

function jsonUpstreamHeaders(headers: Record<string, string>, apiKey: string, appId: string | null, accept: string): Record<string, string> {
  const result = upstreamHeaders(headers, apiKey, appId);
  for (const key of Object.keys(result)) {
    const lower = key.toLowerCase();
    if (lower === 'content-type' || lower === 'accept') delete result[key];
  }
  result['content-type'] = 'application/json';
  result['accept'] = accept;
  return result;
}

function isSse(contentType: string | null): boolean {
  return contentType?.toLowerCase().includes('text/event-stream') === true;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(json).toString(),
    'cache-control': 'no-store',
  });
  res.end(json);
}

function sendError(res: ServerResponse, status: number, message: string): void {
  if (!res.headersSent) sendJson(res, status, { error: { message, type: 'torve_cloud_error' } });
  else if (!res.writableEnded) res.end();
}

function readBody(req: IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new PayloadTooLargeError());
        req.destroy();
        return;
      }
      parts.push(chunk);
    });
    req.on('end', () => resolve(new Uint8Array(Buffer.concat(parts))));
    req.on('error', reject);
  });
}

function parseJsonObjectBytes(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function finitePositiveNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export function floorOutboundOutputTokens(value: unknown): number {
  const n = finitePositiveNumber(value);
  return n === 0 || n <= LOW_OUTPUT_TOKENS_THRESHOLD ? MIN_OUTPUT_TOKENS_FLOOR : n;
}

export function applyOutboundMaxTokens(body: Record<string, unknown>): { next: Record<string, unknown>; changed: boolean } {
  if (body['max_completion_tokens'] !== undefined) {
    const current = finitePositiveNumber(body['max_completion_tokens']);
    if (current === 0 || current <= LOW_OUTPUT_TOKENS_THRESHOLD) {
      return { next: { ...body, max_completion_tokens: MIN_OUTPUT_TOKENS_FLOOR }, changed: true };
    }
    return { next: body, changed: false };
  }
  if (body['max_tokens'] !== undefined) {
    const current = finitePositiveNumber(body['max_tokens']);
    if (current === 0 || current <= LOW_OUTPUT_TOKENS_THRESHOLD) {
      return { next: { ...body, max_tokens: MIN_OUTPUT_TOKENS_FLOOR }, changed: true };
    }
    return { next: body, changed: false };
  }
  return { next: { ...body, max_tokens: MIN_OUTPUT_TOKENS_FLOOR }, changed: true };
}

export function applyModelCatalogFloors(models: readonly TorveModel[]): TorveModel[] {
  return models.map((m) => {
    const rawContext = finitePositiveNumber(m['context_window']);
    const rawMaxInput = finitePositiveNumber(m['max_input_tokens']);
    const rawLength = finitePositiveNumber(m['context_length']);
    const flooredContext = Math.max(Math.max(rawContext, rawMaxInput, rawLength), MIN_CONTEXT_WINDOW_FLOOR);
    const nextContextWindow = Math.max(rawContext, flooredContext);
    const nextMaxInput = Math.max(rawMaxInput, flooredContext);

    const rawMaxOutput = finitePositiveNumber(m['max_output_tokens']);
    const rawMaxTokens = finitePositiveNumber(m['max_tokens']);
    const flooredOutput = Math.max(Math.max(rawMaxOutput, rawMaxTokens), MIN_OUTPUT_TOKENS_FLOOR);
    const nextMaxOutput = Math.max(rawMaxOutput, flooredOutput);
    const nextMaxTokens = Math.max(rawMaxTokens, flooredOutput);

    if (
      rawContext === nextContextWindow
      && rawMaxInput === nextMaxInput
      && rawMaxOutput === nextMaxOutput
      && rawMaxTokens === nextMaxTokens
    ) {
      return m;
    }
    return {
      ...m,
      context_window: nextContextWindow,
      max_input_tokens: nextMaxInput,
      max_output_tokens: nextMaxOutput,
      max_tokens: nextMaxTokens,
    };
  });
}

// ---------------------------------------------------------------------------
// Request dispatcher
// ---------------------------------------------------------------------------

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const started = Date.now();
  const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
  let rawPath = requestUrl.pathname;
  try { rawPath = decodeURIComponent(rawPath); } catch { /* fall through */ }
  const scoped = scopedRequestPath(rawPath);
  let reqPath = scoped.path;
  if (scoped.appId === 'claude-desktop') {
    if (reqPath === '/messages') reqPath = '/v1/messages';
    if (reqPath === '/messages/count_tokens') reqPath = '/v1/messages/count_tokens';
    if (reqPath === '/models') reqPath = '/v1/models';
  }
  const appId = scoped.appId;

  let status = 500;
  let resolvedModel: string | null = null;
  let usage: { inputTokens: number; outputTokens: number } | null = null;
  let tracked = false;

  try {
    if (!isLoopback(req)) {
      status = 403;
      return sendError(res, status, 'Torve local proxy only accepts loopback connections.');
    }

    if (req.method === 'GET' && (reqPath === '/_torve/health' || reqPath === '/health')) {
      const apiKey = await resolveApiKey();
      status = 200;
      return sendJson(res, 200, {
        ok: true,
        service: 'torve-cli-proxy',
        port: activePort ?? DEFAULT_PORT,
        pid: process.pid,
        authenticated: Boolean(apiKey),
        upstream: torveCloudUpstream(),
      });
    }

    const apiKey = await resolveApiKey();
    if (!apiKey) {
      status = 401;
      return sendError(res, status, 'Torve account is not connected. Run "torve login" first.');
    }

    if (req.method === 'GET' && reqPath === '/v1/models') {
      const models = await resolveModelsCatalog(apiKey);
      const floored = applyModelCatalogFloors(models);
      const clientVersion = requestUrl.searchParams.get('client_version');
      status = 200;
      return sendJson(
        res,
        200,
        clientVersion !== null ? codexCatalogPayload(floored) : { object: 'list', data: floored },
      );
    }

    if (req.method !== 'POST') {
      status = 404;
      return sendError(res, status, 'Unsupported Torve Cloud endpoint.');
    }

    if (isGeminiPath(reqPath)) {
      tracked = true;
      const out = await handleGeminiRequest(req, res, reqPath, apiKey, appId);
      status = out.status;
      resolvedModel = out.resolvedModel;
      usage = out.usage;
      return;
    }

    const body = await readBody(req);
    const incomingHeaders = requestHeaders(req);

    if (reqPath === '/v1/responses/compact') {
      tracked = true;
      const out = await handleResponsesCompact(res, body, incomingHeaders, apiKey, appId);
      status = out.status;
      resolvedModel = out.resolvedModel;
      usage = out.usage;
      return;
    }

    if (reqPath.startsWith('/v1/responses')) {
      tracked = true;
      const out = await handleResponsesRequest(res, incomingHeaders, body, apiKey, appId);
      status = out.status;
      resolvedModel = out.resolvedModel;
      usage = out.usage;
      return;
    }

    if (reqPath === '/v1/messages/count_tokens') {
      const parsed = parseJsonObjectBytes(body);
      const approxTokens = Math.max(1, Math.ceil(JSON.stringify(parsed ?? {}).length / 4));
      status = 200;
      return sendJson(res, 200, { input_tokens: approxTokens });
    }

    if (reqPath.startsWith('/v1/messages')) {
      tracked = true;
      const out = await handleAnthropicMessagesRequest(res, incomingHeaders, body, apiKey, appId);
      status = out.status;
      resolvedModel = out.resolvedModel;
      usage = out.usage;
      return;
    }

    if (reqPath.startsWith('/v1/chat/completions')) {
      tracked = true;
      const out = await handleOpenAiChatRequest(res, incomingHeaders, body, apiKey, appId);
      status = out.status;
      resolvedModel = out.resolvedModel;
      usage = out.usage;
      return;
    }

    status = 501;
    return sendError(res, status, 'This local proxy supports /v1/models, /v1/chat/completions, /v1/responses, /v1/messages, and /v1beta.');
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      status = 413;
      sendError(res, status, err.message);
      return;
    }
    const timedOut = isTimeoutError(err);
    status = timedOut ? 504 : 502;
    const message = timedOut
      ? `Torve Cloud upstream timed out after ${resolveHeaderTimeoutMs() / 1000} seconds.`
      : sanitizeError(err instanceof Error ? err.message : 'Torve Cloud request failed.');
    sendError(res, status, message);
  } finally {
    if (tracked && activeOptions.recordUsage !== false && status >= 200 && status < 300) {
      void recordLocalUsage({
        modelId: resolvedModel ?? 'auto',
        appId,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        latencyMs: Date.now() - started,
        timestampMs: started,
      }).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// SSE & Usage helpers
// ---------------------------------------------------------------------------

function beginSseResponse(res: ServerResponse, statusCode: number, baseHeaders: Record<string, string> = {}): void {
  const headers: Record<string, string> = { ...baseHeaders };
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase();
    if (lower === 'content-length' || lower === 'content-encoding' || lower === 'transfer-encoding' || lower === 'connection' || lower === 'keep-alive') {
      delete headers[key];
    }
  }
  headers['content-type'] = 'text/event-stream; charset=utf-8';
  headers['cache-control'] = 'no-cache';
  headers['connection'] = 'close';
  headers['x-accel-buffering'] = 'no';
  res.writeHead(statusCode, headers);
  res.flushHeaders?.();
  res.socket?.setNoDelay?.(true);
}

class SseUsageTracker {
  private readonly decoder = new TextDecoder();
  private buffer = '';
  private inputTokens = 0;
  private outputTokens = 0;
  private seen = false;

  push(chunk: Uint8Array): void {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      this.consumeLine(line);
    }
  }

  finish(): { inputTokens: number; outputTokens: number } | null {
    const tail = (this.buffer + this.decoder.decode()).trim();
    this.buffer = '';
    if (tail) this.consumeLine(tail);
    return this.seen ? { inputTokens: this.inputTokens, outputTokens: this.outputTokens } : null;
  }

  private consumeLine(line: string): void {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      const u = (parsed['usage'] && typeof parsed['usage'] === 'object' ? parsed['usage'] : null) as Record<string, unknown> | null;
      if (!u) return;
      const inp = Number(u['prompt_tokens'] ?? u['input_tokens'] ?? 0);
      const out = Number(u['completion_tokens'] ?? u['output_tokens'] ?? 0);
      this.seen = true;
      if (Number.isFinite(inp) && inp > this.inputTokens) this.inputTokens = Math.round(inp);
      if (Number.isFinite(out) && out > this.outputTokens) this.outputTokens = Math.round(out);
    } catch { /* ignore partial lines */ }
  }
}

async function pipeStreaming(res: ServerResponse, upstream: Response, onChunk?: () => void): Promise<{ inputTokens: number; outputTokens: number } | null> {
  beginSseResponse(res, upstream.status, responseHeaders(upstream.headers));
  if (!upstream.body) { res.end(); return null; }
  const reader = upstream.body.getReader();
  const detector = new TextDecoder();
  const tracker = new SseUsageTracker();
  let tail = '';
  let sawDone = false;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      onChunk?.();
      tracker.push(next.value);
      tail = `${tail}${detector.decode(next.value, { stream: true })}`.slice(-256);
      if (/data:\s*\[DONE\]/.test(tail)) sawDone = true;
      res.write(next.value);
    }
    if (!sawDone) res.write('data: [DONE]\n\n');
  } catch (err) {
    if (!res.writableEnded) {
      const message = isTimeoutError(err) ? 'Torve Cloud stream timed out.' : 'Torve Cloud stream ended unexpectedly.';
      res.write(`data: ${JSON.stringify({ error: { message, type: 'torve_cloud_stream_error' } })}\n\n`);
      res.write('data: [DONE]\n\n');
    }
  } finally {
    try { await reader.cancel(); } catch { /* closed */ }
    if (!res.writableEnded) res.end();
  }
  return tracker.finish();
}

async function consumeOpenAiSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (parsed: Record<string, unknown>) => void,
  onChunk?: () => void,
): Promise<{ usage: { inputTokens: number; outputTokens: number } | null; sawDone: boolean }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const tracker = new SseUsageTracker();
  let pending = '';
  let sawDone = false;

  const processBlock = (block: string): boolean => {
    const dataLines: string[] = [];
    for (const rawLine of block.split(/\r?\n/)) {
      if (rawLine.startsWith('data:')) dataLines.push(rawLine.slice(5).replace(/^ /, ''));
    }
    if (dataLines.length === 0) return false;
    const payload = dataLines.join('\n').trim();
    if (!payload) return false;
    if (payload === '[DONE]') {
      sawDone = true;
      return true;
    }
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        onEvent(parsed as Record<string, unknown>);
      }
    } catch { /* ignore malformed SSE event */ }
    return false;
  };

  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      onChunk?.();
      tracker.push(next.value);
      pending += decoder.decode(next.value, { stream: true });
      const blocks = pending.split(/\r?\n\r?\n/);
      pending = blocks.pop() ?? '';
      for (const block of blocks) {
        if (processBlock(block)) return { usage: tracker.finish(), sawDone: true };
      }
    }
    pending += decoder.decode();
    if (pending.trim()) processBlock(pending);
  } finally {
    try { await reader.cancel(); } catch { /* closed */ }
  }
  return { usage: tracker.finish(), sawDone };
}

// ---------------------------------------------------------------------------
// OpenAI Chat Completions (/v1/chat/completions)
// ---------------------------------------------------------------------------

async function handleOpenAiChatRequest(
  res: ServerResponse,
  incomingHeaders: Record<string, string>,
  body: Uint8Array,
  apiKey: string,
  appId: string | null,
): Promise<{ status: number; resolvedModel: string | null; usage: { inputTokens: number; outputTokens: number } | null }> {
  const reqBody = parseJsonObjectBytes(body);
  if (!reqBody) {
    sendError(res, 400, 'Invalid JSON body for /v1/chat/completions.');
    return { status: 400, resolvedModel: null, usage: null };
  }
  const requestedModel = typeof reqBody['model'] === 'string' && reqBody['model'].trim() ? reqBody['model'].trim() : null;
  const resolvedModel = await resolveModelForRequest(appId, requestedModel, apiKey);
  const withModel = resolvedModel && reqBody['model'] !== resolvedModel ? { ...reqBody, model: resolvedModel } : reqBody;
  const { next: outboundBody } = applyOutboundMaxTokens(withModel);
  const stream = Boolean(outboundBody['stream']);
  const headers = jsonUpstreamHeaders(incomingHeaders, apiKey, appId, stream ? 'text/event-stream' : 'application/json');

  const fetchCtrl = createUpstreamFetchControl(res);
  try {
    const upstream = await fetch(`${torveCloudUpstream()}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(outboundBody),
      signal: fetchCtrl.signal,
    });
    const streaming = Boolean(upstream.body && isSse(upstream.headers.get('content-type')));
    fetchCtrl.markHeadersReceived(streaming);
    if (streaming && upstream.body) {
      const usage = await pipeStreaming(res, upstream, fetchCtrl.touchChunk);
      return { status: upstream.status, resolvedModel, usage };
    }
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    const outHeaders = responseHeaders(upstream.headers);
    delete outHeaders['content-encoding'];
    delete outHeaders['content-length'];
    res.writeHead(upstream.status, { ...outHeaders, 'content-length': Buffer.byteLength(bytes).toString() });
    res.end(bytes);
    return { status: upstream.status, resolvedModel, usage: usageFromJson(bytes) };
  } finally {
    fetchCtrl.clear();
  }
}

// ---------------------------------------------------------------------------
// OpenAI Responses (/v1/responses & /v1/responses/compact) + Codex tool normalizer
// ---------------------------------------------------------------------------

/** Normalizes OpenAI Responses tools (`function`, `custom`, and `namespace`) into OpenAI Chat `function` tools. */
export function convertResponsesToolsToChat(rawTools: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(rawTools)) return undefined;
  const out: Array<Record<string, unknown>> = [];

  const pushOne = (raw: unknown, nsPrefix?: string): void => {
    if (!raw || typeof raw !== 'object') return;
    const tool = raw as Record<string, unknown>;
    const type = typeof tool['type'] === 'string' ? tool['type'] : '';

    if (type === 'namespace') {
      const ns = typeof tool['name'] === 'string' ? tool['name'].trim() : '';
      const childTools = Array.isArray(tool['tools']) ? tool['tools'] : [];
      if (childTools.length > 0) {
        for (const child of childTools) pushOne(child, ns || nsPrefix);
      } else if (ns) {
        out.push({
          type: 'function',
          function: {
            name: ns,
            ...(typeof tool['description'] === 'string' && tool['description'] ? { description: tool['description'] } : {}),
            parameters: { type: 'object', properties: {} },
          },
        });
      }
      return;
    }

    if (type === 'function') {
      if (tool['function'] && typeof tool['function'] === 'object') {
        out.push(tool);
        return;
      }
      if (typeof tool['name'] === 'string' && tool['name']) {
        const fn: Record<string, unknown> = {
          name: tool['name'],
          ...(typeof tool['description'] === 'string' && tool['description'] ? { description: tool['description'] } : {}),
          parameters: tool['parameters'] && typeof tool['parameters'] === 'object' && !Array.isArray(tool['parameters'])
            ? tool['parameters']
            : { type: 'object', properties: {} },
          ...(typeof tool['strict'] === 'boolean' ? { strict: tool['strict'] } : {}),
        };
        out.push({ type: 'function', function: fn });
      }
      return;
    }

    if (type === 'custom' && typeof tool['name'] === 'string' && tool['name']) {
      out.push({
        type: 'function',
        function: {
          name: tool['name'],
          ...(typeof tool['description'] === 'string' && tool['description'] ? { description: tool['description'] } : {}),
          parameters: { type: 'object', properties: { input: { type: 'string' } }, required: ['input'] },
        },
      });
      return;
    }

    if (type) out.push(tool);
  };

  for (const raw of rawTools) pushOne(raw);
  return out.length > 0 ? out : undefined;
}

function convertResponsesToolChoiceToChat(rawChoice: unknown): unknown {
  if (typeof rawChoice === 'string') return rawChoice;
  if (!rawChoice || typeof rawChoice !== 'object') return undefined;
  const choice = rawChoice as Record<string, unknown>;
  if (choice['type'] === 'function') {
    if (typeof choice['name'] === 'string' && choice['name']) {
      return { type: 'function', function: { name: choice['name'] } };
    }
    if (choice['function'] && typeof choice['function'] === 'object') return choice;
  }
  return choice;
}

function extractResponsesContentAsChat(content: unknown): string | Array<Record<string, unknown>> {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: Array<Record<string, unknown>> = [];
  let hasImage = false;
  for (const rawPart of content) {
    if (typeof rawPart === 'string') {
      parts.push({ type: 'text', text: rawPart });
      continue;
    }
    if (!rawPart || typeof rawPart !== 'object') continue;
    const part = rawPart as Record<string, unknown>;
    const type = typeof part['type'] === 'string' ? part['type'] : '';
    if ((type === 'input_text' || type === 'output_text' || type === 'text') && typeof part['text'] === 'string') {
      parts.push({ type: 'text', text: part['text'] });
      continue;
    }
    if (type === 'refusal' && typeof part['refusal'] === 'string') {
      parts.push({ type: 'text', text: part['refusal'] });
      continue;
    }
    if (type === 'input_image' || type === 'image_url') {
      const rawUrl = part['image_url'];
      if (typeof rawUrl === 'string' && rawUrl) {
        hasImage = true;
        parts.push({
          type: 'image_url',
          image_url: { url: rawUrl, ...(typeof part['detail'] === 'string' ? { detail: part['detail'] } : {}) },
        });
      } else if (rawUrl && typeof rawUrl === 'object') {
        hasImage = true;
        parts.push({ type: 'image_url', image_url: rawUrl });
      }
    }
  }
  if (!hasImage) {
    return parts.map((p) => (typeof p['text'] === 'string' ? p['text'] : '')).filter(Boolean).join('\n');
  }
  return parts;
}

function stringifyResponsesToolOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) {
    const texts: string[] = [];
    let allText = true;
    for (const part of output) {
      if (part && typeof part === 'object' && typeof (part as Record<string, unknown>)['text'] === 'string') {
        texts.push((part as Record<string, unknown>)['text'] as string);
      } else {
        allText = false;
        break;
      }
    }
    if (allText) return texts.join('\n');
  }
  try { return JSON.stringify(output ?? ''); } catch { return String(output ?? ''); }
}

export function buildChatRequestFromResponses(
  reqBody: Record<string, unknown>,
  resolvedModel: string | null = null,
): Record<string, unknown> {
  const messages: Array<Record<string, unknown>> = [];
  if (typeof reqBody['instructions'] === 'string' && reqBody['instructions'].length > 0) {
    messages.push({ role: 'system', content: reqBody['instructions'] });
  }

  const input = reqBody['input'];
  if (typeof input === 'string') {
    messages.push({ role: 'user', content: input });
  } else if (Array.isArray(input)) {
    for (const rawItem of input) {
      if (typeof rawItem === 'string') {
        messages.push({ role: 'user', content: rawItem });
        continue;
      }
      if (!rawItem || typeof rawItem !== 'object') continue;
      const item = rawItem as Record<string, unknown>;
      const type = typeof item['type'] === 'string' ? item['type'] : '';

      if (type === 'function_call' || type === 'custom_tool_call') {
        const callId = typeof item['call_id'] === 'string' && item['call_id']
          ? item['call_id']
          : (typeof item['id'] === 'string' && item['id'] ? item['id'] : `call_${randomUUID()}`);
        const name = typeof item['name'] === 'string' ? item['name'] : '';
        const rawArgs = type === 'custom_tool_call' ? (item['input'] ?? item['arguments']) : item['arguments'];
        const args = typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs ?? {});
        const toolCall = { id: callId, type: 'function', function: { name, arguments: args } };
        const prev = messages[messages.length - 1];
        if (prev && prev['role'] === 'assistant') {
          const existing = Array.isArray(prev['tool_calls']) ? prev['tool_calls'] as unknown[] : [];
          prev['tool_calls'] = [...existing, toolCall];
        } else {
          messages.push({ role: 'assistant', content: null, tool_calls: [toolCall] });
        }
        continue;
      }

      if (type === 'function_call_output' || type === 'custom_tool_call_output') {
        const callId = typeof item['call_id'] === 'string' && item['call_id']
          ? item['call_id']
          : (typeof item['id'] === 'string' ? item['id'] : '');
        messages.push({
          role: 'tool',
          tool_call_id: callId,
          content: stringifyResponsesToolOutput(item['output']),
        });
        continue;
      }

      if (type === 'message' || (!type && typeof item['role'] === 'string')) {
        const rawRole = typeof item['role'] === 'string' ? item['role'] : 'user';
        const role = rawRole === 'system' || rawRole === 'developer'
          ? 'system'
          : rawRole === 'assistant'
            ? 'assistant'
            : rawRole === 'tool'
              ? 'tool'
              : 'user';
        const content = extractResponsesContentAsChat(item['content']);
        const msg: Record<string, unknown> = { role, content };
        if (role === 'tool' && typeof item['tool_call_id'] === 'string') {
          msg['tool_call_id'] = item['tool_call_id'];
        }
        messages.push(msg);
      }
    }
  }

  const requestedModel = typeof reqBody['model'] === 'string' && reqBody['model'].trim() ? reqBody['model'].trim() : null;
  const model = resolvedModel ?? requestedModel;
  const stream = Boolean(reqBody['stream']);
  const chatBody: Record<string, unknown> = {
    ...(model ? { model } : {}),
    messages,
    stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
  };

  chatBody['max_tokens'] = floorOutboundOutputTokens(reqBody['max_output_tokens'] ?? reqBody['max_tokens']);
  if (typeof reqBody['parallel_tool_calls'] === 'boolean') chatBody['parallel_tool_calls'] = reqBody['parallel_tool_calls'];
  if (reqBody['reasoning'] && typeof reqBody['reasoning'] === 'object' && !Array.isArray(reqBody['reasoning'])) {
    const effort = (reqBody['reasoning'] as Record<string, unknown>)['effort'];
    if (typeof effort === 'string' && effort) chatBody['reasoning_effort'] = effort;
  }
  for (const field of ['temperature', 'top_p', 'stop', 'user', 'metadata', 'prompt_cache_key'] as const) {
    if (reqBody[field] !== undefined) chatBody[field] = reqBody[field];
  }
  const tools = convertResponsesToolsToChat(reqBody['tools']);
  if (tools) {
    chatBody['tools'] = tools;
    const toolChoice = convertResponsesToolChoiceToChat(reqBody['tool_choice']);
    if (toolChoice !== undefined) chatBody['tool_choice'] = toolChoice;
  }
  return chatBody;
}

export function buildResponsesJsonFromChat(chat: Record<string, unknown>, fallbackModel: string | null): Record<string, unknown> {
  const respId = typeof chat['id'] === 'string' && chat['id'] ? chat['id'] : `resp_${randomUUID()}`;
  const model = typeof chat['model'] === 'string' && chat['model'] ? chat['model'] : (fallbackModel ?? 'unknown');
  const createdAt = typeof chat['created'] === 'number' ? chat['created'] : Math.floor(Date.now() / 1000);
  const choices = Array.isArray(chat['choices']) ? chat['choices'] : [];
  const firstChoice = choices[0] && typeof choices[0] === 'object' ? choices[0] as Record<string, unknown> : {};
  const message = firstChoice['message'] && typeof firstChoice['message'] === 'object' ? firstChoice['message'] as Record<string, unknown> : {};

  const text = extractChatMessageText(message['content']);
  const rawToolCalls = Array.isArray(message['tool_calls']) ? message['tool_calls'] : [];
  const output: Array<Record<string, unknown>> = [];

  if (text.length > 0) {
    output.push({
      id: `msg_${respId}_0`,
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text, annotations: [] }],
    });
  }

  for (const [i, rawTc] of rawToolCalls.entries()) {
    if (!rawTc || typeof rawTc !== 'object') continue;
    const tc = rawTc as Record<string, unknown>;
    const fn = tc['function'] && typeof tc['function'] === 'object' ? tc['function'] as Record<string, unknown> : {};
    const callId = typeof tc['id'] === 'string' && tc['id'] ? tc['id'] : `call_${respId}_${i}`;
    const fcId = callId.startsWith('fc_') ? callId : `fc_${callId}`;
    const name = typeof fn['name'] === 'string' ? fn['name'] : '';
    const args = typeof fn['arguments'] === 'string' ? fn['arguments'] : JSON.stringify(fn['arguments'] ?? {});
    output.push({
      id: fcId,
      type: 'function_call',
      status: 'completed',
      call_id: callId,
      name,
      arguments: args,
    });
  }

  const usage = extractTokenUsageDetails(chat['usage']);
  return {
    id: respId,
    object: 'response',
    created_at: createdAt,
    status: 'completed',
    model,
    output,
    output_text: text,
    usage: responsesUsagePayload(usage),
  };
}

function responsesUsagePayload(usage: TokenUsageDetails): Record<string, unknown> {
  return {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    total_tokens: usage.inputTokens + usage.outputTokens,
    ...(usage.cachedInputTokens > 0 ? { input_tokens_details: { cached_tokens: usage.cachedInputTokens } } : {}),
  };
}

async function streamChatToResponsesSse(
  res: ServerResponse,
  upstream: Response,
  fallbackModel: string | null,
  onChunk?: () => void,
): Promise<{ inputTokens: number; outputTokens: number } | null> {
  beginSseResponse(res, upstream.status, responseHeaders(upstream.headers));
  if (!upstream.body) { res.end(); return null; }

  let sequenceNumber = 0;
  let respId = `resp_${randomUUID()}`;
  let modelName = fallbackModel ?? 'unknown';
  const createdAt = Math.floor(Date.now() / 1000);
  let started = false;
  let finalized = false;
  let nextOutputIndex = 0;
  let textItemStarted = false;
  let textOutputIndex = -1;
  let textItemId = '';
  let textBuffer = '';

  type ToolState = {
    tcIndex: number;
    outputIndex: number;
    callId: string;
    fcId: string;
    name: string;
    arguments: string;
    addedEmitted: boolean;
    pendingArgs: string;
  };
  const toolCalls = new Map<number, ToolState>();
  let usageDetails: TokenUsageDetails = { inputTokens: 0, outputTokens: 0, freshInputTokens: 0, cachedInputTokens: 0 };

  const writeEvent = (event: string, data: Record<string, unknown>): void => {
    res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, sequence_number: sequenceNumber++, ...data })}\n\n`);
  };

  const ensureStarted = (): void => {
    if (started) return;
    started = true;
    const baseResponse = {
      id: respId,
      object: 'response',
      created_at: createdAt,
      status: 'in_progress',
      model: modelName,
      output: [],
      output_text: '',
      usage: responsesUsagePayload(usageDetails),
    };
    writeEvent('response.created', { response: baseResponse });
    writeEvent('response.in_progress', { response: baseResponse });
  };

  const emitToolAdded = (state: ToolState): void => {
    ensureStarted();
    writeEvent('response.output_item.added', {
      output_index: state.outputIndex,
      item: {
        id: state.fcId,
        type: 'function_call',
        status: 'in_progress',
        call_id: state.callId,
        name: state.name,
        arguments: '',
      },
    });
    state.addedEmitted = true;
    if (state.pendingArgs.length > 0) {
      state.arguments += state.pendingArgs;
      writeEvent('response.function_call_arguments.delta', {
        output_index: state.outputIndex,
        item_id: state.fcId,
        call_id: state.callId,
        delta: state.pendingArgs,
      });
      state.pendingArgs = '';
    }
  };

  const finalize = (): void => {
    if (finalized) return;
    finalized = true;
    ensureStarted();
    const completedEntries: Array<{ outputIndex: number; item: Record<string, unknown> }> = [];
    if (textItemStarted) {
      writeEvent('response.output_text.done', { output_index: textOutputIndex, item_id: textItemId, content_index: 0, text: textBuffer, logprobs: [] });
      writeEvent('response.content_part.done', { output_index: textOutputIndex, item_id: textItemId, content_index: 0, part: { type: 'output_text', text: textBuffer, annotations: [] } });
      const msgItem: Record<string, unknown> = {
        id: textItemId,
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: textBuffer, annotations: [] }],
      };
      writeEvent('response.output_item.done', { output_index: textOutputIndex, item: msgItem });
      completedEntries.push({ outputIndex: textOutputIndex, item: msgItem });
    }
    for (const tc of [...toolCalls.values()].sort((a, b) => a.outputIndex - b.outputIndex)) {
      if (!tc.addedEmitted) {
        if (!tc.name) tc.name = 'tool';
        emitToolAdded(tc);
      }
      writeEvent('response.function_call_arguments.done', { output_index: tc.outputIndex, item_id: tc.fcId, call_id: tc.callId, name: tc.name, arguments: tc.arguments });
      const fcItem: Record<string, unknown> = { id: tc.fcId, type: 'function_call', status: 'completed', call_id: tc.callId, name: tc.name, arguments: tc.arguments };
      writeEvent('response.output_item.done', { output_index: tc.outputIndex, item: fcItem });
      completedEntries.push({ outputIndex: tc.outputIndex, item: fcItem });
    }
    completedEntries.sort((a, b) => a.outputIndex - b.outputIndex);
    writeEvent('response.completed', {
      response: {
        id: respId,
        object: 'response',
        created_at: createdAt,
        status: 'completed',
        model: modelName,
        output: completedEntries.map((e) => e.item),
        output_text: textBuffer,
        usage: responsesUsagePayload(usageDetails),
      },
    });
    res.write('data: [DONE]\n\n');
  };

  try {
    const result = await consumeOpenAiSse(upstream.body, (parsed) => {
      if (parsed['error'] && typeof parsed['error'] === 'object') {
        finalized = true;
        res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: parsed['error'] })}\n\n`);
        res.write('data: [DONE]\n\n');
        return;
      }
      if (!started && typeof parsed['id'] === 'string' && parsed['id']) respId = parsed['id'];
      if (typeof parsed['model'] === 'string' && parsed['model']) modelName = parsed['model'];
      if (parsed['usage'] && typeof parsed['usage'] === 'object') {
        usageDetails = mergeUsageDetails(usageDetails, extractTokenUsageDetails(parsed['usage']));
      }

      const choices = Array.isArray(parsed['choices']) ? parsed['choices'] : [];
      const firstChoice = choices[0] && typeof choices[0] === 'object' ? choices[0] as Record<string, unknown> : null;
      const delta = firstChoice?.['delta'] && typeof firstChoice['delta'] === 'object' ? firstChoice['delta'] as Record<string, unknown> : null;
      if (!delta) return;

      if (extractChatReasoning(delta).length > 0) ensureStarted();

      const textDelta = typeof delta['content'] === 'string' ? delta['content'] : '';
      if (textDelta.length > 0) {
        ensureStarted();
        if (!textItemStarted) {
          textItemStarted = true;
          textOutputIndex = nextOutputIndex++;
          textItemId = `msg_${respId}_${textOutputIndex}`;
          writeEvent('response.output_item.added', {
            output_index: textOutputIndex,
            item: { id: textItemId, type: 'message', role: 'assistant', status: 'in_progress', content: [{ type: 'output_text', text: '', annotations: [] }] },
          });
          writeEvent('response.content_part.added', { output_index: textOutputIndex, item_id: textItemId, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
        }
        textBuffer += textDelta;
        writeEvent('response.output_text.delta', { output_index: textOutputIndex, item_id: textItemId, content_index: 0, delta: textDelta, logprobs: [] });
      }

      const deltaToolCalls = Array.isArray(delta['tool_calls']) ? delta['tool_calls'] : [];
      for (const rawTc of deltaToolCalls) {
        if (!rawTc || typeof rawTc !== 'object') continue;
        const tc = rawTc as Record<string, unknown>;
        const tcIndex = typeof tc['index'] === 'number' && Number.isFinite(tc['index']) ? Math.max(0, Math.floor(tc['index'])) : 0;
        const fn = tc['function'] && typeof tc['function'] === 'object' ? tc['function'] as Record<string, unknown> : {};
        const tcId = typeof tc['id'] === 'string' && tc['id'] ? tc['id'] : '';
        const tcName = typeof fn['name'] === 'string' && fn['name'] ? fn['name'] : '';
        const argsDelta = typeof fn['arguments'] === 'string' ? fn['arguments'] : '';

        let state = toolCalls.get(tcIndex);
        if (!state) {
          const callId = tcId || `call_${respId}_${tcIndex}`;
          state = {
            tcIndex,
            outputIndex: nextOutputIndex++,
            callId,
            fcId: callId.startsWith('fc_') ? callId : `fc_${callId}`,
            name: tcName,
            arguments: '',
            addedEmitted: false,
            pendingArgs: '',
          };
          toolCalls.set(tcIndex, state);
        } else {
          if (tcId && !state.addedEmitted) {
            state.callId = tcId;
            state.fcId = tcId.startsWith('fc_') ? tcId : `fc_${tcId}`;
          }
          if (tcName && !state.name) state.name = tcName;
        }

        if (!state.addedEmitted) {
          if (state.name) emitToolAdded(state);
          else if (argsDelta.length > 0) state.pendingArgs += argsDelta;
        }
        if (state.addedEmitted && argsDelta.length > 0) {
          state.arguments += argsDelta;
          writeEvent('response.function_call_arguments.delta', { output_index: state.outputIndex, item_id: state.fcId, call_id: state.callId, delta: argsDelta });
        }
      }
    }, onChunk);

    finalize();
    return result.usage ?? (usageDetails.inputTokens > 0 || usageDetails.outputTokens > 0
      ? { inputTokens: usageDetails.inputTokens, outputTokens: usageDetails.outputTokens }
      : null);
  } catch (err) {
    if (!finalized && !res.writableEnded) {
      const message = isTimeoutError(err) ? 'Torve Cloud stream timed out.' : 'Torve Cloud stream ended unexpectedly.';
      res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { message, type: 'torve_cloud_stream_error' } })}\n\n`);
      res.write('data: [DONE]\n\n');
    }
    return null;
  } finally {
    if (!res.writableEnded) res.end();
  }
}

async function handleResponsesRequest(
  res: ServerResponse,
  incomingHeaders: Record<string, string>,
  body: Uint8Array,
  apiKey: string,
  appId: string | null,
): Promise<{ status: number; resolvedModel: string | null; usage: { inputTokens: number; outputTokens: number } | null }> {
  const reqBody = parseJsonObjectBytes(body);
  if (!reqBody) {
    sendError(res, 400, 'Could not parse /v1/responses request JSON.');
    return { status: 400, resolvedModel: null, usage: null };
  }
  const requestedModel = typeof reqBody['model'] === 'string' && reqBody['model'].trim() ? reqBody['model'].trim() : null;
  const resolvedModel = await resolveModelForRequest(appId, requestedModel, apiKey);
  const stream = Boolean(reqBody['stream']);
  const chatBody = buildChatRequestFromResponses(reqBody, resolvedModel);
  const headers = jsonUpstreamHeaders(incomingHeaders, apiKey, appId, stream ? 'text/event-stream' : 'application/json');

  const fetchCtrl = createUpstreamFetchControl(res);
  try {
    const upstream = await fetch(`${torveCloudUpstream()}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(chatBody),
      signal: fetchCtrl.signal,
    });
    const streaming = Boolean(upstream.body && isSse(upstream.headers.get('content-type')));
    fetchCtrl.markHeadersReceived(streaming);
    if (streaming && upstream.body) {
      const usage = await streamChatToResponsesSse(res, upstream, resolvedModel ?? requestedModel, fetchCtrl.touchChunk);
      return { status: upstream.status, resolvedModel, usage };
    }
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (!upstream.ok) {
      const message = extractUpstreamErrorMessage(bytes, upstream.status);
      sendJson(res, upstream.status, { error: { message, type: 'torve_cloud_error' } });
      return { status: upstream.status, resolvedModel, usage: null };
    }
    const parsedChat = parseJsonObjectBytes(bytes);
    if (!parsedChat) {
      sendError(res, 502, 'Torve returned an invalid upstream response.');
      return { status: 502, resolvedModel, usage: null };
    }
    const usage = usageFromJson(bytes);
    const responsesPayload = buildResponsesJsonFromChat(parsedChat, resolvedModel ?? requestedModel);
    if (stream) {
      beginSseResponse(res, 200, responseHeaders(upstream.headers));
      let seq = 0;
      const writeSse = (event: string, data: Record<string, unknown>): void => {
        res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, sequence_number: seq++, ...data })}\n\n`);
      };
      const inProgress = { ...responsesPayload, status: 'in_progress', output: [], output_text: '' };
      writeSse('response.created', { response: inProgress });
      writeSse('response.in_progress', { response: inProgress });
      const output = Array.isArray(responsesPayload['output']) ? responsesPayload['output'] as Array<Record<string, unknown>> : [];
      for (const [idx, item] of output.entries()) {
        if (item['type'] === 'message') {
          const text = typeof responsesPayload['output_text'] === 'string' ? responsesPayload['output_text'] : '';
          writeSse('response.output_item.added', { output_index: idx, item: { ...item, status: 'in_progress', content: [{ type: 'output_text', text: '', annotations: [] }] } });
          writeSse('response.content_part.added', { output_index: idx, item_id: item['id'], content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
          if (text) writeSse('response.output_text.delta', { output_index: idx, item_id: item['id'], content_index: 0, delta: text, logprobs: [] });
          writeSse('response.output_text.done', { output_index: idx, item_id: item['id'], content_index: 0, text, logprobs: [] });
          writeSse('response.content_part.done', { output_index: idx, item_id: item['id'], content_index: 0, part: { type: 'output_text', text, annotations: [] } });
          writeSse('response.output_item.done', { output_index: idx, item });
        } else if (item['type'] === 'function_call') {
          const args = typeof item['arguments'] === 'string' ? item['arguments'] : '';
          writeSse('response.output_item.added', { output_index: idx, item: { ...item, status: 'in_progress', arguments: '' } });
          if (args) writeSse('response.function_call_arguments.delta', { output_index: idx, item_id: item['id'], call_id: item['call_id'], delta: args });
          writeSse('response.function_call_arguments.done', { output_index: idx, item_id: item['id'], call_id: item['call_id'], name: item['name'], arguments: args });
          writeSse('response.output_item.done', { output_index: idx, item });
        }
      }
      writeSse('response.completed', { response: responsesPayload });
      res.write('data: [DONE]\n\n');
      res.end();
      return { status: 200, resolvedModel, usage };
    }
    sendJson(res, upstream.status, responsesPayload);
    return { status: upstream.status, resolvedModel, usage };
  } finally {
    fetchCtrl.clear();
  }
}

async function handleResponsesCompact(
  res: ServerResponse,
  body: Uint8Array,
  incomingHeaders: Record<string, string>,
  apiKey: string,
  appId: string | null,
): Promise<{ status: number; resolvedModel: string | null; usage: { inputTokens: number; outputTokens: number } | null }> {
  const reqBody = parseJsonObjectBytes(body);
  if (!reqBody) {
    sendError(res, 400, 'Invalid JSON body for /v1/responses/compact.');
    return { status: 400, resolvedModel: null, usage: null };
  }
  const requestedModel = typeof reqBody['model'] === 'string' && reqBody['model'].trim() ? reqBody['model'].trim() : null;
  const effectiveModel = (await resolveModelForRequest(appId, requestedModel, apiKey)) ?? requestedModel;
  const forwardBody = effectiveModel && reqBody['model'] !== effectiveModel
    ? JSON.stringify({ ...reqBody, model: effectiveModel })
    : body;

  const compactCtrl = createUpstreamFetchControl(res);
  try {
    const nativeResp = await fetch(`${torveCloudUpstream()}/v1/responses/compact`, {
      method: 'POST',
      headers: jsonUpstreamHeaders(incomingHeaders, apiKey, appId, 'application/json'),
      body: forwardBody,
      signal: compactCtrl.signal,
    });
    compactCtrl.markHeadersReceived(false);
    if (nativeResp.ok) {
      const nativeBytes = new Uint8Array(await nativeResp.arrayBuffer());
      const parsed = parseJsonObjectBytes(nativeBytes);
      if (parsed) {
        sendJson(res, nativeResp.status, parsed);
        return { status: nativeResp.status, resolvedModel: effectiveModel, usage: usageFromJson(nativeBytes) };
      }
    } else {
      await nativeResp.body?.cancel().catch(() => {});
    }
  } catch { /* fall back to chat summarization */ } finally {
    compactCtrl.clear();
  }

  const chatBody = buildChatRequestFromResponses(reqBody, effectiveModel);
  const transcript = JSON.stringify(chatBody['messages'] ?? []);
  const chatCtrl = createUpstreamFetchControl(res);
  try {
    const chatResp = await fetch(`${torveCloudUpstream()}/v1/chat/completions`, {
      method: 'POST',
      headers: jsonUpstreamHeaders(incomingHeaders, apiKey, appId, 'application/json'),
      body: JSON.stringify({
        ...(effectiveModel ? { model: effectiveModel } : {}),
        stream: false,
        max_tokens: MIN_OUTPUT_TOKENS_FLOOR,
        messages: [
          {
            role: 'system',
            content: 'Compact this coding agent session into a concise summary preserving file paths, decisions, code symbols, outputs, and open tasks.',
          },
          { role: 'user', content: transcript },
        ],
      }),
      signal: chatCtrl.signal,
    });
    chatCtrl.markHeadersReceived(false);
    const bytes = new Uint8Array(await chatResp.arrayBuffer());
    if (!chatResp.ok) {
      const msg = extractUpstreamErrorMessage(bytes, chatResp.status);
      sendError(res, chatResp.status, msg);
      return { status: chatResp.status, resolvedModel: effectiveModel, usage: null };
    }
    const parsed = parseJsonObjectBytes(bytes);
    const choices = Array.isArray(parsed?.['choices']) ? parsed['choices'] as unknown[] : [];
    const msg = choices[0] && typeof choices[0] === 'object' ? (choices[0] as Record<string, unknown>)['message'] as Record<string, unknown> | undefined : undefined;
    const summary = msg ? (extractChatMessageText(msg['content']) || extractChatReasoning(msg)) : '';
    const u = extractTokenUsageDetails(parsed?.['usage']);
    sendJson(res, 200, {
      id: `cmp_${randomUUID()}`,
      object: 'response.compaction',
      created_at: Math.floor(Date.now() / 1000),
      output: [
        {
          id: `msg_${randomUUID()}`,
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: summary, annotations: [] }],
        },
      ],
      usage: { input_tokens: u.inputTokens, output_tokens: u.outputTokens, total_tokens: u.inputTokens + u.outputTokens },
    });
    return { status: 200, resolvedModel: effectiveModel, usage: { inputTokens: u.inputTokens, outputTokens: u.outputTokens } };
  } finally {
    chatCtrl.clear();
  }
}

// ---------------------------------------------------------------------------
// Anthropic Messages (/v1/messages)
// ---------------------------------------------------------------------------

function extractAnthropicText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((b) => (b && typeof b === 'object' && typeof (b as Record<string, unknown>)['text'] === 'string'
        ? (b as Record<string, string>)['text']
        : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

export function buildChatRequestFromAnthropic(
  reqBody: Record<string, unknown>,
  resolvedModel: string | null = null,
): Record<string, unknown> {
  const messages: Array<Record<string, unknown>> = [];
  const systemText = reqBody['system'] !== undefined ? extractAnthropicText(reqBody['system']) : '';
  if (systemText) messages.push({ role: 'system', content: systemText });

  const rawMessages = Array.isArray(reqBody['messages']) ? reqBody['messages'] : [];
  for (const raw of rawMessages) {
    if (!raw || typeof raw !== 'object') continue;
    const msg = raw as Record<string, unknown>;
    const role = msg['role'] === 'assistant' ? 'assistant' : 'user';
    const content = msg['content'];

    if (typeof content === 'string') {
      messages.push({ role, content });
      continue;
    }
    if (!Array.isArray(content)) continue;

    const textOrImageParts: Array<Record<string, unknown>> = [];
    let hasImage = false;
    const toolCalls: Array<Record<string, unknown>> = [];
    const toolResults: Array<Record<string, unknown>> = [];

    for (const rawBlock of content) {
      if (!rawBlock || typeof rawBlock !== 'object') continue;
      const block = rawBlock as Record<string, unknown>;
      const type = block['type'];
      if (type === 'text' && typeof block['text'] === 'string') {
        textOrImageParts.push({ type: 'text', text: block['text'] });
      } else if (type === 'image' && block['source'] && typeof block['source'] === 'object') {
        const src = block['source'] as Record<string, unknown>;
        if (src['type'] === 'base64' && typeof src['media_type'] === 'string' && typeof src['data'] === 'string') {
          hasImage = true;
          textOrImageParts.push({ type: 'image_url', image_url: { url: `data:${src['media_type']};base64,${src['data']}` } });
        } else if (src['type'] === 'url' && typeof src['url'] === 'string') {
          hasImage = true;
          textOrImageParts.push({ type: 'image_url', image_url: { url: src['url'] } });
        }
      } else if (role === 'assistant' && type === 'tool_use') {
        toolCalls.push({
          id: typeof block['id'] === 'string' && block['id'] ? block['id'] : `toolu_${randomUUID()}`,
          type: 'function',
          function: {
            name: typeof block['name'] === 'string' ? block['name'] : 'tool',
            arguments: typeof block['input'] === 'string' ? block['input'] : JSON.stringify(block['input'] ?? {}),
          },
        });
      } else if (role === 'user' && type === 'tool_result') {
        const callId = typeof block['tool_use_id'] === 'string' ? block['tool_use_id'] : '';
        const resultText = typeof block['content'] === 'string'
          ? block['content']
          : Array.isArray(block['content'])
            ? extractAnthropicText(block['content'])
            : JSON.stringify(block['content'] ?? '');
        if (callId) {
          toolResults.push({ role: 'tool', tool_call_id: callId, content: resultText });
        }
      }
    }

    for (const tr of toolResults) messages.push(tr);

    const renderedContent = hasImage
      ? textOrImageParts
      : textOrImageParts.map((p) => (typeof p['text'] === 'string' ? p['text'] : '')).join('\n');

    if (role === 'assistant' && toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: typeof renderedContent === 'string' && renderedContent.length === 0 ? null : renderedContent,
        tool_calls: toolCalls,
      });
    } else if ((typeof renderedContent === 'string' && renderedContent.length > 0) || (Array.isArray(renderedContent) && renderedContent.length > 0)) {
      messages.push({ role, content: renderedContent });
    }
  }

  const requestedModel = typeof reqBody['model'] === 'string' && reqBody['model'].trim() ? reqBody['model'].trim() : null;
  const model = resolvedModel ?? requestedModel;
  const stream = reqBody['stream'] === true;
  const chatBody: Record<string, unknown> = {
    ...(model ? { model } : {}),
    messages,
    stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
    max_tokens: floorOutboundOutputTokens(reqBody['max_tokens']),
  };
  if (typeof reqBody['temperature'] === 'number') chatBody['temperature'] = reqBody['temperature'];
  if (typeof reqBody['top_p'] === 'number') chatBody['top_p'] = reqBody['top_p'];
  if (Array.isArray(reqBody['stop_sequences'])) chatBody['stop'] = reqBody['stop_sequences'];

  if (Array.isArray(reqBody['tools']) && reqBody['tools'].length > 0) {
    const tools: Array<Record<string, unknown>> = [];
    for (const rawT of reqBody['tools']) {
      if (!rawT || typeof rawT !== 'object') continue;
      const t = rawT as Record<string, unknown>;
      if (typeof t['name'] !== 'string' || !t['name']) continue;
      tools.push({
        type: 'function',
        function: {
          name: t['name'],
          ...(typeof t['description'] === 'string' && t['description'] ? { description: t['description'] } : {}),
          parameters: t['input_schema'] && typeof t['input_schema'] === 'object' ? t['input_schema'] : { type: 'object', properties: {} },
        },
      });
    }
    if (tools.length > 0) {
      chatBody['tools'] = tools;
      const tc = reqBody['tool_choice'];
      if (tc && typeof tc === 'object' && !Array.isArray(tc)) {
        const choice = tc as Record<string, unknown>;
        if (choice['type'] === 'auto') chatBody['tool_choice'] = 'auto';
        else if (choice['type'] === 'none') chatBody['tool_choice'] = 'none';
        else if (choice['type'] === 'any') chatBody['tool_choice'] = 'required';
        else if (choice['type'] === 'tool' && typeof choice['name'] === 'string') {
          chatBody['tool_choice'] = { type: 'function', function: { name: choice['name'] } };
        }
      }
    }
  }
  return chatBody;
}

function mapOpenAiFinishReasonToAnthropic(reason: string | null, hadTools: boolean): string {
  if (reason === 'tool_calls' || reason === 'function_call') return 'tool_use';
  if (reason === 'length') return 'max_tokens';
  if (reason === 'stop') return 'end_turn';
  if (reason && reason.length > 0) return reason;
  return hadTools ? 'tool_use' : 'end_turn';
}

export function buildAnthropicJsonFromChat(chat: Record<string, unknown>, fallbackModel: string | null): Record<string, unknown> {
  const id = typeof chat['id'] === 'string' && chat['id'] ? chat['id'] : `msg_${randomUUID()}`;
  const model = typeof chat['model'] === 'string' && chat['model'] ? chat['model'] : (fallbackModel ?? 'unknown');
  const choices = Array.isArray(chat['choices']) ? chat['choices'] : [];
  const firstChoice = choices[0] && typeof choices[0] === 'object' ? choices[0] as Record<string, unknown> : {};
  const msg = firstChoice['message'] && typeof firstChoice['message'] === 'object' ? firstChoice['message'] as Record<string, unknown> : {};
  const text = extractChatMessageText(msg['content']);
  const toolCalls = Array.isArray(msg['tool_calls']) ? msg['tool_calls'] : [];
  const content: Array<Record<string, unknown>> = [];
  if (text.length > 0) content.push({ type: 'text', text });
  for (const [i, rawTc] of toolCalls.entries()) {
    if (!rawTc || typeof rawTc !== 'object') continue;
    const tc = rawTc as Record<string, unknown>;
    const fn = tc['function'] && typeof tc['function'] === 'object' ? tc['function'] as Record<string, unknown> : {};
    let parsedInput: Record<string, unknown> = {};
    if (typeof fn['arguments'] === 'string') {
      try { parsedInput = JSON.parse(fn['arguments']) as Record<string, unknown>; } catch { parsedInput = { raw: fn['arguments'] }; }
    } else if (fn['arguments'] && typeof fn['arguments'] === 'object') {
      parsedInput = fn['arguments'] as Record<string, unknown>;
    }
    content.push({
      type: 'tool_use',
      id: typeof tc['id'] === 'string' && tc['id'] ? tc['id'] : `toolu_${i + 1}`,
      name: typeof fn['name'] === 'string' ? fn['name'] : 'tool',
      input: parsedInput,
    });
  }
  const usage = extractTokenUsageDetails(chat['usage']);
  const finishReason = typeof firstChoice['finish_reason'] === 'string' ? firstChoice['finish_reason'] : null;
  return {
    id,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: mapOpenAiFinishReasonToAnthropic(finishReason, toolCalls.length > 0),
    stop_sequence: null,
    usage: {
      input_tokens: usage.freshInputTokens,
      output_tokens: usage.outputTokens,
      ...(usage.cachedInputTokens > 0 ? { cache_read_input_tokens: usage.cachedInputTokens } : {}),
    },
  };
}

async function streamChatToAnthropicSse(
  res: ServerResponse,
  upstream: Response,
  fallbackModel: string | null,
  onChunk?: () => void,
): Promise<{ inputTokens: number; outputTokens: number } | null> {
  beginSseResponse(res, upstream.status, responseHeaders(upstream.headers));
  if (!upstream.body) { res.end(); return null; }

  let messageId = `msg_${randomUUID()}`;
  let modelName = fallbackModel ?? 'unknown';
  let messageStarted = false;
  let finalized = false;
  let nextBlockIndex = 0;
  let activeBlockType: 'thinking' | 'text' | 'tool_use' | null = null;
  let activeBlockIndex = -1;
  let activeToolTcIndex = -1;
  let finishReason: string | null = null;
  let usageDetails: TokenUsageDetails = { inputTokens: 0, outputTokens: 0, freshInputTokens: 0, cachedInputTokens: 0 };

  type ToolBlockState = { blockIndex: number; id: string; name: string; started: boolean; closed: boolean; pendingArgs: string };
  const toolBlocks = new Map<number, ToolBlockState>();

  const writeEvent = (event: string, data: unknown): void => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const ensureMessageStart = (): void => {
    if (messageStarted) return;
    messageStarted = true;
    writeEvent('message_start', {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        model: modelName,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: usageDetails.freshInputTokens,
          output_tokens: 0,
          ...(usageDetails.cachedInputTokens > 0 ? { cache_read_input_tokens: usageDetails.cachedInputTokens } : {}),
        },
      },
    });
  };

  const closeActiveBlock = (): void => {
    if (activeBlockType === null) return;
    writeEvent('content_block_stop', { type: 'content_block_stop', index: activeBlockIndex });
    if (activeBlockType === 'tool_use') {
      const tb = toolBlocks.get(activeToolTcIndex);
      if (tb) tb.closed = true;
    }
    activeBlockType = null;
    activeBlockIndex = -1;
    activeToolTcIndex = -1;
  };

  const startToolBlock = (tcIndex: number, tb: ToolBlockState): void => {
    ensureMessageStart();
    closeActiveBlock();
    tb.blockIndex = nextBlockIndex++;
    tb.started = true;
    activeBlockType = 'tool_use';
    activeBlockIndex = tb.blockIndex;
    activeToolTcIndex = tcIndex;
    writeEvent('content_block_start', {
      type: 'content_block_start',
      index: tb.blockIndex,
      content_block: { type: 'tool_use', id: tb.id || `toolu_${tcIndex + 1}`, name: tb.name || 'tool', input: {} },
    });
    if (tb.pendingArgs.length > 0) {
      writeEvent('content_block_delta', {
        type: 'content_block_delta',
        index: tb.blockIndex,
        delta: { type: 'input_json_delta', partial_json: tb.pendingArgs },
      });
      tb.pendingArgs = '';
    }
  };

  const finalize = (): void => {
    if (finalized) return;
    finalized = true;
    ensureMessageStart();
    closeActiveBlock();
    for (const [tcIndex, tb] of [...toolBlocks.entries()].sort((a, b) => a[0] - b[0])) {
      if (!tb.started) startToolBlock(tcIndex, tb);
      if (!tb.closed) {
        writeEvent('content_block_stop', { type: 'content_block_stop', index: tb.blockIndex });
        tb.closed = true;
      }
    }
    writeEvent('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: mapOpenAiFinishReasonToAnthropic(finishReason, toolBlocks.size > 0), stop_sequence: null },
      usage: {
        output_tokens: usageDetails.outputTokens,
        ...(usageDetails.freshInputTokens > 0 ? { input_tokens: usageDetails.freshInputTokens } : {}),
        ...(usageDetails.cachedInputTokens > 0 ? { cache_read_input_tokens: usageDetails.cachedInputTokens } : {}),
      },
    });
    writeEvent('message_stop', { type: 'message_stop' });
  };

  try {
    const result = await consumeOpenAiSse(upstream.body, (parsed) => {
      if (parsed['error'] && typeof parsed['error'] === 'object') {
        finalized = true;
        const errObj = parsed['error'] as Record<string, unknown>;
        const msg = typeof errObj['message'] === 'string' ? sanitizeError(errObj['message']) : 'Upstream stream error.';
        writeEvent('error', { type: 'error', error: { type: 'api_error', message: msg } });
        return;
      }
      if (!messageStarted && typeof parsed['id'] === 'string' && parsed['id']) messageId = parsed['id'];
      if (typeof parsed['model'] === 'string' && parsed['model']) modelName = parsed['model'];
      if (parsed['usage'] && typeof parsed['usage'] === 'object') {
        usageDetails = mergeUsageDetails(usageDetails, extractTokenUsageDetails(parsed['usage']));
      }
      const choices = Array.isArray(parsed['choices']) ? parsed['choices'] : [];
      const firstChoice = choices[0] && typeof choices[0] === 'object' ? choices[0] as Record<string, unknown> : null;
      if (typeof firstChoice?.['finish_reason'] === 'string' && firstChoice['finish_reason']) finishReason = firstChoice['finish_reason'];
      const delta = firstChoice?.['delta'] && typeof firstChoice['delta'] === 'object' ? firstChoice['delta'] as Record<string, unknown> : null;
      if (!delta) return;

      const reasoning = extractChatReasoning(delta);
      if (reasoning.length > 0) {
        ensureMessageStart();
        if (activeBlockType !== 'thinking') {
          closeActiveBlock();
          activeBlockIndex = nextBlockIndex++;
          activeBlockType = 'thinking';
          writeEvent('content_block_start', { type: 'content_block_start', index: activeBlockIndex, content_block: { type: 'thinking', thinking: '' } });
        }
        writeEvent('content_block_delta', { type: 'content_block_delta', index: activeBlockIndex, delta: { type: 'thinking_delta', thinking: reasoning } });
      }

      const textDelta = typeof delta['content'] === 'string' ? delta['content'] : '';
      if (textDelta.length > 0) {
        ensureMessageStart();
        if (activeBlockType !== 'text') {
          closeActiveBlock();
          activeBlockIndex = nextBlockIndex++;
          activeBlockType = 'text';
          writeEvent('content_block_start', { type: 'content_block_start', index: activeBlockIndex, content_block: { type: 'text', text: '' } });
        }
        writeEvent('content_block_delta', { type: 'content_block_delta', index: activeBlockIndex, delta: { type: 'text_delta', text: textDelta } });
      }

      const deltaToolCalls = Array.isArray(delta['tool_calls']) ? delta['tool_calls'] : [];
      for (const rawTc of deltaToolCalls) {
        if (!rawTc || typeof rawTc !== 'object') continue;
        const tc = rawTc as Record<string, unknown>;
        const tcIndex = typeof tc['index'] === 'number' && Number.isFinite(tc['index']) ? Math.max(0, Math.floor(tc['index'])) : 0;
        const fn = tc['function'] && typeof tc['function'] === 'object' ? tc['function'] as Record<string, unknown> : {};
        const tcId = typeof tc['id'] === 'string' && tc['id'] ? tc['id'] : '';
        const tcName = typeof fn['name'] === 'string' && fn['name'] ? fn['name'] : '';
        const argsDelta = typeof fn['arguments'] === 'string' ? fn['arguments'] : '';

        let tb = toolBlocks.get(tcIndex);
        if (!tb) {
          tb = { blockIndex: -1, id: tcId || `toolu_${tcIndex + 1}`, name: tcName, started: false, closed: false, pendingArgs: '' };
          toolBlocks.set(tcIndex, tb);
        } else {
          if (tcId && !tb.started) tb.id = tcId;
          if (tcName && !tb.name) tb.name = tcName;
        }
        if (!tb.started) {
          if (tb.name) startToolBlock(tcIndex, tb);
          else if (argsDelta.length > 0) tb.pendingArgs += argsDelta;
        }
        if (tb.started && argsDelta.length > 0) {
          if (activeBlockType !== 'tool_use' || activeToolTcIndex !== tcIndex) {
            if (activeBlockType !== null) closeActiveBlock();
            activeBlockType = 'tool_use';
            activeBlockIndex = tb.blockIndex;
            activeToolTcIndex = tcIndex;
          }
          writeEvent('content_block_delta', { type: 'content_block_delta', index: tb.blockIndex, delta: { type: 'input_json_delta', partial_json: argsDelta } });
        }
      }
    }, onChunk);
    finalize();
    return result.usage ?? (usageDetails.inputTokens > 0 || usageDetails.outputTokens > 0
      ? { inputTokens: usageDetails.inputTokens, outputTokens: usageDetails.outputTokens }
      : null);
  } catch (err) {
    if (!finalized && !res.writableEnded) {
      const message = isTimeoutError(err) ? 'Torve Cloud stream timed out.' : 'Torve Cloud stream ended unexpectedly.';
      writeEvent('error', { type: 'error', error: { type: 'api_error', message } });
    }
    return null;
  } finally {
    if (!res.writableEnded) res.end();
  }
}

async function handleAnthropicMessagesRequest(
  res: ServerResponse,
  incomingHeaders: Record<string, string>,
  body: Uint8Array,
  apiKey: string,
  appId: string | null,
): Promise<{ status: number; resolvedModel: string | null; usage: { inputTokens: number; outputTokens: number } | null }> {
  const reqBody = parseJsonObjectBytes(body);
  if (!reqBody) {
    sendError(res, 400, 'Invalid JSON body for /v1/messages.');
    return { status: 400, resolvedModel: null, usage: null };
  }
  const requestedModel = typeof reqBody['model'] === 'string' && reqBody['model'].trim() ? reqBody['model'].trim() : null;
  const resolvedModel = await resolveModelForRequest(appId, requestedModel, apiKey);
  const stream = reqBody['stream'] === true;
  const chatBody = buildChatRequestFromAnthropic(reqBody, resolvedModel);
  const headers = jsonUpstreamHeaders(incomingHeaders, apiKey, appId, stream ? 'text/event-stream' : 'application/json');

  const fetchCtrl = createUpstreamFetchControl(res);
  try {
    const upstream = await fetch(`${torveCloudUpstream()}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(chatBody),
      signal: fetchCtrl.signal,
    });
    const streaming = Boolean(upstream.body && isSse(upstream.headers.get('content-type')));
    fetchCtrl.markHeadersReceived(streaming);
    if (streaming && upstream.body) {
      const usage = await streamChatToAnthropicSse(res, upstream, resolvedModel ?? requestedModel, fetchCtrl.touchChunk);
      return { status: upstream.status, resolvedModel, usage };
    }
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (!upstream.ok) {
      const message = extractUpstreamErrorMessage(bytes, upstream.status);
      sendJson(res, upstream.status, { type: 'error', error: { type: 'api_error', message } });
      return { status: upstream.status, resolvedModel, usage: null };
    }
    const parsedChat = parseJsonObjectBytes(bytes);
    if (!parsedChat) {
      sendError(res, 502, 'Torve returned an invalid upstream response.');
      return { status: 502, resolvedModel, usage: null };
    }
    sendJson(res, upstream.status, buildAnthropicJsonFromChat(parsedChat, resolvedModel ?? requestedModel));
    return { status: upstream.status, resolvedModel, usage: usageFromJson(bytes) };
  } finally {
    fetchCtrl.clear();
  }
}

// ---------------------------------------------------------------------------
// Gemini (/v1beta/models/... & /v1/models/...)
// ---------------------------------------------------------------------------

function isGeminiPath(reqPath: string): boolean {
  return /^\/v1(?:beta)?\/models\/[^/]+:(?:generateContent|streamGenerateContent)$/.test(reqPath);
}

async function handleGeminiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  reqPath: string,
  apiKey: string,
  appId: string | null,
): Promise<{ status: number; resolvedModel: string | null; usage: { inputTokens: number; outputTokens: number } | null }> {
  const rawBody = await readBody(req);
  const input = parseJsonObjectBytes(rawBody);
  const encodedModel = /^\/v1(?:beta)?\/models\/([^/:]+):/.exec(reqPath)?.[1] ?? 'torve';
  const requestedModel = decodeURIComponent(encodedModel);
  const model = (await resolveModelForRequest(appId, requestedModel, apiKey)) ?? requestedModel;
  const stream = reqPath.includes(':streamGenerateContent');
  if (!input) {
    sendError(res, 400, 'Invalid JSON body for Gemini endpoint.');
    return { status: 400, resolvedModel: model, usage: null };
  }
  const messages = geminiMessages(input);
  const tools = geminiTools(input);
  const genConfig = input['generationConfig'] && typeof input['generationConfig'] === 'object' && !Array.isArray(input['generationConfig'])
    ? input['generationConfig'] as Record<string, unknown>
    : null;
  const maxTokens = floorOutboundOutputTokens(genConfig?.['maxOutputTokens']);
  const fetchCtrl = createUpstreamFetchControl(res);
  try {
    const upstream = await fetch(`${torveCloudUpstream()}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        accept: stream ? 'text/event-stream' : 'application/json',
        'x-torve-client-app': sanitizeTorveClientApp(appId),
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        ...(tools ? { tools } : {}),
        stream,
        ...(stream ? { stream_options: { include_usage: true } } : {}),
      }),
      signal: fetchCtrl.signal,
    });
    const streaming = Boolean(stream && upstream.body && isSse(upstream.headers.get('content-type')));
    fetchCtrl.markHeadersReceived(streaming);
    if (!streaming || !upstream.body) {
      const upstreamBytes = new Uint8Array(await upstream.arrayBuffer());
      const payload = parseJsonObjectBytes(upstreamBytes);
      if (!upstream.ok) {
        if (payload) sendJson(res, upstream.status, payload);
        else sendError(res, upstream.status, extractUpstreamErrorMessage(upstreamBytes, upstream.status));
        return { status: upstream.status, resolvedModel: model, usage: null };
      }
      if (!payload) {
        sendError(res, 502, 'Torve returned an invalid response.');
        return { status: 502, resolvedModel: model, usage: null };
      }
      sendJson(res, upstream.status, openAiToGemini(payload));
      return { status: upstream.status, resolvedModel: model, usage: usageFromJson(upstreamBytes) };
    }

    beginSseResponse(res, upstream.status, responseHeaders(upstream.headers));
    const accumulatedTools = new Map<number, { name: string; arguments: string }>();
    let latestUsage: unknown = undefined;
    const flushTools = (finishReason: string | null): void => {
      if (accumulatedTools.size === 0) return;
      const parts: Array<Record<string, unknown>> = [];
      for (const [, tc] of [...accumulatedTools.entries()].sort((a, b) => a[0] - b[0])) {
        parts.push({ functionCall: { name: tc.name, args: safeJsonObj(tc.arguments) } });
      }
      accumulatedTools.clear();
      res.write(`data: ${JSON.stringify({
        candidates: [{ content: { role: 'model', parts }, ...(finishReason ? { finishReason: 'STOP' } : {}) }],
        usageMetadata: geminiUsage(latestUsage),
      })}\n\n`);
    };

    try {
      const result = await consumeOpenAiSse(upstream.body, (parsed) => {
        if (parsed['usage'] !== undefined) latestUsage = parsed['usage'];
        const choice = Array.isArray(parsed['choices']) ? parsed['choices'][0] as Record<string, unknown> | undefined : undefined;
        const delta = choice?.['delta'] && typeof choice['delta'] === 'object' ? choice['delta'] as Record<string, unknown> : {};
        const finishReason = typeof choice?.['finish_reason'] === 'string' && choice['finish_reason'] ? choice['finish_reason'] : null;

        const deltaToolCalls = Array.isArray(delta['tool_calls']) ? delta['tool_calls'] : [];
        for (const rawTc of deltaToolCalls) {
          if (!rawTc || typeof rawTc !== 'object') continue;
          const tc = rawTc as Record<string, unknown>;
          const idx = typeof tc['index'] === 'number' && Number.isFinite(tc['index']) ? Math.max(0, Math.floor(tc['index'])) : 0;
          const fn = tc['function'] && typeof tc['function'] === 'object' ? tc['function'] as Record<string, unknown> : {};
          const existing = accumulatedTools.get(idx) ?? { name: '', arguments: '' };
          const name = typeof fn['name'] === 'string' && fn['name'] ? fn['name'] : existing.name;
          const argsDelta = typeof fn['arguments'] === 'string' ? fn['arguments'] : '';
          accumulatedTools.set(idx, { name, arguments: existing.arguments + argsDelta });
        }

        const parts: Array<Record<string, unknown>> = [];
        const reasoning = extractChatReasoning(delta);
        if (reasoning) parts.push({ thought: true, text: reasoning });
        if (typeof delta['content'] === 'string' && delta['content'].length > 0) parts.push({ text: delta['content'] });
        if (finishReason && accumulatedTools.size > 0) {
          for (const [, tc] of [...accumulatedTools.entries()].sort((a, b) => a[0] - b[0])) {
            parts.push({ functionCall: { name: tc.name, args: safeJsonObj(tc.arguments) } });
          }
          accumulatedTools.clear();
        }
        if (parts.length > 0 || finishReason || parsed['usage'] !== undefined) {
          const candidate: Record<string, unknown> | null = (parts.length > 0 || finishReason)
            ? { content: { role: 'model', parts }, ...(finishReason ? { finishReason: 'STOP' } : {}) }
            : null;
          res.write(`data: ${JSON.stringify({
            candidates: candidate ? [candidate] : [],
            usageMetadata: geminiUsage(latestUsage ?? parsed['usage']),
          })}\n\n`);
        }
      }, fetchCtrl.touchChunk);
      flushTools('STOP');
      return { status: upstream.status, resolvedModel: model, usage: result.usage };
    } finally {
      if (!res.writableEnded) res.end();
    }
  } finally {
    fetchCtrl.clear();
  }
}

function geminiMessages(input: Record<string, unknown>): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [];
  const pendingCallIds = new Map<string, string[]>();
  let callSeq = 0;

  const system = input['systemInstruction'];
  if (system && typeof system === 'object') {
    const text = geminiText((system as Record<string, unknown>)['parts']);
    if (text) messages.push({ role: 'system', content: text });
  }
  for (const raw of Array.isArray(input['contents']) ? input['contents'] : []) {
    if (!raw || typeof raw !== 'object') continue;
    const content = raw as Record<string, unknown>;
    const rawRole = typeof content['role'] === 'string' ? content['role'] : 'user';
    const parts = Array.isArray(content['parts']) ? content['parts'] : [];
    const textChunks: string[] = [];
    const toolCalls: Array<Record<string, unknown>> = [];
    const toolResults: Array<Record<string, unknown>> = [];

    for (const rawPart of parts) {
      if (!rawPart || typeof rawPart !== 'object') continue;
      const part = rawPart as Record<string, unknown>;
      if (typeof part['text'] === 'string' && part['thought'] !== true) textChunks.push(part['text']);
      if (part['functionCall'] && typeof part['functionCall'] === 'object') {
        const fc = part['functionCall'] as Record<string, unknown>;
        const name = typeof fc['name'] === 'string' ? fc['name'] : '';
        const callId = typeof fc['id'] === 'string' && fc['id'] ? fc['id'] : `gemini_call_${++callSeq}`;
        const q = pendingCallIds.get(name) ?? [];
        q.push(callId);
        pendingCallIds.set(name, q);
        toolCalls.push({
          id: callId,
          type: 'function',
          function: { name, arguments: typeof fc['args'] === 'string' ? fc['args'] : JSON.stringify(fc['args'] ?? {}) },
        });
      }
      if (part['functionResponse'] && typeof part['functionResponse'] === 'object') {
        const fr = part['functionResponse'] as Record<string, unknown>;
        const name = typeof fr['name'] === 'string' ? fr['name'] : '';
        const queuedId = pendingCallIds.get(name)?.shift();
        const callId = (typeof fr['id'] === 'string' && fr['id'] ? fr['id'] : queuedId) ?? `gemini_call_${++callSeq}`;
        const responseVal = fr['response'];
        toolResults.push({
          role: 'tool',
          tool_call_id: callId,
          content: typeof responseVal === 'string' ? responseVal : JSON.stringify(responseVal ?? {}),
        });
      }
    }
    const joinedText = textChunks.join('');
    if (rawRole === 'model') {
      if (toolCalls.length > 0 || joinedText) {
        messages.push({ role: 'assistant', content: joinedText || null, ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}) });
      }
      continue;
    }
    for (const tr of toolResults) messages.push(tr);
    if (joinedText) messages.push({ role: 'user', content: joinedText });
  }
  return messages.length > 0 ? messages : [{ role: 'user', content: '' }];
}

function geminiText(parts: unknown): string {
  return (Array.isArray(parts) ? parts : [])
    .map((p) => (p && typeof p === 'object' && (p as Record<string, unknown>)['thought'] !== true && typeof (p as Record<string, unknown>)['text'] === 'string'
      ? (p as Record<string, string>)['text']
      : ''))
    .join('');
}

function geminiTools(input: Record<string, unknown>): Array<Record<string, unknown>> | undefined {
  const out: Array<Record<string, unknown>> = [];
  for (const group of Array.isArray(input['tools']) ? input['tools'] : []) {
    const decls = group && typeof group === 'object' ? (group as Record<string, unknown>)['functionDeclarations'] : undefined;
    for (const fn of Array.isArray(decls) ? decls : []) {
      if (fn && typeof fn === 'object') out.push({ type: 'function', function: fn });
    }
  }
  return out.length > 0 ? out : undefined;
}

function openAiToGemini(payload: Record<string, unknown>): Record<string, unknown> {
  const choice = Array.isArray(payload['choices']) ? payload['choices'][0] as Record<string, unknown> | undefined : undefined;
  const message = choice?.['message'] && typeof choice['message'] === 'object' ? choice['message'] as Record<string, unknown> : {};
  const delta = choice?.['delta'] && typeof choice['delta'] === 'object' ? choice['delta'] as Record<string, unknown> : {};
  const reasoning = extractChatReasoning(message) || extractChatReasoning(delta);
  const text = typeof message['content'] === 'string' ? message['content'] : typeof delta['content'] === 'string' ? delta['content'] : '';
  const tools = Array.isArray(message['tool_calls']) ? message['tool_calls'] : [];
  const parts: Array<Record<string, unknown>> = [];
  if (reasoning) parts.push({ thought: true, text: reasoning });
  if (text) parts.push({ text });
  for (const raw of tools) {
    const fn = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)['function'] : null;
    if (fn && typeof fn === 'object') parts.push({ functionCall: { name: (fn as Record<string, unknown>)['name'], args: safeJsonObj((fn as Record<string, unknown>)['arguments']) } });
  }
  return { candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }], usageMetadata: geminiUsage(payload['usage']) };
}

function safeJsonObj(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  try { return typeof value === 'string' ? JSON.parse(value) as Record<string, unknown> : {}; } catch { return {}; }
}

function geminiUsage(value: unknown): Record<string, number> {
  const u = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const prompt = typeof u['prompt_tokens'] === 'number' ? u['prompt_tokens'] : 0;
  const output = typeof u['completion_tokens'] === 'number' ? u['completion_tokens'] : 0;
  return { promptTokenCount: prompt, candidatesTokenCount: output, totalTokenCount: prompt + output };
}

// ---------------------------------------------------------------------------
// Shared extractors & usage persistence
// ---------------------------------------------------------------------------

function extractChatReasoning(record: Record<string, unknown>): string {
  if (typeof record['reasoning_content'] === 'string') return record['reasoning_content'];
  if (typeof record['reasoning'] === 'string') return record['reasoning'];
  return '';
}

function extractChatMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((p) => (p && typeof p === 'object' && typeof (p as Record<string, unknown>)['text'] === 'string' ? (p as Record<string, string>)['text'] : ''))
    .join('');
}

function extractTokenUsageDetails(rawUsage: unknown): TokenUsageDetails {
  if (!rawUsage || typeof rawUsage !== 'object' || Array.isArray(rawUsage)) {
    return { inputTokens: 0, outputTokens: 0, freshInputTokens: 0, cachedInputTokens: 0 };
  }
  const u = rawUsage as Record<string, unknown>;
  const inputRaw = Number(u['prompt_tokens'] ?? u['input_tokens'] ?? 0);
  const outputRaw = Number(u['completion_tokens'] ?? u['output_tokens'] ?? 0);
  const inputTokens = Number.isFinite(inputRaw) && inputRaw > 0 ? Math.floor(inputRaw) : 0;
  const outputTokens = Number.isFinite(outputRaw) && outputRaw > 0 ? Math.floor(outputRaw) : 0;
  const promptDetails = u['prompt_tokens_details'] && typeof u['prompt_tokens_details'] === 'object' ? u['prompt_tokens_details'] as Record<string, unknown> : {};
  const inputDetails = u['input_tokens_details'] && typeof u['input_tokens_details'] === 'object' ? u['input_tokens_details'] as Record<string, unknown> : {};
  const subsetCached = Number(promptDetails['cached_tokens'] ?? inputDetails['cached_tokens'] ?? 0);
  const separateCached = Number(u['cache_read_input_tokens'] ?? u['prompt_cache_hit_tokens'] ?? 0);
  const cachedInputTokens = Math.max(
    Number.isFinite(subsetCached) && subsetCached > 0 ? Math.floor(subsetCached) : 0,
    Number.isFinite(separateCached) && separateCached > 0 ? Math.floor(separateCached) : 0,
  );
  const hasSubsetShape = u['prompt_tokens'] !== undefined || inputDetails['cached_tokens'] !== undefined;
  const freshInputTokens = hasSubsetShape ? Math.max(0, inputTokens - cachedInputTokens) : inputTokens;
  const totalLogicalInput = hasSubsetShape ? inputTokens : inputTokens + cachedInputTokens;
  return { inputTokens: totalLogicalInput, outputTokens, freshInputTokens, cachedInputTokens };
}

function mergeUsageDetails(prev: TokenUsageDetails, next: TokenUsageDetails): TokenUsageDetails {
  return {
    inputTokens: next.inputTokens > 0 ? next.inputTokens : prev.inputTokens,
    outputTokens: next.outputTokens > 0 ? next.outputTokens : prev.outputTokens,
    freshInputTokens: next.freshInputTokens > 0 ? next.freshInputTokens : prev.freshInputTokens,
    cachedInputTokens: next.cachedInputTokens > 0 ? next.cachedInputTokens : prev.cachedInputTokens,
  };
}

function usageFromJson(body: Uint8Array): { inputTokens: number; outputTokens: number } | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
    const raw = parsed['usage'];
    if (!raw || typeof raw !== 'object') return null;
    const u = raw as Record<string, unknown>;
    const inp = Number(u['prompt_tokens'] ?? u['input_tokens'] ?? 0);
    const out = Number(u['completion_tokens'] ?? u['output_tokens'] ?? 0);
    return { inputTokens: Number.isFinite(inp) ? inp : 0, outputTokens: Number.isFinite(out) ? out : 0 };
  } catch {
    return null;
  }
}

function extractUpstreamErrorMessage(bytes: Uint8Array, statusCode: number): string {
  const parsed = parseJsonObjectBytes(bytes);
  const errObj = parsed?.['error'] && typeof parsed['error'] === 'object' ? parsed['error'] as Record<string, unknown> : null;
  const msg = typeof errObj?.['message'] === 'string'
    ? errObj['message']
    : typeof parsed?.['message'] === 'string'
      ? parsed['message']
      : new TextDecoder().decode(bytes).trim();
  return sanitizeError(msg || `Torve Cloud returned ${statusCode}.`);
}

function sanitizeError(message: string): string {
  return message.replace(/(?:sk|torve)_[A-Za-z0-9_-]{8,}/g, '[redacted]').slice(0, 240);
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'TimeoutError' || error.name === 'AbortError' || /timed?\s*out|timeout/i.test(error.message);
}

let usageWriteChain: Promise<void> = Promise.resolve();

function recordLocalUsage(event: {
  modelId: string;
  appId: string | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  timestampMs: number;
}): Promise<void> {
  const filePath = usageStatsPath();
  const hourKey = new Date(event.timestampMs).toISOString().slice(0, 13);
  const isoTime = new Date(event.timestampMs).toISOString();
  const appKey = sanitizeTorveClientApp(event.appId);
  const task = usageWriteChain.then(async () => {
    const existing = await readJsonFile<{ version?: number; buckets?: Record<string, { byModel: Record<string, unknown>; byApp: Record<string, unknown> }> }>(filePath);
    const buckets = existing?.version === 1 && existing.buckets && typeof existing.buckets === 'object' ? existing.buckets : {};
    const bucket = buckets[hourKey] ?? { byModel: {}, byApp: {} };
    const bump = (map: Record<string, unknown>, key: string) => {
      const cur = (map[key] && typeof map[key] === 'object' ? map[key] : null) as {
        requests: number; inputTokens: number; outputTokens: number; totalLatencyMs: number; lastUsedAt: string;
      } | null;
      if (cur) {
        cur.requests += 1;
        cur.inputTokens += event.inputTokens;
        cur.outputTokens += event.outputTokens;
        cur.totalLatencyMs += event.latencyMs;
        if (isoTime > cur.lastUsedAt) cur.lastUsedAt = isoTime;
      } else {
        map[key] = { requests: 1, inputTokens: event.inputTokens, outputTokens: event.outputTokens, totalLatencyMs: event.latencyMs, lastUsedAt: isoTime };
      }
    };
    bump(bucket.byModel, event.modelId);
    bump(bucket.byApp, appKey);
    buckets[hourKey] = bucket;
    await writeJsonAtomic(filePath, { version: 1, buckets });
  });
  usageWriteChain = task.catch(() => {});
  return task;
}
