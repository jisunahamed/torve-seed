import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { handleAntigravityV1Internal } from './antigravity-v1internal.js';
import type { TorveModel } from './models.js';

const models: TorveModel[] = [
  { id: 'torve-reasoner', display_name: 'Torve Reasoner', capabilities: ['reasoning', 'tools'], max_input_tokens: 131_072, max_output_tokens: 8_192 },
  { id: 'torve-long', display_name: 'Torve Long', capabilities: ['tools'], context_window: 2_000_000, max_output_tokens: 16_384 },
];
const catalog = {
  models: {
    'gemini-native': { displayName: 'Gemini Native', model: 'MODEL_GEMINI' },
    'gemini-flash': { displayName: 'Gemini Flash', model: 'MODEL_GEMINI_FLASH' },
  },
  defaultAgentModelId: 'gemini-native',
  groupedModels: [{ groupName: 'Google', modelIds: ['gemini-native', 'gemini-flash'] }],
  cascadeModelConfigs: [{ id: 'cascade-native' }],
  clientModelConfigs: [{ id: 'client-native' }],
  agentModelSorts: [{ displayName: 'Recommended', groups: [{ displayName: 'Google', modelIds: ['gemini-native', 'gemini-flash'] }] }],
};

function request(pathAndQuery: string, body: unknown = {}): { method: string; pathAndQuery: string; headers: Record<string, string>; body: Uint8Array } {
  return { method: 'POST', pathAndQuery, headers: { authorization: 'Bearer google-user-token', 'content-type': 'application/json' }, body: new TextEncoder().encode(JSON.stringify(body)) };
}

