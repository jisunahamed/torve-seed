import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { DesktopAppUsageRow, DesktopModelUsageRow, DesktopUsageRange, DesktopUsageResponse } from './desktop-api.js';

export const USAGE_STATS_PATH = path.join(homedir(), '.torve', 'usage-stats.json');
const MAX_BUCKET_AGE_MS = 31 * 24 * 60 * 60 * 1000;

export type TokenUsageCounts = {
  inputTokens: number;
  outputTokens: number;
};

type UsageBucketEntry = {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalLatencyMs: number;
  lastUsedAt: string;
};

type UsageHourBucket = {
  byModel: Record<string, UsageBucketEntry>;
  byApp: Record<string, UsageBucketEntry>;
};

export type PersistedUsageStats = {
  version: 1;
  buckets: Record<string, UsageHourBucket>;
};

const RANGE_MS: Record<DesktopUsageRange, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

/** Strictly sanitize to lowercase [a-z][a-z0-9-]* (1-64 chars) for X-Torve-Client-App. */
export function sanitizeTorveClientApp(rawAppId: string | null | undefined): string {
  if (typeof rawAppId !== 'string') return 'torve-desktop';
  const normalized = rawAppId
    .trim()
    .toLowerCase()
    .replace(/[_\s.]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[^a-z]+/, '')
    .slice(0, 64)
    .replace(/-+$/, '');
  return /^[a-z][a-z0-9-]{0,63}$/.test(normalized) ? normalized : 'torve-desktop';
}

export function extractTokenUsageFromRecord(raw: unknown): TokenUsageCounts | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const root = raw as Record<string, unknown>;
  const responseObj = root['response'] && typeof root['response'] === 'object'
    ? (root['response'] as Record<string, unknown>)
    : null;
  const messageObj = root['message'] && typeof root['message'] === 'object'
    ? (root['message'] as Record<string, unknown>)
    : null;
  const usageRaw = root['usage']
    ?? responseObj?.['usage']
    ?? messageObj?.['usage']
    ?? root['usageMetadata'];
  if (!usageRaw || typeof usageRaw !== 'object' || Array.isArray(usageRaw)) return null;
  const u = usageRaw as Record<string, unknown>;
  const inputRaw = u['prompt_tokens'] ?? u['input_tokens'] ?? u['promptTokenCount'] ?? 0;
  const outputRaw = u['completion_tokens'] ?? u['output_tokens'] ?? u['candidatesTokenCount'] ?? 0;
  const input = typeof inputRaw === 'number' && Number.isFinite(inputRaw) ? Math.max(0, Math.round(inputRaw)) : 0;
  const output = typeof outputRaw === 'number' && Number.isFinite(outputRaw) ? Math.max(0, Math.round(outputRaw)) : 0;
  if (input === 0 && output === 0 && !('prompt_tokens' in u) && !('input_tokens' in u) && !('completion_tokens' in u) && !('output_tokens' in u) && !('promptTokenCount' in u)) {
    return null;
  }
  return { inputTokens: input, outputTokens: output };
}

/** Incremental token extractor for streamed SSE bytes (no prompt/response content kept). */
export class SseUsageTracker {
  private readonly decoder = new TextDecoder();
  private buffer = '';
  private inputTokens = 0;
  private outputTokens = 0;
  private seen = false;

  push(chunk: Uint8Array): void {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      this.consumeLine(line);
    }
  }

  finish(): TokenUsageCounts | null {
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
      const parsed = JSON.parse(payload) as unknown;
      const extracted = extractTokenUsageFromRecord(parsed);
      if (!extracted) return;
      this.seen = true;
      if (extracted.inputTokens > this.inputTokens) this.inputTokens = extracted.inputTokens;
      if (extracted.outputTokens > this.outputTokens) this.outputTokens = extracted.outputTokens;
    } catch {
      /* ignore partial or malformed SSE lines */
    }
  }
}

function hourKeyForTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 13);
}

function hourKeyToTimestamp(key: string): number {
  const parsed = Date.parse(`${key}:00:00.000Z`);
  return Number.isFinite(parsed) ? parsed : 0;
}

function emptyStats(): PersistedUsageStats {
  return { version: 1, buckets: {} };
}

function addEntry(
  target: Record<string, UsageBucketEntry>,
  key: string,
  inputTokens: number,
  outputTokens: number,
  latencyMs: number,
  isoTime: string,
): void {
  const existing = target[key];
  if (existing) {
    existing.requests += 1;
    existing.inputTokens += inputTokens;
    existing.outputTokens += outputTokens;
    existing.totalLatencyMs += latencyMs;
    if (isoTime > existing.lastUsedAt) existing.lastUsedAt = isoTime;
    return;
  }
  target[key] = {
    requests: 1,
    inputTokens,
    outputTokens,
    totalLatencyMs: latencyMs,
    lastUsedAt: isoTime,
  };
}

let writeChain: Promise<void> = Promise.resolve();

async function readStats(filePath: string): Promise<PersistedUsageStats> {
  try {
    const raw = JSON.parse(await readFile(filePath, 'utf8')) as Partial<PersistedUsageStats>;
    if (raw?.version !== 1 || !raw.buckets || typeof raw.buckets !== 'object') return emptyStats();
    return { version: 1, buckets: raw.buckets };
  } catch {
    return emptyStats();
  }
}

