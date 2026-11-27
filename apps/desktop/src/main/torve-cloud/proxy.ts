/**
 * Loopback-only direct Torve Cloud adapter. It deliberately has no TLS MITM
 * role: open-config clients point here directly, while closed/pinned apps keep
 * using their documented connection path or show an unsupported status.
 */
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import pathModule from 'node:path';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  detectRequestServiceApiProtocol,
  transformRequest,
  transformResponse,
  type SerializedHttpRequest,
  type SerializedHttpResponse,
  type ServiceApiProtocol,
} from '@torveai/api-adapter';
import { refreshTorveCloudModels, torveCloudModelsStatus, torveCloudUpstream, type TorveModel } from './models.js';
import { resolveDirectCloudModel } from './overrides.js';
import { handleAntigravityV1Internal } from './antigravity-v1internal.js';
import { modelsEndpointPayload } from './codex-catalog.js';
import { buildTorveUpstreamHeaders, extractTokenUsageFromRecord, recordLocalUsage, sanitizeTorveClientApp, SseUsageTracker } from './usage.js';

const require = createRequire(import.meta.url);

function isPackagedElectron(): boolean {
  try {
    if (typeof process === 'undefined' || !process.versions?.electron) return false;
    const electron = require('electron') as { app?: { isPackaged?: boolean } };
    return electron?.app?.isPackaged === true;
  } catch {
    return false;
  }
}

const DEFAULT_PORT = Number(process.env['TORVE_CLOUD_PROXY_PORT']) || 8378;
const MAX_BODY_BYTES = 64 * 1024 * 1024;
const UPSTREAM_REQUEST_TIMEOUT_MS = 120_000;
const MIN_CONTEXT_WINDOW_FLOOR = 1_000_000;
const MIN_OUTPUT_TOKENS_FLOOR = 32_768;
const LOW_OUTPUT_TOKENS_THRESHOLD = 8_192;
const HOP_BY_HOP = new Set(['connection', 'host', 'content-length', 'transfer-encoding', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'upgrade']);
const ANTIGRAVITY_DEBUG_PATH = pathModule.join(homedir(), '.torve', 'antigravity-proxy-debug.log');

export type DirectCloudProtocol = 'openai-chat' | 'openai-responses' | 'anthropic' | 'gemini' | 'antigravity-v1internal' | 'models' | 'unknown';
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

export type TorveCloudProxyOptions = {
  getApiKey?: () => Promise<string | null> | string | null;
  getModels?: (apiKey: string) => Promise<TorveModel[]>;
  resolveModel?: (appId: string | null, requestedModel: string | null, fallback: string | null) => Promise<string | null>;
  headerTimeoutMs?: number;
  streamIdleTimeoutMs?: number;
  recordUsage?: boolean;
  debugLog?: boolean;
};

type TokenUsageDetails = {
  inputTokens: number;
  outputTokens: number;
  freshInputTokens: number;
  cachedInputTokens: number;
};

class PayloadTooLargeError extends Error {
  constructor() {
    super('Request body exceeds the local proxy limit.');
    this.name = 'PayloadTooLargeError';
  }
}

let server: Server | null = null;
let activePort: number | null = null;
let activeOptions: TorveCloudProxyOptions = {};
const recentActivity: TorveCloudActivity[] = [];
let activitySink: ((activity: TorveCloudActivity) => void) | null = null;

export function setDirectCloudActivitySink(sink: ((activity: TorveCloudActivity) => void) | null): void { activitySink = sink; }
export function getDirectCloudActivity(): TorveCloudActivity[] { return [...recentActivity]; }
export function clearDirectCloudActivity(): void { recentActivity.length = 0; }

export function torveCloudProxyStatus(): { running: boolean; port: number; upstream: string; recentActivity: TorveCloudActivity[] } {
  return { running: Boolean(server?.listening), port: activePort ?? DEFAULT_PORT, upstream: torveCloudUpstream(), recentActivity: [...recentActivity] };
}

export async function startTorveCloudProxy(port = DEFAULT_PORT, options: TorveCloudProxyOptions = {}): Promise<void> {
  if (server?.listening && activePort === port && port !== 0) {
    activeOptions = options;
    return;
  }
  if (server) await stopTorveCloudProxy();
  activeOptions = options;
  server = createServer((req, res) => { void handle(req, res); });
  server.requestTimeout = 0;
  server.headersTimeout = resolveHeaderTimeoutMs();
  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));
  await new Promise<void>((resolve, reject) => {
    const listening = () => { server?.off('error', reject); resolve(); };
    server?.once('error', reject);
    server?.once('listening', listening);
    server?.listen(port, '127.0.0.1');
  });
  const address = server.address();
  activePort = address && typeof address === 'object' ? address.port : port;
  if (activeOptions.debugLog !== false) {
    await antigravityDebug({ event: 'proxy-start', port: activePort, timestamp: new Date().toISOString() });
  }
}

function resolveHeaderTimeoutMs(): number {
  const v = activeOptions.headerTimeoutMs;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : UPSTREAM_REQUEST_TIMEOUT_MS;
}

function resolveStreamIdleTimeoutMs(): number {
  const v = activeOptions.streamIdleTimeoutMs;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : UPSTREAM_REQUEST_TIMEOUT_MS;
}

type UpstreamFetchControl = {
  signal: AbortSignal;
  markHeadersReceived: (streaming: boolean) => void;
  touchChunk: () => void;
  clear: () => void;
};

/**
 * Splits upstream fetch deadlines into:
 *  1) initial connect/response-header timeout, cleared once headers arrive
 *  2) per-chunk SSE idle timeout that resets on every received chunk, so long
 *     reasoning + large file generation streams stay alive while active.
 */
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

export async function stopTorveCloudProxy(): Promise<void> {
  const running = server;
  server = null;
  activePort = null;
  activeOptions = {};
  if (!running?.listening) return;
  await new Promise<void>((resolve, reject) => running.close((err) => err ? reject(err) : resolve()));
}

async function resolveApiKey(): Promise<string | null> {
  if (activeOptions.getApiKey) return await activeOptions.getApiKey();
  try {
    const { getTorveCloudApiKey } = await import('../ipc/torve-account.js');
    return await getTorveCloudApiKey();
  } catch {
    return process.env['TORVE_CLOUD_API_KEY']?.trim() || null;
  }
}

async function resolveModelsCatalog(apiKey: string): Promise<TorveModel[]> {
  if (activeOptions.getModels) return await activeOptions.getModels(apiKey);
  const catalog = await torveCloudModelsStatus();
  return catalog.models.length > 0 ? catalog.models : await refreshTorveCloudModels(apiKey);
}

const LEGACY_MODEL_ALIASES: Readonly<Record<string, string>> = {
  'nemotron-3-nano-omni': 'nemotron-3-nano',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning': 'nemotron-3-nano',
  'ei/nvidia-nemotron-3-5-lightning-30b-a3b': 'nvidia/nemotron-3.5-lightning-30b-a3b-2',
  'ei/nvidia-nemotron-3-ultra-550b-a55b': 'nemotron-3-ultra',
  'ei/minimaxai-minimax-m3': 'minimax-m3-1-flash',
};

const PREFERRED_FALLBACK_MODELS = [
  'deepseek-v4-1-flash',
  'nemotron-3-ultra',
  'nemotron-3-nano',
  'qwen3.8-27b-2',
  'mistral-large-4',
  'gpt-oss-120b',
] as const;

function pickSafeFallbackModel(models: readonly TorveModel[], excludeModel?: string | null): string | null {
  const eligible = excludeModel ? models.filter((m) => m.id !== excludeModel) : models;
  if (eligible.length === 0) return null;
  for (const preferred of PREFERRED_FALLBACK_MODELS) {
    if (eligible.some((m) => m.id === preferred)) return preferred;
  }
  const nonTiny = eligible.find((m) => {
    if (m.id === 'auto') return false;
    const rawOut = finitePositiveNumber(m['max_output_tokens'] ?? m['max_tokens']);
    return rawOut === 0 || rawOut > LOW_OUTPUT_TOKENS_THRESHOLD;
  });
  if (nonTiny) return nonTiny.id;
  return eligible.find((m) => m.id !== 'auto')?.id ?? eligible[0]?.id ?? null;
}

