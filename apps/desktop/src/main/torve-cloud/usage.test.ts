import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildTorveUpstreamHeaders,
  extractTokenUsageFromRecord,
  getLocalUsageSummary,
  recordLocalUsage,
  sanitizeTorveClientApp,
  SseUsageTracker,
} from './usage.js';

test('upstreamHeaders attaches exactly one sanitized X-Torve-Client-App header', () => {
  const headers = buildTorveUpstreamHeaders({
    authorization: 'Bearer old',
    'x-api-key': 'old2',
    'X-Torve-Client-App': 'Spoofed_App!!',
    'content-type': 'application/json',
  }, 'sk-trv-secret', 'Claude_Desktop');
  const clientAppKeys = Object.keys(headers).filter((k) => k.toLowerCase() === 'x-torve-client-app');
  assert.deepEqual(clientAppKeys, ['x-torve-client-app']);
  assert.equal(headers['x-torve-client-app'], 'claude-desktop');
  assert.equal(headers['authorization'], 'Bearer sk-trv-secret');
  assert.equal(headers['x-api-key'], undefined);
});

test('sanitizeTorveClientApp enforces [a-z][a-z0-9-]* (1-64 chars)', () => {
  assert.equal(sanitizeTorveClientApp('codex'), 'codex');
  assert.equal(sanitizeTorveClientApp('Claude-Desktop'), 'claude-desktop');
  assert.equal(sanitizeTorveClientApp('claude_code'), 'claude-code');
  assert.equal(sanitizeTorveClientApp('gemini_cli'), 'gemini-cli');
  assert.equal(sanitizeTorveClientApp(null), 'torve-desktop');
  assert.equal(sanitizeTorveClientApp('123bad!name'), 'bad-name');
  assert.equal(sanitizeTorveClientApp('999'), 'torve-desktop');
  assert.ok(sanitizeTorveClientApp('a'.repeat(100)).length <= 64);
});

test('SseUsageTracker extracts tokens from OpenAI and Anthropic SSE chunks', () => {
  const tracker = new SseUsageTracker();
  tracker.push(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'));
  tracker.push(new TextEncoder().encode('data: {"usage":{"prompt_tokens":120,"completion_tokens":35}}\n\n'));
  tracker.push(new TextEncoder().encode('data: [DONE]\n\n'));
  assert.deepEqual(tracker.finish(), { inputTokens: 120, outputTokens: 35 });

  const anthropic = extractTokenUsageFromRecord({
    type: 'message_delta',
    usage: { input_tokens: 80, output_tokens: 19 },
  });
  assert.deepEqual(anthropic, { inputTokens: 80, outputTokens: 19 });
});

test('local usage ledger aggregates counters per model and app without storing content', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'torve-usage-'));
  const statsPath = path.join(dir, 'usage-stats.json');
  const now = Date.parse('2026-11-25T15:00:00.000Z');
  try {
    await recordLocalUsage({
      modelId: 'deepseek-v4-1-flash',
      appId: 'codex',
      inputTokens: 1000,
      outputTokens: 250,
      latencyMs: 420,
      timestampMs: now - 3600_000,
    }, statsPath);
    await recordLocalUsage({
      modelId: 'gemma-4',
      appId: 'Claude_Desktop',
      inputTokens: 400,
      outputTokens: 100,
      latencyMs: 300,
      timestampMs: now - 40 * 3600_000,
    }, statsPath);

    const day = await getLocalUsageSummary('24h', statsPath, now);
    assert.equal(day.totals.requests, 1);
    assert.equal(day.totals.totalTokens, 1250);
    assert.equal(day.byModel[0]?.modelId, 'deepseek-v4-1-flash');
    assert.equal(day.byApp[0]?.appId, 'codex');

    const week = await getLocalUsageSummary('7d', statsPath, now);
    assert.equal(week.totals.requests, 2);
    assert.equal(week.totals.totalTokens, 1750);
    assert.equal(week.byApp.some((row) => row.appId === 'claude-desktop'), true);

    const raw = await readFile(statsPath, 'utf8');
    assert.equal(raw.includes('prompt'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