test('fetchAvailableModels injects Torve models and stable placeholder identities', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'torve-antigravity-catalog-'));
  const identityPath = path.join(dir, 'ids.json');
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => { calls.push(String(url)); return new Response(JSON.stringify(catalog), { status: 200, headers: { 'content-type': 'application/json' } }); }) as typeof fetch;
  try {
    const result = await handleAntigravityV1Internal(request('/v1internal:fetchAvailableModels'), { apiKey: 'torve-key', models, fetchImpl, googleUpstream: 'https://google.example', torveUpstream: 'https://torve.example', identityPath });
    const body = await result.response.json() as Omit<typeof catalog, 'models'> & {
      models: Record<string, { displayName?: string; model?: string; maxTokens?: number }>;
    };
    const torveIds = Object.keys(body.models).filter((id) => id.startsWith('MODEL_PLACEHOLDER_'));
    assert.equal(torveIds.length, 2);
    const reasonerEntry = Object.values(body.models).find((entry) => entry.displayName === 'Torve Reasoner');
    const longEntry = Object.values(body.models).find((entry) => entry.displayName === 'Torve Long');
    assert.ok(reasonerEntry);
    assert.ok(longEntry);
    assert.equal(reasonerEntry.model, 'MODEL_PLACEHOLDER_M1649');
    assert.ok((reasonerEntry.maxTokens ?? 0) >= 1_000_000);
    assert.equal(longEntry.model, 'MODEL_PLACEHOLDER_M1650');
    assert.equal(longEntry.maxTokens, 2_000_000);
    assert.deepEqual(body.models['gemini-native'], { displayName: 'Gemini Native', model: 'MODEL_GEMINI' });
    assert.deepEqual(body.models['gemini-flash'], { displayName: 'Gemini Flash', model: 'MODEL_GEMINI_FLASH' });
    assert.deepEqual(body.groupedModels, [{ groupName: 'Google', modelIds: ['gemini-native', 'gemini-flash'] }]);
    assert.deepEqual(body.agentModelSorts[0]!.groups, [{ displayName: 'Google', modelIds: ['gemini-native', 'gemini-flash', ...torveIds] }]);
    assert.equal(body.defaultAgentModelId, 'gemini-native');
    assert.deepEqual(body.cascadeModelConfigs, [{ id: 'cascade-native' }]);
    assert.deepEqual(body.clientModelConfigs, [{ id: 'client-native' }]);
    assert.equal(calls[0], 'https://google.example/v1internal:fetchAvailableModels');
    const saved = JSON.parse(await readFile(identityPath, 'utf8')) as { assignments: Record<string, { pickerId: string; placeholderId: string }> };
    assert.equal(saved.assignments['torve-reasoner']?.placeholderId, 'MODEL_PLACEHOLDER_M1649');
    assert.equal(saved.assignments['torve-long']?.placeholderId, 'MODEL_PLACEHOLDER_M1650');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('fetchAvailableModels preserves a native placeholder collision and assigns Torve the next free ID', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'torve-antigravity-collision-'));
  const identityPath = path.join(dir, 'ids.json');
  const collisionCatalog = {
    ...catalog,
    models: {
      ...catalog.models,
      MODEL_PLACEHOLDER_M1650: { displayName: 'Google Reserved', model: 'MODEL_PLACEHOLDER_M1650' },
    },
  };
  const fetchImpl = (async () => new Response(JSON.stringify(collisionCatalog), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  try {
    const result = await handleAntigravityV1Internal(request('/v1internal:fetchAvailableModels'), { apiKey: 'torve-key', models: [models[0]!], fetchImpl, googleUpstream: 'https://google.example', torveUpstream: 'https://torve.example', identityPath });
    const body = await result.response.json() as { models: Record<string, { displayName?: string; model?: string }> };
    assert.deepEqual(body.models.MODEL_PLACEHOLDER_M1650, { displayName: 'Google Reserved', model: 'MODEL_PLACEHOLDER_M1650' });
    const torveEntry = Object.entries(body.models).find(([, value]) => value.displayName === 'Torve Reasoner');
    assert.ok(torveEntry);
    assert.equal(torveEntry[0], 'MODEL_PLACEHOLDER_M1649');
    assert.equal(torveEntry[1].model, 'MODEL_PLACEHOLDER_M1649');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('streamGenerateContent routes Torve IDs locally and native Google IDs upstream', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'torve-antigravity-route-'));
  const identityPath = path.join(dir, 'ids.json');
  const calls: Array<{ url: string; authorization: string | null; body: string }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? init.body : init?.body instanceof Uint8Array ? new TextDecoder().decode(init.body) : '';
    calls.push({ url: String(url), authorization: headers.get('authorization'), body });
    if (String(url).includes('fetchAvailableModels')) return new Response(JSON.stringify(catalog), { status: 200, headers: { 'content-type': 'application/json' } });
    if (String(url).startsWith('https://torve.example')) {
      const frames = [
        { choices: [{ delta: { reasoning_content: 'thinking ' } }] },
        { choices: [{ delta: { content: 'answer' } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'read_file', arguments: '{"path":"a"}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 5, completion_tokens: 7 } },
      ].map((value) => `data: ${JSON.stringify(value)}\n\n`).join('') + 'data: [DONE]\n\n';
      return new Response(frames, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    return new Response(JSON.stringify({ native: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    const catalogResult = await handleAntigravityV1Internal(request('/v1internal:fetchAvailableModels'), { apiKey: 'torve-key', models, fetchImpl, googleUpstream: 'https://google.example', torveUpstream: 'https://torve.example', identityPath });
    const catalogBody = await catalogResult.response.json() as { models: Record<string, { displayName?: string }> };
    const torveId = Object.entries(catalogBody.models).find(([, value]) => value.displayName === 'Torve Reasoner')![0];
    calls.length = 0;

    const routed = await handleAntigravityV1Internal(request('/v1internal:streamGenerateContent?alt=sse', { model: torveId, request: { contents: [{ role: 'user', parts: [{ text: 'hello' }] }] } }), { apiKey: 'torve-key', models, fetchImpl, googleUpstream: 'https://google.example', torveUpstream: 'https://torve.example', identityPath });
    const routedText = await routed.response.text();
    assert.equal(routed.meta.torveRouted, true);
    assert.equal(calls[0]?.url, 'https://torve.example/v1/chat/completions');
    assert.equal(calls[0]?.authorization, 'Bearer torve-key');
    assert.equal((JSON.parse(calls[0]!.body) as { model: string }).model, 'torve-reasoner');
    assert.match(routedText, /"thought":true/);
    assert.match(routedText, /"text":"answer"/);
    assert.match(routedText, /"functionCall":\{"name":"read_file"/);
    assert.deepEqual(routed.meta.usage, { inputTokens: 5, outputTokens: 7 });

    calls.length = 0;
    const native = await handleAntigravityV1Internal(request('/v1internal:streamGenerateContent?alt=sse', { model: 'gemini-native', request: {} }), { apiKey: 'torve-key', models, fetchImpl, googleUpstream: 'https://google.example', torveUpstream: 'https://torve.example', identityPath });
    assert.equal(native.meta.torveRouted, false);
    assert.equal(calls[0]?.url, 'https://google.example/v1internal:streamGenerateContent?alt=sse');
    assert.equal(calls[0]?.authorization, 'Bearer google-user-token');
    assert.deepEqual(await native.response.json(), { native: true });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('loadCodeAssist, listExperiments, and unknown v1internal calls pass through with Google auth', async () => {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), authorization: new Headers(init?.headers).get('authorization') });
    return new Response('{"google":true}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  for (const endpoint of ['loadCodeAssist', 'listExperiments', 'futureEndpoint']) {
    const result = await handleAntigravityV1Internal(request(`/v1internal:${endpoint}`), { apiKey: 'torve-key', models, fetchImpl, googleUpstream: 'https://google.example', torveUpstream: 'https://torve.example' });
    assert.deepEqual(await result.response.json(), { google: true });
  }
  assert.deepEqual(calls.map((call) => call.url), [
    'https://google.example/v1internal:loadCodeAssist',
    'https://google.example/v1internal:listExperiments',
    'https://google.example/v1internal:futureEndpoint',
  ]);
  assert.ok(calls.every((call) => call.authorization === 'Bearer google-user-token'));
});

test('slash-form v1internal endpoints pass through unchanged', async () => {
  let seen = '';
  const fetchImpl = (async (url: string | URL | Request) => { seen = String(url); return new Response('{}', { status: 200 }); }) as typeof fetch;
  const result = await handleAntigravityV1Internal({ ...request('/v1internal/cascadeNuxes?page_size=1000'), method: 'GET' }, { apiKey: 'torve-key', models, fetchImpl, googleUpstream: 'https://google.example', torveUpstream: 'https://torve.example' });
  assert.equal(result.response.status, 200);
  assert.equal(seen, 'https://google.example/v1internal/cascadeNuxes?page_size=1000');
});

test('streamGenerateContent flushes thought, text, and functionCall chunks immediately without stream-wide buffering', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'torve-antigravity-unbuffered-'));
  const identityPath = path.join(dir, 'ids.json');
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let streamController!: ReadableStreamDefaultController<Uint8Array>;

  const fetchImpl = (async (url: string | URL | Request) => {
    if (String(url).includes('fetchAvailableModels')) {
      return new Response(JSON.stringify(catalog), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const upstreamStream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });
    return new Response(upstreamStream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch;

  try {
    const catalogResult = await handleAntigravityV1Internal(
      request('/v1internal:fetchAvailableModels'),
      { apiKey: 'torve-key', models, fetchImpl, googleUpstream: 'https://google.example', torveUpstream: 'https://torve.example', identityPath },
    );
    const catalogBody = await catalogResult.response.json() as { models: Record<string, { displayName?: string }> };
    const torveId = Object.entries(catalogBody.models).find(([, value]) => value.displayName === 'Torve Reasoner')![0];

    const streamed = await handleAntigravityV1Internal(
      request('/v1internal:streamGenerateContent?alt=sse', { model: torveId, request: { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] } }),
      { apiKey: 'torve-key', models, fetchImpl, googleUpstream: 'https://google.example', torveUpstream: 'https://torve.example', identityPath },
    );
    const reader = streamed.response.body!.getReader();

    // 1. Push thought chunk only — must flush immediately before text/EOF arrives.
    streamController.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { reasoning: 'step 1' } }] })}\n`));
    const chunk1 = decoder.decode((await reader.read()).value);
    assert.match(chunk1, /"thought":true/);
    assert.match(chunk1, /"text":"step 1"/);

    // 2. Push text chunk — must flush immediately.
    streamController.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'hello' } }] })}\n`));
    const chunk2 = decoder.decode((await reader.read()).value);
    assert.match(chunk2, /"text":"hello"/);

    // 3. Push split functionCall arguments across two chunks — must flush immediately once JSON completes, before [DONE]/close.
    streamController.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'read_file', arguments: '{"path":' } }] } }] })}\n`));
    streamController.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"b.ts"}' } }] } }] })}\n`));
    const chunk3 = decoder.decode((await reader.read()).value);
    assert.match(chunk3, /"functionCall":\{"name":"read_file","args":\{"path":"b\.ts"\}\}/);

    // 4. Close upstream and read final finish frame.
    streamController.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 4 } })}\ndata: [DONE]\n`));
    streamController.close();
    const rest: string[] = [];
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      rest.push(decoder.decode(next.value));
    }
    const tail = rest.join('');
    assert.match(tail, /"finishReason":"STOP"/);
    assert.match(tail, /"promptTokenCount":10/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