async function resolveModelForRequest(appId: string | null, requestedModel: string | null, apiKey: string): Promise<string | null> {
  const models = activeOptions.getModels
    ? await activeOptions.getModels(apiKey)
    : (await torveCloudModelsStatus()).models;
  const fallback = models[0]?.id ?? null;
  if (activeOptions.resolveModel) {
    return await activeOptions.resolveModel(appId, requestedModel, fallback);
  }
  if (requestedModel && requestedModel !== 'torve' && requestedModel !== 'auto') {
    const mapped = LEGACY_MODEL_ALIASES[requestedModel];
    if (mapped && (models.length === 0 || models.some((m) => m.id === mapped))) {
      return mapped;
    }
    if (models.length > 0 && !models.some((m) => m.id === requestedModel)) {
      const safeFallback = pickSafeFallbackModel(models) ?? fallback;
      return await resolveDirectCloudModel(appId, null, safeFallback);
    }
  }
  return await resolveDirectCloudModel(appId, requestedModel, fallback);
}

function isLoopback(req: IncomingMessage): boolean {
  const address = req.socket.remoteAddress ?? '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const started = Date.now();
  const requestId = randomUUID();
  const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
  let rawPath = requestUrl.pathname;
  try { rawPath = decodeURIComponent(rawPath); } catch { /* malformed escapes fall through to the normal 404 */ }
  const scoped = scopedRequestPath(rawPath);
  let path = scoped.path;
  if (scoped.appId === 'claude-desktop') {
    if (path === '/messages') path = '/v1/messages';
    if (path === '/messages/count_tokens') path = '/v1/messages/count_tokens';
    if (path === '/models') path = '/v1/models';
  }
  const pathAndQuery = `${path}${requestUrl.search}`;
  const appId = scoped.appId;
  let requestedModel: string | null = null;
  let resolvedModel: string | null = null;
  let protocol: DirectCloudProtocol = protocolForPath(path);
  let stream = false;
  let usage: TorveCloudActivity['usage'] = null;
  let errorSummary: string | null = null;
  let antigravityInjectedModels = 0;
  let status = 500;
  try {
    if (!isLoopback(req)) { status = 403; errorSummary = 'Loopback connections only.'; return sendError(res, status, 'Direct Torve Cloud proxy only accepts loopback connections.'); }
    if (appId === 'antigravity' && path.startsWith('/v1internal')) {
      protocol = 'antigravity-v1internal';
      const catalog = await torveCloudModelsStatus();
      const outcome = await handleAntigravityV1Internal({
        method: req.method ?? 'POST',
        pathAndQuery,
        headers: requestHeaders(req),
        body: await readBody(req),
      }, {
        apiKey: await resolveApiKey(),
        models: catalog.models,
        torveUpstream: torveCloudUpstream(),
        debug: antigravityDebug,
      });
      requestedModel = outcome.meta.requestedModel;
      resolvedModel = outcome.meta.resolvedModel;
      stream = outcome.meta.stream;
      status = outcome.response.status;
      await sendFetchResponse(res, outcome.response);
      usage = outcome.meta.usage;
      antigravityInjectedModels = outcome.meta.injectedModels;
      if (!outcome.response.ok && outcome.meta.torveRouted) errorSummary = `Torve Cloud returned ${status}.`;
      return;
    }
    const apiKey = await resolveApiKey();
    if (!apiKey) { status = 401; errorSummary = 'Torve account is not connected.'; return sendError(res, status, 'Connect a Torve account in Torve Desktop first.'); }
    if (isPackagedElectron() && !apiKey.startsWith('sk-trv-')) {
      status = 401;
      errorSummary = 'Valid Torve Cloud API key required.';
      return sendError(res, status, 'Valid Torve Cloud credential (sk-trv-...) is required.');
    }
    if (req.method === 'GET' && path === '/v1/models') {
      const models = await resolveModelsCatalog(apiKey);
      // Guarantee a 1M token context floor and 32K output floor on every advertised model so
      // large-context coding agents never reject sessions or truncate at 1024 tokens.
      const modelsWithFloor = models.map((m) => {
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
      status = 200;
      return sendJson(res, 200, modelsEndpointPayload(modelsWithFloor, requestUrl.searchParams.get('client_version')));
    }
    if (req.method !== 'POST') { status = 404; errorSummary = 'Unsupported endpoint.'; return sendError(res, status, 'Unsupported Torve Cloud endpoint.'); }
    if (isGeminiPath(path)) {
      const outcome = await handleGeminiRequest(req, res, path, apiKey, appId);
      requestedModel = outcome.requestedModel;
      resolvedModel = outcome.resolvedModel;
      stream = outcome.stream;
      status = outcome.status;
      usage = outcome.usage;
      return;
    }
    const body = await readBody(req);
    const incoming: SerializedHttpRequest = { requestId, method: req.method, path, headers: requestHeaders(req), body };
    if (path === '/v1/responses/compact') {
      protocol = 'openai-responses';
      const outcome = await handleResponsesCompact(res, body, incoming.headers, apiKey, appId);
      requestedModel = outcome.requestedModel;
      resolvedModel = outcome.resolvedModel;
      status = outcome.status;
      usage = outcome.usage;
      errorSummary = outcome.errorSummary;
      return;
    }
    const source = detectRequestServiceApiProtocol(incoming);
    if (!source || !['anthropic-messages', 'openai-chat-completions', 'openai-responses'].includes(source)) {
      status = 501; errorSummary = 'Unsupported protocol.';
      return sendError(res, status, 'This local proxy currently supports OpenAI Chat/Responses and Anthropic Messages endpoints.');
    }
    protocol = protocolForService(source);
    if (source === 'openai-responses') {
      const outcome = await handleResponsesRequest(res, incoming.headers, body, apiKey, appId);
      requestedModel = outcome.requestedModel;
      resolvedModel = outcome.resolvedModel;
      stream = outcome.stream;
      status = outcome.status;
      usage = outcome.usage;
      errorSummary = outcome.errorSummary;
      return;
    }
    const target: ServiceApiProtocol = 'openai-chat-completions';
    const adapted = transformRequest(incoming, { from: source, to: target });
    if (!adapted) { status = 400; errorSummary = 'Request translation failed.'; return sendError(res, status, 'Could not translate this request.'); }
    requestedModel = adapted.requestedModel;
    stream = adapted.streamRequested;
    const routed = await resolveRoutedModel(adapted.request.body, appId, requestedModel, apiKey);
    resolvedModel = routed.model;
    const fetchCtrl = createUpstreamFetchControl(res);
    try {
      const upstream = await fetch(`${torveCloudUpstream()}${adapted.request.path}`, {
        method: 'POST',
        headers: upstreamHeaders(adapted.request.headers, apiKey, appId),
        body: routed.body,
        signal: fetchCtrl.signal,
      });
      status = upstream.status;
      const streaming = Boolean(upstream.body && isSse(upstream.headers.get('content-type')));
      fetchCtrl.markHeadersReceived(streaming);
      if (streaming && upstream.body) {
        if (source === 'anthropic-messages') {
          usage = await streamChatToAnthropicSse(res, upstream, resolvedModel ?? requestedModel, fetchCtrl.touchChunk);
          return;
        }
        usage = await pipeStreaming(res, upstream, fetchCtrl.touchChunk);
        return;
      }
      const upstreamBytes = new Uint8Array(await upstream.arrayBuffer());
      usage = usageFromJson(upstreamBytes);
      const response: SerializedHttpResponse = { requestId: incoming.requestId, statusCode: upstream.status, headers: responseHeaders(upstream.headers), body: upstreamBytes };
      const outgoing = transformResponse(response, { from: target, to: source, streamRequested: adapted.streamRequested, fallbackModel: requestedModel });
      if (!outgoing) { status = 502; errorSummary = 'Response translation failed.'; return sendError(res, status, 'Torve returned a response this client protocol cannot represent.'); }
      res.writeHead(outgoing.statusCode, outgoing.headers);
      res.end(outgoing.body);
    } finally {
      fetchCtrl.clear();
    }
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      status = 413;
      errorSummary = err.message;
      sendError(res, status, errorSummary);
      return;
    }
    const timedOut = isTimeoutError(err);
    status = timedOut ? 504 : 502;
    errorSummary = timedOut
      ? `Torve Cloud upstream timed out after ${UPSTREAM_REQUEST_TIMEOUT_MS / 1000} seconds.`
      : sanitizeError(err instanceof Error ? err.message : 'Torve Cloud request failed.');
    sendError(res, status, errorSummary);
  } finally {
    const latencyMs = Date.now() - started;
    const activity: TorveCloudActivity = { id: requestId, timestamp: started, appId, protocol, requestedModel, resolvedModel, statusCode: status, latencyMs, stream, usage, errorSummary };
    recentActivity.unshift(activity);
    recentActivity.splice(100);
    activitySink?.(activity);
    if (activeOptions.recordUsage !== false && status >= 200 && status < 300 && protocol !== 'models' && protocol !== 'unknown') {
      void recordLocalUsage({
        modelId: resolvedModel ?? requestedModel ?? 'auto',
        appId,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        latencyMs,
        timestampMs: started,
      }).catch(() => {});
    }
    if (activeOptions.debugLog !== false && rawPath.startsWith('/app/antigravity')) void antigravityDebug({
      event: 'request', method: req.method ?? null, url: `${rawPath}${requestUrl.search}`,
      contentEncoding: req.headers['content-encoding'] ?? null, statusCode: status,
      fetchAvailableModelsMatched: appId === 'antigravity' && path === '/v1internal:fetchAvailableModels',
      injectedModels: antigravityInjectedModels,
      timestamp: new Date().toISOString(),
    });
  }
}

async function antigravityDebug(record: Record<string, unknown>): Promise<void> {
  try { await mkdir(pathModule.dirname(ANTIGRAVITY_DEBUG_PATH), { recursive: true }); await appendFile(ANTIGRAVITY_DEBUG_PATH, `${JSON.stringify(record)}\n`, { mode: 0o600 }); }
  catch { /* diagnostics must never break the loopback proxy */ }
}

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

/** Pass through OpenAI Chat Completions SSE unbuffered with flush, idle-timeout reset, and [DONE] guarantee. */
async function pipeStreaming(res: ServerResponse, upstream: Response, onChunk?: () => void): Promise<TorveCloudActivity['usage']> {
  beginSseResponse(res, upstream.status, responseHeaders(upstream.headers));
  if (!upstream.body) { res.end(); return null; }
  const reader = upstream.body.getReader();
  const detector = new TextDecoder();
  const usageTracker = new SseUsageTracker();
  let tail = '';
  let sawDone = false;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      onChunk?.();
      usageTracker.push(next.value);
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
    try { await reader.cancel(); } catch { /* already closed */ }
    if (!res.writableEnded) res.end();
  }
  return usageTracker.finish();
}