async function saveStats(filePath: string, stats: PersistedUsageStats): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(temp, `${JSON.stringify(stats)}\n`, { mode: 0o600 });
  await rename(temp, filePath);
}

export function recordLocalUsage(
  event: {
    modelId: string | null;
    appId: string | null;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    timestampMs?: number;
  },
  filePath = USAGE_STATS_PATH,
): Promise<void> {
  const nowMs = event.timestampMs ?? Date.now();
  const modelKey = (event.modelId || 'auto').trim() || 'auto';
  const appKey = sanitizeTorveClientApp(event.appId);
  const input = Math.max(0, Math.round(event.inputTokens));
  const output = Math.max(0, Math.round(event.outputTokens));
  const latency = Math.max(0, Math.round(event.latencyMs));
  const isoTime = new Date(nowMs).toISOString();
  const hourKey = hourKeyForTimestamp(nowMs);
  const cutoff = nowMs - MAX_BUCKET_AGE_MS;

  const task = writeChain.then(async () => {
    const stats = await readStats(filePath);
    for (const existingKey of Object.keys(stats.buckets)) {
      if (hourKeyToTimestamp(existingKey) < cutoff) {
        delete stats.buckets[existingKey];
      }
    }
    const bucket = stats.buckets[hourKey] ?? { byModel: {}, byApp: {} };
    addEntry(bucket.byModel, modelKey, input, output, latency, isoTime);
    addEntry(bucket.byApp, appKey, input, output, latency, isoTime);
    stats.buckets[hourKey] = bucket;
    await saveStats(filePath, stats);
  });

  writeChain = task.catch(() => {});
  return task;
}

export async function getLocalUsageSummary(
  range: DesktopUsageRange = '7d',
  filePath = USAGE_STATS_PATH,
  nowMs = Date.now(),
): Promise<DesktopUsageResponse> {
  await writeChain;
  const stats = await readStats(filePath);
  const cutoff = nowMs - RANGE_MS[range];

  let totalRequests = 0;
  let totalInput = 0;
  let totalOutput = 0;
  const modelsMap = new Map<string, UsageBucketEntry>();
  const appsMap = new Map<string, UsageBucketEntry>();

  const mergeInto = (map: Map<string, UsageBucketEntry>, key: string, src: UsageBucketEntry) => {
    const existing = map.get(key);
    if (existing) {
      existing.requests += src.requests;
      existing.inputTokens += src.inputTokens;
      existing.outputTokens += src.outputTokens;
      existing.totalLatencyMs += src.totalLatencyMs;
      if (src.lastUsedAt > existing.lastUsedAt) existing.lastUsedAt = src.lastUsedAt;
    } else {
      map.set(key, { ...src });
    }
  };

  for (const [hourKey, bucket] of Object.entries(stats.buckets)) {
    if (hourKeyToTimestamp(hourKey) < cutoff) continue;
    for (const [modelId, entry] of Object.entries(bucket.byModel ?? {})) {
      mergeInto(modelsMap, modelId, entry);
      totalRequests += entry.requests;
      totalInput += entry.inputTokens;
      totalOutput += entry.outputTokens;
    }
    for (const [appId, entry] of Object.entries(bucket.byApp ?? {})) {
      mergeInto(appsMap, appId, entry);
    }
  }

  const byModel: DesktopModelUsageRow[] = [...modelsMap.entries()]
    .map(([modelId, entry]) => ({
      modelId,
      requests: entry.requests,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      totalTokens: entry.inputTokens + entry.outputTokens,
      avgLatencyMs: entry.requests > 0 ? Math.round(entry.totalLatencyMs / entry.requests) : null,
      lastUsedAt: entry.lastUsedAt || null,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens || b.requests - a.requests);

  const byApp: DesktopAppUsageRow[] = [...appsMap.entries()]
    .map(([appId, entry]) => ({
      appId,
      requests: entry.requests,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      totalTokens: entry.inputTokens + entry.outputTokens,
      lastUsedAt: entry.lastUsedAt || null,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens || b.requests - a.requests);

  return {
    range,
    scope: 'local',
    totals: {
      requests: totalRequests,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      totalTokens: totalInput + totalOutput,
    },
    byModel,
    byApp,
  };
}

const DEFAULT_HOP_BY_HOP = new Set([
  'connection',
  'host',
  'content-length',
  'transfer-encoding',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'upgrade',
]);

/** Build upstream request headers with Bearer auth and exactly one sanitized
 *  `x-torve-client-app` attribution header. */
export function buildTorveUpstreamHeaders(
  headers: Record<string, string>,
  apiKey: string,
  appId: string | null = null,
  hopByHop: ReadonlySet<string> = DEFAULT_HOP_BY_HOP,
): Record<string, string> {
  const result: Record<string, string> = {
    authorization: `Bearer ${apiKey}`,
    accept: 'application/json, text/event-stream',
    'x-torve-client-app': sanitizeTorveClientApp(appId),
  };
  for (const [key, value] of Object.entries(headers)) {
    const normalized = key.toLowerCase();
    // Claude Code sends an intentionally fake local x-api-key; never let it
    // or spoofed client headers shadow the real Torve cloud credentials.
    if (
      hopByHop.has(normalized)
      || normalized === 'authorization'
      || normalized === 'x-api-key'
      || normalized === 'api-key'
      || normalized === 'x-torve-client-app'
    ) {
      continue;
    }
    result[key] = value;
  }
  return result;
}
