import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { TorveModel } from './models.js';

const DEFAULT_GOOGLE_UPSTREAM = 'https://daily-cloudcode-pa.googleapis.com';
const DEFAULT_ID_PATH = path.join(homedir(), '.torve', 'antigravity-model-ids.json');
// Antigravity 2.34.0's embedded protobuf enum contains every placeholder from
// M0 through M1650. Allocate downward from the high, unused end.
const PLACEHOLDER_MAX = 1650;
const PLACEHOLDER_MIN = 1500;
const HOP_BY_HOP = new Set(['connection', 'host', 'content-length', 'transfer-encoding', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'upgrade']);

type JsonObject = Record<string, unknown>;
type Identity = { pickerId: string; placeholderId: string };
type IdentityFile = { version: 1; assignments: Record<string, Identity> };

export type AntigravityV1InternalMeta = {
  requestedModel: string | null;
  resolvedModel: string | null;
  stream: boolean;
  torveRouted: boolean;
  usage: { inputTokens: number; outputTokens: number } | null;
  injectedModels: number;
};

export type AntigravityV1InternalRequest = {
  method: string;
  pathAndQuery: string;
  headers: Record<string, string>;
  body: Uint8Array;
};

export type AntigravityV1InternalOptions = {
  apiKey: string | null;
  models: readonly TorveModel[];
  fetchImpl?: typeof fetch;
  googleUpstream?: string;
  torveUpstream: string;
  identityPath?: string;
  debug?: (record: Record<string, unknown>) => void | Promise<void>;
};

export type AntigravityV1InternalResult = { response: Response; meta: AntigravityV1InternalMeta };

/** Cloud Code adapter for the VS Code-based Antigravity IDE. Unknown calls and
 * native Google model IDs fail open to the real Cloud Code service. */