/** Consume an upstream OpenAI Chat SSE stream chunk-by-chunk without buffering the full response. */
async function consumeOpenAiSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (parsed: Record<string, unknown>) => void,
  onChunk?: () => void,
): Promise<{ usage: TorveCloudActivity['usage']; sawDone: boolean }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const usageTracker = new SseUsageTracker();
  let pending = '';
  let sawDone = false;

  const processBlock = (block: string): boolean => {
    const dataLines: string[] = [];
    for (const rawLine of block.split(/\r?\n/)) {
      if (rawLine.startsWith('data:')) {
        dataLines.push(rawLine.slice(5).replace(/^ /, ''));
      }
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
    } catch {
      /* ignore malformed upstream SSE event */
    }
    return false;
  };

  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      onChunk?.();
      usageTracker.push(next.value);
      pending += decoder.decode(next.value, { stream: true });
      const blocks = pending.split(/\r?\n\r?\n/);
      pending = blocks.pop() ?? '';
      for (const block of blocks) {
        if (processBlock(block)) return { usage: usageTracker.finish(), sawDone: true };
      }
    }
    pending += decoder.decode();
    if (pending.trim()) processBlock(pending);
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
  }
  return { usage: usageTracker.finish(), sawDone };
}

// ---------------------------------------------------------------------------
// Direct OpenAI Responses (/v1/responses & /v1/responses/compact) handling
// ---------------------------------------------------------------------------

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringifyResponsesToolOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  if (output === undefined || output === null) return '';
  if (Array.isArray(output)) {
    const texts: string[] = [];
    let allText = true;
    for (const part of output) {
      if (isPlainObject(part) && typeof part['text'] === 'string') {
        texts.push(part['text']);
      } else {
        allText = false;
        break;
      }
    }
    if (allText) return texts.join('\n');
  }
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

type FlattenedToolCandidate = {
  originalName: string;
  namespacePath: string[];
  description?: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
  isCustom: boolean;
};

export type NormalizedResponsesTools = {
  tools: Array<Record<string, unknown>> | undefined;
  forwardedToOriginalName: Map<string, string>;
  originalToForwardedName: Map<string, string>;
  ambiguousOriginalNames: Set<string>;
  forwardedNames: Set<string>;
  customToolNames: Set<string>;
};

function sanitizeNamespaceSegment(segment: string): string {
  const cleaned = segment.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'ns';
}

function normalizeSchemaParameters(rawParams: unknown): Record<string, unknown> {
  if (isPlainObject(rawParams) && Object.keys(rawParams).length > 0) {
    return rawParams;
  }
  return { type: 'object', properties: {} };
}

function buildCustomToolParameters(name: string, description?: string): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      input: {
        type: 'string',
        description: description ?? `Input payload for ${name}.`,
      },
    },
    required: ['input'],
  };
}

function collectFlattenedResponsesTools(
  rawTools: unknown,
  namespacePath: string[],
  out: FlattenedToolCandidate[],
): void {
  if (!Array.isArray(rawTools)) return;
  for (const raw of rawTools) {
    if (!isPlainObject(raw)) continue;
    const type = typeof raw['type'] === 'string' ? raw['type'] : '';

    if (type === 'namespace') {
      const nsName = typeof raw['name'] === 'string' ? raw['name'].trim() : '';
      const nextPath = nsName ? [...namespacePath, nsName] : namespacePath;
      collectFlattenedResponsesTools(raw['tools'], nextPath, out);
      continue;
    }

    if (type === 'function') {
      const fnObj = isPlainObject(raw['function']) ? raw['function'] : null;
      const rawName = fnObj && fnObj['name'] !== undefined ? fnObj['name'] : raw['name'];
      const name = typeof rawName === 'string' ? rawName.trim() : '';
      if (!name) continue;

      const rawDesc = fnObj && fnObj['description'] !== undefined ? fnObj['description'] : raw['description'];
      const description = typeof rawDesc === 'string' && rawDesc.length > 0 ? rawDesc : undefined;
      const rawParams = fnObj && fnObj['parameters'] !== undefined ? fnObj['parameters'] : raw['parameters'];
      const rawStrict = fnObj && fnObj['strict'] !== undefined ? fnObj['strict'] : raw['strict'];

      out.push({
        originalName: name,
        namespacePath,
        ...(description !== undefined ? { description } : {}),
        parameters: normalizeSchemaParameters(rawParams),
        ...(typeof rawStrict === 'boolean' ? { strict: rawStrict } : {}),
        isCustom: false,
      });
      continue;
    }

    if (type === 'custom') {
      const name = typeof raw['name'] === 'string' ? raw['name'].trim() : '';
      if (!name) continue;
      const description = typeof raw['description'] === 'string' && raw['description'].length > 0
        ? raw['description']
        : undefined;

      out.push({
        originalName: name,
        namespacePath,
        ...(description !== undefined ? { description } : {}),
        parameters: buildCustomToolParameters(name, description),
        isCustom: true,
      });
      continue;
    }
    // Strip all Responses-only / unsupported built-in or unknown tool variants
    // (web_search, web_search_preview, local_shell, code_interpreter, file_search,
    // computer_use_preview, image_generation, mcp, etc.).
  }
}

