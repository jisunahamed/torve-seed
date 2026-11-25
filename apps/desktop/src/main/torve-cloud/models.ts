import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const LEGACY_CACHE_PATH = path.join(homedir(), '.torve', 'desktop-models.json');
const CACHE_PATH = path.join(homedir(), '.torve', 'models-cache.json');
const TTL_MS = 5 * 60_000;

export type TorveModel = { id: string; object?: string; owned_by?: string; [key: string]: unknown };
type Cache = { updatedAt: number; models: TorveModel[] };

let cache: Cache | null = null;
let refreshInFlight: Promise<TorveModel[]> | null = null;
let modelsUpdatedSink: ((status: { models: TorveModel[]; updatedAt: number | null; stale: boolean; upstream: string }) => void) | null = null;

export function setTorveModelsUpdatedSink(
  sink: ((status: { models: TorveModel[]; updatedAt: number | null; stale: boolean; upstream: string }) => void) | null,
): void {
  modelsUpdatedSink = sink;
}

export function torveCloudUpstream(): string {
  return (process.env['TORVE_CLOUD_API_URL'] || 'https://api.torveai.com').replace(/\/+$/, '');
}

async function readCacheFile(filePath: string): Promise<Cache | null> {
  try {
    const data = JSON.parse(await readFile(filePath, 'utf8')) as Partial<Cache>;
    if (typeof data.updatedAt !== 'number' || !Array.isArray(data.models)) return null;
    const models = data.models.filter((m): m is TorveModel => Boolean(m && typeof m === 'object' && typeof m.id === 'string'));
    if (models.length === 0) return null;
    return { updatedAt: data.updatedAt, models };
  } catch {
    return null;
  }
}

async function load(): Promise<Cache | null> {
  if (cache && cache.models.length > 0) return cache;
  const [primary, legacy] = await Promise.all([readCacheFile(CACHE_PATH), readCacheFile(LEGACY_CACHE_PATH)]);
  const chosen = primary && legacy
    ? (primary.updatedAt >= legacy.updatedAt ? primary : legacy)
    : (primary ?? legacy);
  if (chosen) cache = chosen;
  return cache;
}

async function saveFile(filePath: string, next: Cache): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(next) + '\n', { mode: 0o600 });
  await rename(temp, filePath);
}

async function save(next: Cache): Promise<void> {
  cache = next;
  await Promise.all([
    saveFile(CACHE_PATH, next),
    saveFile(LEGACY_CACHE_PATH, next).catch(() => {}),
  ]);
  modelsUpdatedSink?.({
    models: next.models,
    updatedAt: next.updatedAt,
    stale: false,
    upstream: torveCloudUpstream(),
  });
}

export async function refreshTorveCloudModels(apiKey: string, opts: { force?: boolean } = {}): Promise<TorveModel[]> {
  const current = await load();
  if (!opts.force && current && current.models.length > 0 && Date.now() - current.updatedAt < TTL_MS) {
    return current.models;
  }
  if (refreshInFlight && !opts.force) {
    return refreshInFlight;
  }

  const run = (async () => {
    const response = await fetch(`${torveCloudUpstream()}/v1/models`, {
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json',
        'x-torve-client-app': 'torve-desktop',
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`Torve API key validation failed (${response.status}).`);
    const payload = await response.json() as { data?: unknown; models?: unknown };
    const list = Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload.models)
        ? payload.models
        : null;
    if (!list) throw new Error('Torve returned an invalid model catalog.');
    const models = list.filter((m): m is TorveModel => Boolean(m && typeof m === 'object' && typeof (m as TorveModel).id === 'string'));
    await save({ updatedAt: Date.now(), models });
    return models;
  })();

  refreshInFlight = run;
  try {
    return await run;
  } finally {
    if (refreshInFlight === run) refreshInFlight = null;
  }
}

export async function torveCloudModelsStatus(): Promise<{ models: TorveModel[]; updatedAt: number | null; stale: boolean; upstream: string }> {
  const current = await load();
  return {
    models: current?.models ?? [],
    updatedAt: current?.updatedAt ?? null,
    stale: !current || Date.now() - current.updatedAt >= TTL_MS,
    upstream: torveCloudUpstream(),
  };
}