export async function handleAntigravityV1Internal(
  request: AntigravityV1InternalRequest,
  options: AntigravityV1InternalOptions,
): Promise<AntigravityV1InternalResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const googleUpstream = (options.googleUpstream || process.env['TORVE_ANTIGRAVITY_CLOUD_CODE_UPSTREAM'] || DEFAULT_GOOGLE_UPSTREAM).replace(/\/+$/, '');
  const identityPath = options.identityPath ?? DEFAULT_ID_PATH;
  const meta: AntigravityV1InternalMeta = { requestedModel: null, resolvedModel: null, stream: false, torveRouted: false, usage: null, injectedModels: 0 };

  if (request.pathAndQuery.startsWith('/v1internal:fetchAvailableModels')) {
    const upstream = await forwardGoogle(fetchImpl, googleUpstream, request);
    await options.debug?.({
      event: 'fetchAvailableModels-upstream',
      statusCode: upstream.status,
      ok: upstream.ok,
      contentType: upstream.headers.get('content-type'),
    });
    if (!upstream.ok || options.models.length === 0) return { response: upstream, meta };
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    try {
      const catalog = JSON.parse(new TextDecoder().decode(bytes)) as JsonObject;
      await options.debug?.({ event: 'fetchAvailableModels-before-injection', ...catalogDebugSummary(catalog) });
      const modelMap = catalog['models'];
      if (!modelMap || typeof modelMap !== 'object' || Array.isArray(modelMap)) throw new Error('Cloud Code catalog has no model map.');
      const identities = await ensureIdentities(options.models, identityPath, new Set(Object.keys(modelMap)));
      injectTorveCatalog(catalog, options.models, identities);
      meta.injectedModels = options.models.length;
      await options.debug?.({ event: 'fetchAvailableModels-after-injection', ...catalogDebugSummary(catalog) });
      return { response: jsonResponse(catalog, upstream.status, upstream.headers), meta };
    } catch (error) {
      await options.debug?.({
        event: 'fetchAvailableModels-injection-error',
        message: error instanceof Error ? error.message : String(error),
        responseBytes: bytes.byteLength,
      });
      return { response: byteResponse(bytes, upstream.status, upstream.headers), meta };
    }
  }

  if (!/:(?:streamGenerateContent|generateContent)\b/.test(request.pathAndQuery)) {
    return { response: await forwardGoogle(fetchImpl, googleUpstream, request), meta };
  }

  let envelope: JsonObject;
  try { envelope = JSON.parse(new TextDecoder().decode(request.body)) as JsonObject; }
  catch { return { response: await forwardGoogle(fetchImpl, googleUpstream, request), meta }; }
  const requestedModel = typeof envelope['model'] === 'string' ? envelope['model'] : null;
  meta.requestedModel = requestedModel;
  meta.stream = request.pathAndQuery.includes('streamGenerateContent');
  const identities = await ensureIdentities(options.models, identityPath);
  const matched = findTorveModel(requestedModel, options.models, identities);
  if (!matched) return { response: await forwardGoogle(fetchImpl, googleUpstream, request), meta };

  meta.torveRouted = true;
  meta.resolvedModel = matched.id;
  if (!options.apiKey) return { response: cloudCodeError(401, 'Connect a Torve account in Torve Desktop first.'), meta };
  const upstream = await fetchImpl(`${options.torveUpstream.replace(/\/+$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      'content-type': 'application/json',
      accept: meta.stream ? 'text/event-stream' : 'application/json',
      'x-torve-client-app': 'antigravity',
    },
    body: JSON.stringify(toOpenAiRequest(envelope, matched.id, meta.stream)),
    signal: AbortSignal.timeout(10 * 60_000),
  });
  if (!upstream.ok) {
    const message = await safeUpstreamError(upstream);
    return { response: cloudCodeError(upstream.status, message), meta };
  }
  return meta.stream
    ? { response: streamOpenAiAsCloudCode(upstream, meta), meta }
    : { response: await openAiAsCloudCode(upstream, meta), meta };
}

function catalogDebugSummary(catalog: JsonObject): Record<string, unknown> {
  const modelMap = catalog['models'];
  const modelKeys = modelMap && typeof modelMap === 'object' && !Array.isArray(modelMap)
    ? Object.keys(modelMap as JsonObject)
    : [];
  return {
    topLevelKeys: Object.keys(catalog),
    modelsType: Array.isArray(modelMap) ? 'array' : typeof modelMap,
    modelsCount: modelKeys.length,
    modelKeys,
    defaultAgentModelId: catalog['defaultAgentModelId'] ?? null,
    agentModelSortsType: Array.isArray(catalog['agentModelSorts']) ? 'array' : typeof catalog['agentModelSorts'],
    agentModelSorts: catalog['agentModelSorts'] ?? null,
    cascadeModelConfigsType: Array.isArray(catalog['cascadeModelConfigs']) ? 'array' : typeof catalog['cascadeModelConfigs'],
    clientModelConfigsType: Array.isArray(catalog['clientModelConfigs']) ? 'array' : typeof catalog['clientModelConfigs'],
  };
}

async function forwardGoogle(fetchImpl: typeof fetch, upstream: string, request: AntigravityV1InternalRequest): Promise<Response> {
  return fetchImpl(`${upstream}${request.pathAndQuery}`, {
    method: request.method,
    headers: filteredHeaders(request.headers),
    ...(request.method === 'GET' || request.method === 'HEAD' ? {} : { body: request.body }),
    signal: AbortSignal.timeout(10 * 60_000),
  });
}

function filteredHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { 'accept-encoding': 'identity' };
  for (const [key, value] of Object.entries(headers)) if (!HOP_BY_HOP.has(key.toLowerCase()) && key.toLowerCase() !== 'accept-encoding') out[key] = value;
  return out;
}

async function loadIdentities(filePath: string): Promise<IdentityFile> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as Partial<IdentityFile>;
    if (parsed.version === 1 && parsed.assignments && typeof parsed.assignments === 'object') return { version: 1, assignments: parsed.assignments };
  } catch { /* first run or invalid cache */ }
  return { version: 1, assignments: {} };
}

async function ensureIdentities(models: readonly TorveModel[], filePath: string, reserved = new Set<string>()): Promise<IdentityFile> {
  const state = await loadIdentities(filePath);
  const modelIds = new Set(models.map((model) => model.id));
  for (const [modelId, identity] of Object.entries(state.assignments)) {
    if (modelIds.has(modelId) && reserved.has(identity.placeholderId)) delete state.assignments[modelId];
  }
  const used = new Set([...reserved, ...Object.values(state.assignments).map((entry) => entry.placeholderId)]);
  let changed = false;
  for (const model of [...models].sort((a, b) => a.id.localeCompare(b.id))) {
    if (state.assignments[model.id]) continue;
    let slot = PLACEHOLDER_MAX;
    while (slot >= PLACEHOLDER_MIN && used.has(`MODEL_PLACEHOLDER_M${slot}`)) slot--;
    if (slot < PLACEHOLDER_MIN) throw new Error('Antigravity native model identity pool is exhausted.');
    const placeholderId = `MODEL_PLACEHOLDER_M${slot}`;
    state.assignments[model.id] = { pickerId: pickerIdFor(model.id), placeholderId };
    used.add(placeholderId);
    changed = true;
  }
  if (changed) {
    await mkdir(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, filePath);
  }
  return state;
}

function pickerIdFor(modelId: string): string {
  const slug = modelId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'model';
  const digest = createHash('sha256').update(modelId).digest('hex').slice(0, 8);
  return `torve/${slug}-${digest}`;
}

function findTorveModel(
  requested: string | null,
  models: readonly TorveModel[],
  identities: IdentityFile,
): TorveModel | null {
  if (!requested) return null;
  return models.find((model) => {
    const identity = identities.assignments[model.id];
    return requested === model.id || requested === identity?.pickerId || requested === identity?.placeholderId;
  }) ?? null;
}

export function injectTorveCatalog(catalog: JsonObject, models: readonly TorveModel[], identities: IdentityFile): void {
  const modelMap = catalog['models'];
  if (!modelMap || typeof modelMap !== 'object' || Array.isArray(modelMap)) throw new Error('Cloud Code catalog has no model map.');
  const injected: string[] = [];
  for (const model of models) {
    const identity = identities.assignments[model.id];
    if (!identity) continue;
    // 2.34.0's picker validates both the map key and ModelDetails.model as a
    // recognized Model enum. Arbitrary Torve string IDs are silently hidden.
    (modelMap as JsonObject)[identity.placeholderId] = catalogModel(model, identity.placeholderId);
    injected.push(identity.placeholderId);
  }
  const sorts = Array.isArray(catalog['agentModelSorts']) ? catalog['agentModelSorts'] as JsonObject[] : [];
  const first = sorts[0] ?? { displayName: 'Recommended', groups: [] };
  const groups = Array.isArray(first['groups']) ? first['groups'] as JsonObject[] : [];
  // Standalone Antigravity 2.34.0 only renders the first group in the first
  // agentModelSort. A separate Torve group is present in the wire response but
  // silently omitted by the picker. Append to Google's existing group instead,
  // preserving its order and every native model.
  const primary = groups[0] ?? { modelIds: [] };
  const nativeIds = Array.isArray(primary['modelIds'])
    ? primary['modelIds'].filter((value): value is string => typeof value === 'string')
    : [];
  primary['modelIds'] = [...new Set([...nativeIds, ...injected])];
  if (groups.length === 0) groups.push(primary);
  first['groups'] = groups;
  if (sorts.length === 0) sorts.push(first);
  catalog['agentModelSorts'] = sorts;
}

function catalogModel(model: TorveModel, placeholderId: string): JsonObject {
  const capabilities = Array.isArray(model['capabilities']) ? model['capabilities'].filter((item): item is string => typeof item === 'string') : [];
  const supportsImages = capabilities.some((item) => /image|vision/i.test(item));
  const supportsThinking = model['supports_reasoning'] === true || capabilities.some((item) => /reason|think/i.test(item));
  const mime: Record<string, boolean> = { 'text/plain': true, 'text/markdown': true, 'application/json': true, 'application/pdf': true };
  if (supportsImages) for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) mime[type] = true;
  return {
    displayName: typeof model['display_name'] === 'string' ? model['display_name'] : `Torve · ${model.id}`,
    supportsImages,
    supportsThinking,
    recommended: false,
    maxTokens: Math.max(numberValue(model['max_input_tokens'], model['context_window'], model['max_tokens'], 1_000_000), 1_000_000),
    maxOutputTokens: Math.max(numberValue(model['max_output_tokens'], model['max_tokens'], 32_768), 32_768),
    model: placeholderId,
    apiProvider: 'API_PROVIDER_GOOGLE_GEMINI',
    modelProvider: 'MODEL_PROVIDER_GOOGLE',
    supportedMimeTypes: mime,
    ...(supportsThinking ? { minThinkingBudget: 1024, thinkingLevel: 2 } : {}),
  };
}

function numberValue(...values: unknown[]): number {
  for (const value of values) if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  return 0;
}

function toOpenAiRequest(envelope: JsonObject, model: string, stream: boolean): JsonObject {
  const request = objectValue(envelope['request']);
  const messages: JsonObject[] = [];
  const system = textParts(objectValue(request['systemInstruction'])['parts']);
  if (system) messages.push({ role: 'system', content: system });
  const pendingCalls: Array<{ id: string; name: string }> = [];
  for (const [contentIndex, raw] of arrayValue(request['contents']).entries()) {
    const content = objectValue(raw);
    const parts = arrayValue(content['parts']).map(objectValue);
    for (const part of parts) {
      const response = objectValue(part['functionResponse']);
      if (!response['name']) continue;
      const name = String(response['name']);
      const match = pendingCalls.findIndex((call) => call.name === name);
      const id = match >= 0 ? pendingCalls.splice(match, 1)[0]!.id : `call_${contentIndex}_${name}`;
      messages.push({ role: 'tool', tool_call_id: id, content: JSON.stringify(response['response'] ?? {}) });
    }
    const role = content['role'] === 'model' ? 'assistant' : 'user';
    const texts: string[] = [];
    const images: JsonObject[] = [];
    const toolCalls: JsonObject[] = [];
    for (const [partIndex, part] of parts.entries()) {
      const call = objectValue(part['functionCall']);
      if (call['name']) {
        const id = `call_${contentIndex}_${partIndex}`;
        pendingCalls.push({ id, name: String(call['name']) });
        toolCalls.push({ id, type: 'function', function: { name: String(call['name']), arguments: JSON.stringify(call['args'] ?? {}) } });
        continue;
      }
      if (part['functionResponse'] || part['thought'] === true) continue;
      if (typeof part['text'] === 'string') texts.push(part['text']);
      const inline = objectValue(part['inlineData']);
      if (typeof inline['data'] === 'string') images.push({ type: 'image_url', image_url: { url: `data:${typeof inline['mimeType'] === 'string' ? inline['mimeType'] : 'image/png'};base64,${inline['data']}` } });
    }
    if (texts.length === 0 && images.length === 0 && toolCalls.length === 0) continue;
    const message: JsonObject = { role };
    message['content'] = images.length > 0 ? [...(texts.length ? [{ type: 'text', text: texts.join('\n') }] : []), ...images] : texts.join('\n');
    if (toolCalls.length) message['tool_calls'] = toolCalls;
    messages.push(message);
  }
  const config = objectValue(request['generationConfig']);
  const body: JsonObject = { model, messages: messages.length ? messages : [{ role: 'user', content: '' }], stream };
  if (typeof config['temperature'] === 'number') body['temperature'] = config['temperature'];
  if (typeof config['topP'] === 'number') body['top_p'] = config['topP'];
  const rawMaxOut = typeof config['maxOutputTokens'] === 'number' && Number.isFinite(config['maxOutputTokens']) && config['maxOutputTokens'] > 0
    ? config['maxOutputTokens']
    : 0;
  body['max_tokens'] = rawMaxOut === 0 || rawMaxOut <= 8_192 ? 32_768 : rawMaxOut;
  const level = objectValue(config['thinkingConfig'])['thinkingLevel'];
  if (typeof level === 'string' && ['low', 'medium', 'high'].includes(level.toLowerCase())) body['reasoning_effort'] = level.toLowerCase();
  const tools: JsonObject[] = [];
  for (const group of arrayValue(request['tools'])) for (const raw of arrayValue(objectValue(group)['functionDeclarations'])) {
    const fn = objectValue(raw);
    if (typeof fn['name'] === 'string') tools.push({ type: 'function', function: { name: fn['name'], ...(typeof fn['description'] === 'string' ? { description: fn['description'] } : {}), parameters: normalizeSchema(fn['parameters']) } });
  }
  if (tools.length) body['tools'] = tools;
  return body;
}

function normalizeSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeSchema);
  if (!value || typeof value !== 'object') return value;
  const result: JsonObject = {};
  for (const [key, child] of Object.entries(value as JsonObject)) {
    if (key === 'propertyOrdering' || key === 'property_ordering') continue;
    result[key] = key === 'type' && typeof child === 'string' ? child.toLowerCase() : normalizeSchema(child);
  }
  return result;
}

async function openAiAsCloudCode(upstream: Response, meta: AntigravityV1InternalMeta): Promise<Response> {
  const payload = await upstream.json() as JsonObject;
  meta.usage = usageFrom(payload['usage']);
  const choice = objectValue(arrayValue(payload['choices'])[0]);
  const message = objectValue(choice['message']);
  const parts: JsonObject[] = [];
  const reasoning = stringValue(message['reasoning'], message['reasoning_content']);
  if (reasoning) parts.push({ thought: true, text: reasoning });
  const text = contentText(message['content']);
  if (text) parts.push({ text });
  for (const raw of arrayValue(message['tool_calls'])) {
    const fn = objectValue(objectValue(raw)['function']);
    if (typeof fn['name'] === 'string') parts.push({ functionCall: { name: fn['name'], args: parseArgs(fn['arguments']) } });
  }
  const response = { response: { candidates: [{ content: { role: 'model', parts }, finishReason: choice['finish_reason'] === 'length' ? 'MAX_TOKENS' : 'STOP' }], ...(meta.usage ? { usageMetadata: cloudCodeUsage(meta.usage) } : {}) }, traceId: randomUUID().slice(0, 16), metadata: {} };
  return jsonResponse(response, 200);
}

function tryParseCompleteJson(raw: string): { ok: true; value: unknown } | { ok: false } {
  const trimmed = raw.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
    return { ok: false };
  }
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false };
  }
}

function streamOpenAiAsCloudCode(upstream: Response, meta: AntigravityV1InternalMeta): Response {
  const traceId = randomUUID().slice(0, 16);
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const calls = new Map<number, { name: string; args: string; flushed: boolean }>();
      const decoder = new TextDecoder();
      let pending = '';
      let finishReason = 'STOP';
      const frame = (candidates: unknown[], usage?: JsonObject) => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ response: { candidates, ...(usage ? { usageMetadata: usage } : {}) }, traceId, metadata: {} })}\n\n`));
      const flushCalls = (beforeIndex = Number.POSITIVE_INFINITY) => {
        const parts: JsonObject[] = [];
        for (const [index, call] of [...calls.entries()].sort((a, b) => a[0] - b[0])) {
          if (index >= beforeIndex || call.flushed || !call.name) continue;
          call.flushed = true;
          parts.push({ functionCall: { name: call.name, args: parseArgs(call.args) } });
        }
        if (parts.length > 0) frame([{ content: { role: 'model', parts } }]);
      };
      const processLine = (line: string) => {
        if (!line.startsWith('data:')) return;
        const raw = line.slice(5).trim();
        if (!raw) return;
        if (raw === '[DONE]') {
          flushCalls();
          return;
        }
        let chunk: JsonObject;
        try { chunk = JSON.parse(raw) as JsonObject; } catch { return; }
        const usage = usageFrom(chunk['usage']); if (usage) meta.usage = usage;
        const choice = objectValue(arrayValue(chunk['choices'])[0]);
        const delta = objectValue(choice['delta']);
        const reasoning = stringValue(delta['reasoning'], delta['reasoning_content']);
        if (reasoning) frame([{ content: { role: 'model', parts: [{ thought: true, text: reasoning }] } }]);
        const text = contentText(delta['content']);
        if (text) frame([{ content: { role: 'model', parts: [{ text }] } }]);
        for (const rawCall of arrayValue(delta['tool_calls'])) {
          const call = objectValue(rawCall);
          const index = typeof call['index'] === 'number' ? call['index'] : calls.size;
          flushCalls(index);
          const current = calls.get(index) ?? { name: '', args: '', flushed: false };
          const fn = objectValue(call['function']);
          if (typeof fn['name'] === 'string' && fn['name']) current.name = fn['name'];
          if (typeof fn['arguments'] === 'string') current.args += fn['arguments'];
          calls.set(index, current);
          if (!current.flushed && current.name) {
            const parsed = tryParseCompleteJson(current.args);
            if (parsed.ok) {
              current.flushed = true;
              frame([{ content: { role: 'model', parts: [{ functionCall: { name: current.name, args: parsed.value } }] } }]);
            }
          }
        }
        if (typeof choice['finish_reason'] === 'string' && choice['finish_reason'].length > 0) {
          if (choice['finish_reason'] === 'length') finishReason = 'MAX_TOKENS';
          flushCalls();
        }
      };
      try {
        const reader = upstream.body?.getReader();
        if (reader) for (;;) {
          const next = await reader.read();
          if (next.done) {
            pending += decoder.decode(undefined, { stream: false });
            if (pending.trim()) {
              for (const line of pending.split(/\r?\n/)) processLine(line);
              pending = '';
            }
            break;
          }
          pending += decoder.decode(next.value, { stream: true });
          const lines = pending.split(/\r?\n/);
          pending = lines.pop() ?? '';
          for (const line of lines) processLine(line);
        }
        flushCalls();
        frame([{ content: { role: 'model', parts: [{ text: '' }] }, finishReason }], meta.usage ? cloudCodeUsage(meta.usage) : undefined);
        controller.close();
      } catch (error) { controller.error(error); }
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' } });
}