export function convertResponsesToolsToChat(rawTools: unknown): NormalizedResponsesTools {
  const forwardedToOriginalName = new Map<string, string>();
  const originalToForwardedName = new Map<string, string>();
  const ambiguousOriginalNames = new Set<string>();
  const forwardedNames = new Set<string>();
  const customToolNames = new Set<string>();

  if (!Array.isArray(rawTools)) {
    return {
      tools: undefined,
      forwardedToOriginalName,
      originalToForwardedName,
      ambiguousOriginalNames,
      forwardedNames,
      customToolNames,
    };
  }

  const collected: FlattenedToolCandidate[] = [];
  collectFlattenedResponsesTools(rawTools, [], collected);

  // Deduplicate exact duplicates within the same namespace scope before checking cross-namespace collisions.
  const dedupedByScope: FlattenedToolCandidate[] = [];
  const seenScopeKeys = new Set<string>();
  const nameCounts = new Map<string, number>();

  for (const item of collected) {
    const scopeKey = `${item.namespacePath.join('\0')}\0${item.originalName}`;
    if (seenScopeKeys.has(scopeKey)) continue;
    seenScopeKeys.add(scopeKey);
    dedupedByScope.push(item);
    nameCounts.set(item.originalName, (nameCounts.get(item.originalName) ?? 0) + 1);
  }

  const out: Array<Record<string, unknown>> = [];
  for (const item of dedupedByScope) {
    const hasCollision = (nameCounts.get(item.originalName) ?? 0) > 1;
    let candidateName = item.originalName;
    if (hasCollision && item.namespacePath.length > 0) {
      const nsPrefix = item.namespacePath.map(sanitizeNamespaceSegment).join('__');
      candidateName = `${nsPrefix}__${item.originalName}`;
    }

    let forwardedName = candidateName;
    if (forwardedNames.has(forwardedName)) {
      if (item.namespacePath.length === 0) continue;
      let suffix = 2;
      while (forwardedNames.has(`${candidateName}_${suffix}`)) suffix++;
      forwardedName = `${candidateName}_${suffix}`;
    }

    forwardedNames.add(forwardedName);
    if (forwardedName !== item.originalName) {
      forwardedToOriginalName.set(forwardedName, item.originalName);
    }

    if (hasCollision) {
      ambiguousOriginalNames.add(item.originalName);
      if (item.namespacePath.length === 0) {
        originalToForwardedName.set(item.originalName, forwardedName);
      }
    } else {
      originalToForwardedName.set(item.originalName, forwardedName);
    }

    if (item.isCustom) {
      customToolNames.add(item.originalName);
      customToolNames.add(forwardedName);
    }

    out.push({
      type: 'function',
      function: {
        name: forwardedName,
        ...(item.description !== undefined ? { description: item.description } : {}),
        parameters: item.parameters,
        ...(item.strict !== undefined ? { strict: item.strict } : {}),
      },
    });
  }

  return {
    tools: out.length > 0 ? out : undefined,
    forwardedToOriginalName,
    originalToForwardedName,
    ambiguousOriginalNames,
    forwardedNames,
    customToolNames,
  };
}

function resolveToolChoiceName(
  rawName: unknown,
  namespaceHint: unknown,
  toolMap: NormalizedResponsesTools,
): string | undefined {
  if (typeof rawName !== 'string') return undefined;
  const trimmed = rawName.trim();
  if (!trimmed) return undefined;

  if (typeof namespaceHint === 'string' && namespaceHint.trim()) {
    const qualified = `${sanitizeNamespaceSegment(namespaceHint.trim())}__${trimmed}`;
    if (toolMap.forwardedNames.has(qualified)) return qualified;
  }

  if (toolMap.forwardedNames.has(trimmed)) return trimmed;
  if (!toolMap.ambiguousOriginalNames.has(trimmed)) {
    const mapped = toolMap.originalToForwardedName.get(trimmed);
    if (mapped && toolMap.forwardedNames.has(mapped)) return mapped;
  }
  return undefined;
}

function convertResponsesToolChoiceToChat(rawChoice: unknown, toolMap: NormalizedResponsesTools): unknown {
  if (!toolMap.tools || toolMap.tools.length === 0) return undefined;

  if (typeof rawChoice === 'string') {
    return rawChoice === 'auto' || rawChoice === 'none' || rawChoice === 'required' ? rawChoice : undefined;
  }
  if (!isPlainObject(rawChoice)) return undefined;

  const choiceType = typeof rawChoice['type'] === 'string' ? rawChoice['type'] : '';
  if (choiceType === 'function' || choiceType === 'custom') {
    const fnObj = isPlainObject(rawChoice['function']) ? rawChoice['function'] : null;
    const rawName = fnObj && fnObj['name'] !== undefined ? fnObj['name'] : rawChoice['name'];
    const mappedName = resolveToolChoiceName(rawName, rawChoice['namespace'], toolMap);
    return mappedName ? { type: 'function', function: { name: mappedName } } : undefined;
  }

  if (choiceType === 'allowed_tools') {
    const allowed = Array.isArray(rawChoice['tools']) ? rawChoice['tools'] : [];
    const keptNames: string[] = [];
    for (const entry of allowed) {
      if (!isPlainObject(entry)) continue;
      const entryType = typeof entry['type'] === 'string' ? entry['type'] : '';
      if (entryType !== 'function' && entryType !== 'custom') continue;
      const fnObj = isPlainObject(entry['function']) ? entry['function'] : null;
      const rawName = fnObj && fnObj['name'] !== undefined ? fnObj['name'] : entry['name'];
      const mapped = resolveToolChoiceName(rawName, entry['namespace'], toolMap);
      if (mapped && !keptNames.includes(mapped)) keptNames.push(mapped);
    }
    if (keptNames.length === 1) {
      return { type: 'function', function: { name: keptNames[0] } };
    }
    if (keptNames.length > 1) {
      return rawChoice['mode'] === 'required' ? 'required' : 'auto';
    }
    return undefined;
  }

  return undefined;
}

function normalizeOutboundToolArguments(rawArgs: unknown, isCustom: boolean): string {
  if (isCustom) {
    if (typeof rawArgs === 'string') {
      try {
        const parsed = JSON.parse(rawArgs) as unknown;
        if (isPlainObject(parsed) && 'input' in parsed) {
          return rawArgs;
        }
      } catch {
        /* raw freeform custom tool input — wrap below */
      }
      return JSON.stringify({ input: rawArgs });
    }
    if (isPlainObject(rawArgs) && 'input' in rawArgs) {
      return JSON.stringify(rawArgs);
    }
    return JSON.stringify({
      input: rawArgs === undefined || rawArgs === null ? '' : stringifyResponsesToolOutput(rawArgs),
    });
  }

  if (typeof rawArgs === 'string') {
    return rawArgs.length > 0 ? rawArgs : '{}';
  }
  return JSON.stringify(rawArgs ?? {});
}

function buildChatRequestWithMappingFromResponses(
  reqBody: Record<string, unknown>,
  resolvedModel: string | null = null,
): { chatBody: Record<string, unknown>; toolMap: NormalizedResponsesTools } {
  const toolMap = convertResponsesToolsToChat(reqBody['tools']);
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
        const rawName = typeof item['name'] === 'string' ? item['name'].trim() : '';
        const resolvedName = resolveToolChoiceName(rawName, item['namespace'], toolMap) ?? rawName;
        const isCustom = type === 'custom_tool_call'
          || toolMap.customToolNames.has(rawName)
          || toolMap.customToolNames.has(resolvedName);
        const rawArgs = type === 'custom_tool_call'
          ? (item['input'] !== undefined ? item['input'] : item['arguments'])
          : item['arguments'];
        const args = normalizeOutboundToolArguments(rawArgs, isCustom);
        const toolCall = { id: callId, type: 'function', function: { name: resolvedName, arguments: args } };
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
  if (toolMap.tools) {
    chatBody['tools'] = toolMap.tools;
    const toolChoice = convertResponsesToolChoiceToChat(reqBody['tool_choice'], toolMap);
    if (toolChoice !== undefined) chatBody['tool_choice'] = toolChoice;
  }
  return { chatBody, toolMap };
}

/** Translate an OpenAI Responses API request directly to OpenAI Chat Completions without injecting synthetic tools. */
export function buildChatRequestFromResponses(
  reqBody: Record<string, unknown>,
  resolvedModel: string | null = null,
): Record<string, unknown> {
  return buildChatRequestWithMappingFromResponses(reqBody, resolvedModel).chatBody;
}

export function buildResponsesJsonFromChat(
  chat: Record<string, unknown>,
  fallbackModel: string | null,
  toolNameAliases?: ReadonlyMap<string, string>,
): Record<string, unknown> {
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
    const rawName = typeof fn['name'] === 'string' ? fn['name'] : '';
    const name = rawName ? (toolNameAliases?.get(rawName) ?? rawName) : '';
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
    usage: {
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      total_tokens: usage.inputTokens + usage.outputTokens,
      ...(usage.cachedInputTokens > 0 ? { input_tokens_details: { cached_tokens: usage.cachedInputTokens } } : {}),
    },
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
  toolNameAliases?: ReadonlyMap<string, string>,
): Promise<TorveCloudActivity['usage']> {
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
      writeEvent('response.output_text.done', {
        output_index: textOutputIndex,
        item_id: textItemId,
        content_index: 0,
        text: textBuffer,
        logprobs: [],
      });
      writeEvent('response.content_part.done', {
        output_index: textOutputIndex,
        item_id: textItemId,
        content_index: 0,
        part: { type: 'output_text', text: textBuffer, annotations: [] },
      });
      const messageItem: Record<string, unknown> = {
        id: textItemId,
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: textBuffer, annotations: [] }],
      };
      writeEvent('response.output_item.done', { output_index: textOutputIndex, item: messageItem });
      completedEntries.push({ outputIndex: textOutputIndex, item: messageItem });
    }

    const sortedTools = [...toolCalls.values()].sort((a, b) => a.outputIndex - b.outputIndex);
    for (const tc of sortedTools) {
      if (!tc.addedEmitted) {
        if (!tc.name) tc.name = 'tool';
        emitToolAdded(tc);
      }
      writeEvent('response.function_call_arguments.done', {
        output_index: tc.outputIndex,
        item_id: tc.fcId,
        call_id: tc.callId,
        name: tc.name,
        arguments: tc.arguments,
      });
      const fcItem: Record<string, unknown> = {
        id: tc.fcId,
        type: 'function_call',
        status: 'completed',
        call_id: tc.callId,
        name: tc.name,
        arguments: tc.arguments,
      };
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
        output: completedEntries.map((entry) => entry.item),
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
      const delta = firstChoice?.['delta'] && typeof firstChoice['delta'] === 'object'
        ? firstChoice['delta'] as Record<string, unknown>
        : null;
      if (!delta) return;

      const reasoning = extractChatReasoning(delta);
      if (reasoning.length > 0) {
        ensureStarted();
      }

      const textDelta = typeof delta['content'] === 'string' ? delta['content'] : '';
      if (textDelta.length > 0) {
        ensureStarted();
        if (!textItemStarted) {
          textItemStarted = true;
          textOutputIndex = nextOutputIndex++;
          textItemId = `msg_${respId}_${textOutputIndex}`;
          writeEvent('response.output_item.added', {
            output_index: textOutputIndex,
            item: {
              id: textItemId,
              type: 'message',
              role: 'assistant',
              status: 'in_progress',
              content: [{ type: 'output_text', text: '', annotations: [] }],
            },
          });
          writeEvent('response.content_part.added', {
            output_index: textOutputIndex,
            item_id: textItemId,
            content_index: 0,
            part: { type: 'output_text', text: '', annotations: [] },
          });
        }
        textBuffer += textDelta;
        writeEvent('response.output_text.delta', {
          output_index: textOutputIndex,
          item_id: textItemId,
          content_index: 0,
          delta: textDelta,
          logprobs: [],
        });
      }

      const deltaToolCalls = Array.isArray(delta['tool_calls']) ? delta['tool_calls'] : [];
      for (const rawTc of deltaToolCalls) {
        if (!rawTc || typeof rawTc !== 'object') continue;
        const tc = rawTc as Record<string, unknown>;
        const tcIndex = typeof tc['index'] === 'number' && Number.isFinite(tc['index'])
          ? Math.max(0, Math.floor(tc['index']))
          : 0;
        const fn = tc['function'] && typeof tc['function'] === 'object'
          ? tc['function'] as Record<string, unknown>
          : {};
        const tcId = typeof tc['id'] === 'string' && tc['id'] ? tc['id'] : '';
        const rawTcName = typeof fn['name'] === 'string' && fn['name'] ? fn['name'] : '';
        const tcName = rawTcName ? (toolNameAliases?.get(rawTcName) ?? rawTcName) : '';
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
          if (tcName && !state.name) {
            state.name = tcName;
          }
        }

        if (!state.addedEmitted) {
          if (state.name) {
            emitToolAdded(state);
          } else if (argsDelta.length > 0) {
            state.pendingArgs += argsDelta;
          }
        }

        if (state.addedEmitted && argsDelta.length > 0) {
          state.arguments += argsDelta;
          writeEvent('response.function_call_arguments.delta', {
            output_index: state.outputIndex,
            item_id: state.fcId,
            call_id: state.callId,
            delta: argsDelta,
          });
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
): Promise<{ status: number; requestedModel: string | null; resolvedModel: string | null; stream: boolean; usage: TorveCloudActivity['usage']; errorSummary: string | null }> {
  const reqBody = parseJsonObjectBytes(body);
  if (!reqBody) {
    sendError(res, 400, 'Could not translate this request.');
    return { status: 400, requestedModel: null, resolvedModel: null, stream: false, usage: null, errorSummary: 'Request translation failed.' };
  }
  const requestedModel = typeof reqBody['model'] === 'string' && reqBody['model'].trim() ? reqBody['model'].trim() : null;
  let resolvedModel = await resolveModelForRequest(appId, requestedModel, apiKey);
  const stream = Boolean(reqBody['stream']);
  let adaptedReq = buildChatRequestWithMappingFromResponses(reqBody, resolvedModel);
  const headers = jsonUpstreamHeaders(incomingHeaders, apiKey, appId, stream ? 'text/event-stream' : 'application/json');

  const fetchCtrl = createUpstreamFetchControl(res);
  try {
    let upstream = await fetch(`${torveCloudUpstream()}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(adaptedReq.chatBody),
      signal: fetchCtrl.signal,
    });
    if (!upstream.ok && upstream.status === 403 && !isSse(upstream.headers.get('content-type'))) {
      const catalog = activeOptions.getModels
        ? await activeOptions.getModels(apiKey)
        : (await torveCloudModelsStatus()).models;
      const retryModel = pickSafeFallbackModel(catalog, resolvedModel);
      if (retryModel) {
        await upstream.body?.cancel().catch(() => {});
        resolvedModel = retryModel;
        adaptedReq = buildChatRequestWithMappingFromResponses(reqBody, resolvedModel);
        upstream = await fetch(`${torveCloudUpstream()}/v1/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(adaptedReq.chatBody),
          signal: fetchCtrl.signal,
        });
      }
    }
    const { toolMap } = adaptedReq;
    const streaming = Boolean(upstream.body && isSse(upstream.headers.get('content-type')));
    fetchCtrl.markHeadersReceived(streaming);

    if (streaming && upstream.body) {
      const usage = await streamChatToResponsesSse(
        res,
        upstream,
        resolvedModel ?? requestedModel,
        fetchCtrl.touchChunk,
        toolMap.forwardedToOriginalName,
      );
      return { status: upstream.status, requestedModel, resolvedModel, stream, usage, errorSummary: upstream.ok ? null : `Torve Cloud returned ${upstream.status}.` };
    }

    const upstreamBytes = new Uint8Array(await upstream.arrayBuffer());
    if (!upstream.ok) {
      const message = extractUpstreamErrorMessage(upstreamBytes, upstream.status);
      sendJson(res, upstream.status, { error: { message, type: 'torve_cloud_error' } });
      return { status: upstream.status, requestedModel, resolvedModel, stream, usage: null, errorSummary: message };
    }

    const parsedChat = parseJsonObjectBytes(upstreamBytes);
    if (!parsedChat) {
      sendError(res, 502, 'Torve returned a response this client protocol cannot represent.');
      return { status: 502, requestedModel, resolvedModel, stream, usage: null, errorSummary: 'Response translation failed.' };
    }
    const usage = usageFromJson(upstreamBytes);
    const responsesPayload = buildResponsesJsonFromChat(
      parsedChat,
      resolvedModel ?? requestedModel,
      toolMap.forwardedToOriginalName,
    );

    if (stream) {
      // Upstream ignored stream:true and returned 200 JSON; emit valid Responses SSE events.
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
          writeSse('response.output_item.added', { output_index: idx, item: { ...item, status: 'in_progress', content: [{ type: 'output_text', text: '', annotations: [] }] } });
          writeSse('response.content_part.added', { output_index: idx, item_id: item['id'], content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
          const text = typeof responsesPayload['output_text'] === 'string' ? responsesPayload['output_text'] : '';
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
      return { status: 200, requestedModel, resolvedModel, stream, usage, errorSummary: null };
    }

    sendJson(res, upstream.status, responsesPayload);
    return { status: upstream.status, requestedModel, resolvedModel, stream, usage, errorSummary: null };
  } finally {
    fetchCtrl.clear();
  }
}