function textParts(value: unknown): string { return arrayValue(value).map((part) => objectValue(part)['text']).filter((item): item is string => typeof item === 'string').join('\n'); }
function contentText(value: unknown): string { if (typeof value === 'string') return value; return arrayValue(value).map((item) => objectValue(item)['text']).filter((item): item is string => typeof item === 'string').join(''); }
function objectValue(value: unknown): JsonObject { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}; }
function arrayValue(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function stringValue(...values: unknown[]): string { return values.find((value): value is string => typeof value === 'string' && value.length > 0) ?? ''; }
function parseArgs(value: unknown): unknown { if (typeof value !== 'string' || !value.trim()) return {}; try { return JSON.parse(value); } catch { return { _raw: value }; } }
function usageFrom(value: unknown): AntigravityV1InternalMeta['usage'] { const raw = objectValue(value); if (Object.keys(raw).length === 0) return null; return { inputTokens: Number(raw['prompt_tokens'] ?? raw['input_tokens'] ?? 0) || 0, outputTokens: Number(raw['completion_tokens'] ?? raw['output_tokens'] ?? 0) || 0 }; }
function cloudCodeUsage(usage: NonNullable<AntigravityV1InternalMeta['usage']>): JsonObject { return { promptTokenCount: usage.inputTokens, candidatesTokenCount: usage.outputTokens, totalTokenCount: usage.inputTokens + usage.outputTokens }; }

async function safeUpstreamError(response: Response): Promise<string> { try { const raw = await response.json() as JsonObject; return String(objectValue(raw['error'])['message'] ?? `Torve Cloud returned ${response.status}.`); } catch { return `Torve Cloud returned ${response.status}.`; } }
function cloudCodeError(status: number, message: string): Response { return jsonResponse({ error: { code: status, message, status: status === 401 ? 'UNAUTHENTICATED' : status === 429 ? 'RESOURCE_EXHAUSTED' : 'UNAVAILABLE' } }, status); }
function jsonResponse(body: unknown, status: number, sourceHeaders?: Headers): Response { const headers = cleanResponseHeaders(sourceHeaders); headers.set('content-type', 'application/json'); headers.set('cache-control', 'no-store'); return new Response(JSON.stringify(body), { status, headers }); }
function byteResponse(body: Uint8Array, status: number, sourceHeaders: Headers): Response { return new Response(body, { status, headers: cleanResponseHeaders(sourceHeaders) }); }
function cleanResponseHeaders(source?: Headers): Headers { const headers = new Headers(); source?.forEach((value, key) => { if (!HOP_BY_HOP.has(key.toLowerCase()) && key.toLowerCase() !== 'content-encoding') headers.set(key, value); }); headers.delete('content-length'); return headers; }