function formatCompactTranscript(reqBody: Record<string, unknown>): string {
  const lines: string[] = [];
  if (typeof reqBody['instructions'] === 'string' && reqBody['instructions'].trim()) {
    lines.push(`System instructions:\n${reqBody['instructions'].trim()}`);
  }
  const input = reqBody['input'];
  if (typeof input === 'string' && input.trim()) {
    lines.push(`user: ${input.trim()}`);
  } else if (Array.isArray(input)) {
    for (const rawItem of input) {
      if (typeof rawItem === 'string') {
        lines.push(`user: ${rawItem}`);
        continue;
      }
      if (!rawItem || typeof rawItem !== 'object') continue;
      const item = rawItem as Record<string, unknown>;
      const type = typeof item['type'] === 'string' ? item['type'] : '';
      if (type === 'function_call' || type === 'custom_tool_call') {
        const name = typeof item['name'] === 'string' ? item['name'] : 'tool';
        const args = typeof item['arguments'] === 'string' ? item['arguments'] : JSON.stringify(item['arguments'] ?? item['input'] ?? {});
        lines.push(`assistant [tool_call ${name}]: ${args}`);
        continue;
      }
      if (type === 'function_call_output' || type === 'custom_tool_call_output') {
        const callId = typeof item['call_id'] === 'string' ? item['call_id'] : '';
        lines.push(`tool_result (${callId}): ${stringifyResponsesToolOutput(item['output'])}`);
        continue;
      }
      if (type === 'message' || (!type && typeof item['role'] === 'string')) {
        const role = typeof item['role'] === 'string' ? item['role'] : 'user';
        const content = extractResponsesContentAsChat(item['content']);
        const text = typeof content === 'string'
          ? content
          : content.map((p) => (typeof p['text'] === 'string' ? p['text'] : '[image]')).join('\n');
        if (text.trim()) lines.push(`${role}: ${text.trim()}`);
      }
    }
  }
  return lines.join('\n\n') || 'Empty session.';
}

async function handleResponsesCompact(
  res: ServerResponse,
  body: Uint8Array,
  incomingHeaders: Record<string, string>,
  apiKey: string,
  appId: string | null,
): Promise<{ status: number; requestedModel: string | null; resolvedModel: string | null; usage: TorveCloudActivity['usage']; errorSummary: string | null }> {
  const reqBody = parseJsonObjectBytes(body);
  if (!reqBody) {
    sendError(res, 400, 'Invalid JSON request body for /v1/responses/compact.');
    return { status: 400, requestedModel: null, resolvedModel: null, usage: null, errorSummary: 'Invalid compaction payload.' };
  }
  const requestedModel = typeof reqBody['model'] === 'string' && reqBody['model'].trim() ? reqBody['model'].trim() : null;
  const resolvedModel = await resolveModelForRequest(appId, requestedModel, apiKey);
  const effectiveModel = resolvedModel ?? requestedModel;
  const forwardBody = effectiveModel && reqBody['model'] !== effectiveModel
    ? JSON.stringify({ ...reqBody, model: effectiveModel })
    : body;

  // 1) Try native upstream /v1/responses/compact first.
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
        return {
          status: nativeResp.status,
          requestedModel,
          resolvedModel: effectiveModel,
          usage: usageFromJson(nativeBytes),
          errorSummary: null,
        };
      }
    } else {
      await nativeResp.body?.cancel().catch(() => {});
    }
  } catch {
    /* Fall back to Chat Completions summarization when native compaction is unavailable */
  } finally {
    compactCtrl.clear();
  }

  // 2) Fallback: summarize cleanly via /v1/chat/completions.
  const transcript = formatCompactTranscript(reqBody);
  const chatCtrl = createUpstreamFetchControl(res);
  let chatResp: Response;
  let chatBytes: Uint8Array;
  try {
    chatResp = await fetch(`${torveCloudUpstream()}/v1/chat/completions`, {
      method: 'POST',
      headers: jsonUpstreamHeaders(incomingHeaders, apiKey, appId, 'application/json'),
      body: JSON.stringify({
        ...(effectiveModel ? { model: effectiveModel } : {}),
        stream: false,
        max_tokens: MIN_OUTPUT_TOKENS_FLOOR,
        messages: [
          {
            role: 'system',
            content: 'You are compacting a coding agent session. Produce a concise, faithful session summary that preserves all important file paths, architectural decisions, code symbols, command/test outputs, errors, and remaining open tasks. Return only the compacted summary.',
          },
          {
            role: 'user',
            content: transcript,
          },
        ],
      }),
      signal: chatCtrl.signal,
    });
    chatCtrl.markHeadersReceived(false);
    chatBytes = new Uint8Array(await chatResp.arrayBuffer());
  } finally {
    chatCtrl.clear();
  }
  if (!chatResp.ok) {
    const message = extractUpstreamErrorMessage(chatBytes, chatResp.status);
    sendError(res, chatResp.status, message);
    return { status: chatResp.status, requestedModel, resolvedModel: effectiveModel, usage: null, errorSummary: message };
  }

  const parsedChat = parseJsonObjectBytes(chatBytes);
  const choices = Array.isArray(parsedChat?.['choices']) ? parsedChat['choices'] as unknown[] : [];
  const firstChoice = choices[0] && typeof choices[0] === 'object' ? choices[0] as Record<string, unknown> : {};
  const msg = firstChoice['message'] && typeof firstChoice['message'] === 'object' ? firstChoice['message'] as Record<string, unknown> : {};
  const summary = extractChatMessageText(msg['content']) || extractChatReasoning(msg);
  const usageDetails = extractTokenUsageDetails(parsedChat?.['usage']);

  const payload = {
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
    usage: {
      input_tokens: usageDetails.inputTokens,
      output_tokens: usageDetails.outputTokens,
      total_tokens: usageDetails.inputTokens + usageDetails.outputTokens,
    },
  };
  sendJson(res, 200, payload);
  return {
    status: 200,
    requestedModel,
    resolvedModel: effectiveModel,
    usage: { inputTokens: usageDetails.inputTokens, outputTokens: usageDetails.outputTokens },
    errorSummary: null,
  };
}

// ---------------------------------------------------------------------------
// Anthropic Messages (/v1/messages) unbuffered SSE streaming
// ---------------------------------------------------------------------------

function mapOpenAiFinishReasonToAnthropic(reason: string | null, hadTools: boolean): string {
  if (reason === 'tool_calls' || reason === 'function_call') return 'tool_use';
  if (reason === 'length') return 'max_tokens';
  if (reason === 'stop') return 'end_turn';
  if (reason && reason.length > 0) return reason;
  return hadTools ? 'tool_use' : 'end_turn';
}

async function streamChatToAnthropicSse(
  res: ServerResponse,
  upstream: Response,
  fallbackModel: string | null,
  onChunk?: () => void,
): Promise<TorveCloudActivity['usage']> {
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

  type ToolBlockState = {
    blockIndex: number;
    id: string;
    name: string;
    started: boolean;
    closed: boolean;
    pendingArgs: string;
  };
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
      if (!tb.started) {
        startToolBlock(tcIndex, tb);
      }
      if (!tb.closed) {
        writeEvent('content_block_stop', { type: 'content_block_stop', index: tb.blockIndex });
        tb.closed = true;
      }
    }
    writeEvent('message_delta', {
      type: 'message_delta',
      delta: {
        stop_reason: mapOpenAiFinishReasonToAnthropic(finishReason, toolBlocks.size > 0),
        stop_sequence: null,
      },
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
      if (typeof firstChoice?.['finish_reason'] === 'string' && firstChoice['finish_reason']) {
        finishReason = firstChoice['finish_reason'];
      }
      const delta = firstChoice?.['delta'] && typeof firstChoice['delta'] === 'object'
        ? firstChoice['delta'] as Record<string, unknown>
        : null;
      if (!delta) return;

      const reasoning = extractChatReasoning(delta);
      if (reasoning.length > 0) {
        ensureMessageStart();
        if (activeBlockType !== 'thinking') {
          closeActiveBlock();
          activeBlockIndex = nextBlockIndex++;
          activeBlockType = 'thinking';
          writeEvent('content_block_start', {
            type: 'content_block_start',
            index: activeBlockIndex,
            content_block: { type: 'thinking', thinking: '' },
          });
        }
        writeEvent('content_block_delta', {
          type: 'content_block_delta',
          index: activeBlockIndex,
          delta: { type: 'thinking_delta', thinking: reasoning },
        });
      }

      const textDelta = typeof delta['content'] === 'string' ? delta['content'] : '';
      if (textDelta.length > 0) {
        ensureMessageStart();
        if (activeBlockType !== 'text') {
          closeActiveBlock();
          activeBlockIndex = nextBlockIndex++;
          activeBlockType = 'text';
          writeEvent('content_block_start', {
            type: 'content_block_start',
            index: activeBlockIndex,
            content_block: { type: 'text', text: '' },
          });
        }
        writeEvent('content_block_delta', {
          type: 'content_block_delta',
          index: activeBlockIndex,
          delta: { type: 'text_delta', text: textDelta },
        });
      }

      const deltaToolCalls = Array.isArray(delta['tool_calls']) ? delta['tool_calls'] : [];
      for (const rawTc of deltaToolCalls) {
        if (!rawTc || typeof rawTc !== 'object') continue;
        const tc = rawTc as Record<string, unknown>;
        const tcIndex = typeof tc['index'] === 'number' && Number.isFinite(tc['index'])
          ? Math.max(0, Math.floor(tc['index']))
          : 0;
        const fn = tc['function'] && typeof tc['function'] === 'object'
          ? tc['function'] as Record<string, unknown>
          : {};
        const tcId = typeof tc['id'] === 'string' && tc['id'] ? tc['id'] : '';
        const tcName = typeof fn['name'] === 'string' && fn['name'] ? fn['name'] : '';
        const argsDelta = typeof fn['arguments'] === 'string' ? fn['arguments'] : '';

        let tb = toolBlocks.get(tcIndex);
        if (!tb) {
          tb = {
            blockIndex: -1,
            id: tcId || `toolu_${tcIndex + 1}`,
            name: tcName,
            started: false,
            closed: false,
            pendingArgs: '',
          };
          toolBlocks.set(tcIndex, tb);
        } else {
          if (tcId && !tb.started) tb.id = tcId;
          if (tcName && !tb.name) tb.name = tcName;
        }

        if (!tb.started) {
          if (tb.name) {
            startToolBlock(tcIndex, tb);
          } else if (argsDelta.length > 0) {
            tb.pendingArgs += argsDelta;
          }
        }

        if (tb.started && argsDelta.length > 0) {
          if (activeBlockType !== 'tool_use' || activeToolTcIndex !== tcIndex) {
            // Sequential Anthropic SSE blocks cannot interleave; close active if another index started.
            if (activeBlockType !== null) closeActiveBlock();
            activeBlockType = 'tool_use';
            activeBlockIndex = tb.blockIndex;
            activeToolTcIndex = tcIndex;
          }
          writeEvent('content_block_delta', {
            type: 'content_block_delta',
            index: tb.blockIndex,
            delta: { type: 'input_json_delta', partial_json: argsDelta },
          });
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

function requestHeaders(req: IncomingMessage): Record<string, string> { const result: Record<string, string> = {}; for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') result[key] = value; return result; }
function responseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (!HOP_BY_HOP.has(lower) && lower !== 'content-encoding') result[key] = value;
  });
  return result;
}
export function upstreamHeaders(headers: Record<string, string>, apiKey: string, appId: string | null = null): Record<string, string> {
  return buildTorveUpstreamHeaders(headers, apiKey, appId, HOP_BY_HOP);
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
function isSse(contentType: string | null): boolean { return contentType?.toLowerCase().includes('text/event-stream') === true; }
function sendJson(res: ServerResponse, status: number, body: unknown): void { const json = JSON.stringify(body); res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(json).toString(), 'cache-control': 'no-store' }); res.end(json); }
function sendError(res: ServerResponse, status: number, message: string): void { if (!res.headersSent) sendJson(res, status, { error: { message, type: 'torve_cloud_error' } }); else res.end(); }
async function sendFetchResponse(res: ServerResponse, response: Response): Promise<void> {
  const headers = responseHeaders(response.headers);
  delete headers['content-encoding'];
  delete headers['content-length'];
  res.writeHead(response.status, headers);
  if (!response.body) { res.end(); return; }
  const reader = response.body.getReader();
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      res.write(next.value);
    }
  } finally { res.end(); }
}
function readBody(req: IncomingMessage): Promise<Uint8Array> { return new Promise((resolve, reject) => { const parts: Buffer[] = []; let size = 0; req.on('data', (chunk: Buffer) => { size += chunk.length; if (size > MAX_BODY_BYTES) { reject(new PayloadTooLargeError()); req.destroy(); return; } parts.push(chunk); }); req.on('end', () => resolve(new Uint8Array(Buffer.concat(parts)))); req.on('error', reject); }); }

function scopedRequestPath(pathname: string): { appId: string | null; path: string } {
  const match = /^\/app\/([a-z0-9][a-z0-9._-]{0,63})(\/.*)?$/i.exec(pathname);
  if (!match) return { appId: null, path: pathname };
  return { appId: match[1]!.toLowerCase(), path: match[2] || '/' };
}

function protocolForPath(path: string): DirectCloudProtocol {
  if (path === '/v1/models') return 'models';
  if (isGeminiPath(path)) return 'gemini';
  if (path.startsWith('/v1/messages')) return 'anthropic';
  if (path === '/v1/responses/compact' || path.startsWith('/v1/responses')) return 'openai-responses';
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

async function handleGeminiRequest(req: IncomingMessage, res: ServerResponse, path: string, apiKey: string, appId: string | null): Promise<{ status: number; requestedModel: string | null; resolvedModel: string | null; stream: boolean; usage: TorveCloudActivity['usage'] }> {
  const rawBody = await readBody(req);
  const input = parseJsonObjectBytes(rawBody);
  const encodedModel = /^\/v1(?:beta)?\/models\/([^/:]+):/.exec(path)?.[1] ?? 'torve';
  const requestedModel = decodeURIComponent(encodedModel);
  const model = await resolveModelForRequest(appId, requestedModel, apiKey) ?? requestedModel;
  const stream = path.includes(':streamGenerateContent');
  if (!input) {
    sendError(res, 400, 'Invalid JSON request body for Gemini endpoint.');
    return { status: 400, requestedModel, resolvedModel: model, stream, usage: null };
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
        return { status: upstream.status, requestedModel, resolvedModel: model, stream, usage: null };
      }
      if (!payload) {
        sendError(res, 502, 'Torve returned an invalid response.');
        return { status: 502, requestedModel, resolvedModel: model, stream, usage: null };
      }
      const usage = extractTokenUsageFromRecord(payload);
      sendJson(res, upstream.status, openAiToGemini(payload));
      return { status: upstream.status, requestedModel, resolvedModel: model, stream, usage };
    }

    beginSseResponse(res, upstream.status, responseHeaders(upstream.headers));
    const accumulatedTools = new Map<number, { name: string; arguments: string }>();
    let latestUsage: unknown = undefined;

    const flushAccumulatedTools = (finishReason: string | null): void => {
      if (accumulatedTools.size === 0) return;
      const parts: Array<Record<string, unknown>> = [];
      for (const [, tc] of [...accumulatedTools.entries()].sort((a, b) => a[0] - b[0])) {
        parts.push({ functionCall: { name: tc.name, args: safeJson(tc.arguments) } });
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
            parts.push({ functionCall: { name: tc.name, args: safeJson(tc.arguments) } });
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
      flushAccumulatedTools('STOP');
      return { status: upstream.status, requestedModel, resolvedModel: model, stream, usage: result.usage };
    } finally {
      if (!res.writableEnded) res.end();
    }
  } finally {
    fetchCtrl.clear();
  }
}

function geminiMessages(input: Record<string, unknown>): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [];
  const pendingCallIdsByName = new Map<string, string[]>();
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
      if (typeof part['text'] === 'string' && part['thought'] !== true) {
        textChunks.push(part['text']);
      }
      if (part['functionCall'] && typeof part['functionCall'] === 'object') {
        const fc = part['functionCall'] as Record<string, unknown>;
        const name = typeof fc['name'] === 'string' ? fc['name'] : '';
        const callId = typeof fc['id'] === 'string' && fc['id'] ? fc['id'] : `gemini_call_${++callSeq}`;
        const queue = pendingCallIdsByName.get(name) ?? [];
        queue.push(callId);
        pendingCallIdsByName.set(name, queue);
        toolCalls.push({
          id: callId,
          type: 'function',
          function: {
            name,
            arguments: typeof fc['args'] === 'string' ? fc['args'] : JSON.stringify(fc['args'] ?? {}),
          },
        });
      }
      if (part['functionResponse'] && typeof part['functionResponse'] === 'object') {
        const fr = part['functionResponse'] as Record<string, unknown>;
        const name = typeof fr['name'] === 'string' ? fr['name'] : '';
        const queuedId = pendingCallIdsByName.get(name)?.shift();
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
        messages.push({
          role: 'assistant',
          content: joinedText || null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        });
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
    .map((part) => part && typeof part === 'object' && (part as Record<string, unknown>)['thought'] !== true && typeof (part as Record<string, unknown>)['text'] === 'string'
      ? (part as Record<string, string>)['text']
      : '')
    .join('');
}

function geminiTools(input: Record<string, unknown>): Array<Record<string, unknown>> | undefined {
  const out: Array<Record<string, unknown>> = [];
  for (const group of Array.isArray(input['tools']) ? input['tools'] : []) {
    const declarations = group && typeof group === 'object' ? (group as Record<string, unknown>)['functionDeclarations'] : undefined;
    for (const fn of Array.isArray(declarations) ? declarations : []) {
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
    if (fn && typeof fn === 'object') parts.push({ functionCall: { name: (fn as Record<string, unknown>)['name'], args: safeJson((fn as Record<string, unknown>)['arguments']) } });
  }
  return { candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }], usageMetadata: geminiUsage(payload['usage']) };
}

function safeJson(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  try { return typeof value === 'string' ? JSON.parse(value) as Record<string, unknown> : {}; } catch { return {}; }
}

function geminiUsage(value: unknown): Record<string, number> { const usage = value && typeof value === 'object' ? value as Record<string, unknown> : {}; const prompt = typeof usage['prompt_tokens'] === 'number' ? usage['prompt_tokens'] : 0; const output = typeof usage['completion_tokens'] === 'number' ? usage['completion_tokens'] : 0; return { promptTokenCount: prompt, candidatesTokenCount: output, totalTokenCount: prompt + output }; }

function floorOutboundOutputTokens(value: unknown): number {
  const n = finitePositiveNumber(value);
  return n === 0 || n <= LOW_OUTPUT_TOKENS_THRESHOLD ? MIN_OUTPUT_TOKENS_FLOOR : n;
}

function applyOutboundMaxTokens(body: Record<string, unknown>): { next: Record<string, unknown>; changed: boolean } {
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

/** Config-patched clients use the stable `torve` alias. Resolve it only at
 * the loopback boundary so individual tool configs never need a raw model id
 * or API key. The catalog's first available model is a safe initial default;
 * later per-app overrides can replace it without rewriting client configs. */
async function resolveRoutedModel(body: Uint8Array, appId: string | null, requestedModel: string | null, apiKey: string): Promise<{ body: Uint8Array; model: string | null }> {
  try {
    const json = JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
    const model = await resolveModelForRequest(appId, requestedModel, apiKey);
    const modelChanged = Boolean(model && json['model'] !== model);
    const { next: withOutputFloor, changed: outputChanged } = applyOutboundMaxTokens(
      modelChanged && model ? { ...json, model } : json,
    );
    if (!modelChanged && !outputChanged) return { body, model };
    return { body: new TextEncoder().encode(JSON.stringify(withOutputFloor)), model };
  } catch { return { body, model: requestedModel }; }
}

function parseJsonObjectBytes(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function finitePositiveNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function extractChatReasoning(record: Record<string, unknown>): string {
  if (typeof record['reasoning_content'] === 'string') return record['reasoning_content'];
  if (typeof record['reasoning'] === 'string') return record['reasoning'];
  return '';
}

function extractChatMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (part && typeof part === 'object' && typeof (part as Record<string, unknown>)['text'] === 'string'
      ? (part as Record<string, string>)['text']
      : ''))
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
  const promptDetails = u['prompt_tokens_details'] && typeof u['prompt_tokens_details'] === 'object'
    ? u['prompt_tokens_details'] as Record<string, unknown>
    : {};
  const inputDetails = u['input_tokens_details'] && typeof u['input_tokens_details'] === 'object'
    ? u['input_tokens_details'] as Record<string, unknown>
    : {};
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

function extractUpstreamErrorMessage(bytes: Uint8Array, statusCode: number): string {
  const parsed = parseJsonObjectBytes(bytes);
  const errObj = parsed?.['error'] && typeof parsed['error'] === 'object'
    ? parsed['error'] as Record<string, unknown>
    : null;
  const msg = typeof errObj?.['message'] === 'string'
    ? errObj['message']
    : typeof parsed?.['message'] === 'string'
      ? parsed['message']
      : new TextDecoder().decode(bytes).trim();
  return sanitizeError(msg || `Torve Cloud returned ${statusCode}.`);
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

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'TimeoutError' || error.name === 'AbortError' || /timed?\s*out|timeout/i.test(error.message);
}
