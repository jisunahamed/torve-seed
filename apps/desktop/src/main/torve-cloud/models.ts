import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const CACHE_PATH = path.join(homedir(), '.torve', 'desktop-models.json');
const TTL_MS = 5 * 60_000;
export type TorveModel = { id: string; object?: string; owned_by?: string; [key: string]: unknown };
type Cache = { updatedAt: number; models: TorveModel[] };
let cache: Cache | null = null;
export function torveCloudUpstream(): string { return (process.env['TORVE_CLOUD_API_URL'] || 'https://api.torveai.com').replace(/\/+$/, ''); }
async function load(): Promise<Cache | null> { if (cache) return cache; try { const data = JSON.parse(await readFile(CACHE_PATH, 'utf8')) as Partial<Cache>; if (typeof data.updatedAt !== 'number' || !Array.isArray(data.models)) return null; return cache = { updatedAt: data.updatedAt, models: data.models.filter((m): m is TorveModel => Boolean(m && typeof m.id === 'string')) }; } catch { return null; } }
async function save(next: Cache): Promise<void> { cache = next; await mkdir(path.dirname(CACHE_PATH), { recursive: true }); const temp = `${CACHE_PATH}.tmp`; await writeFile(temp, JSON.stringify(next) + '\n', { mode: 0o600 }); await rename(temp, CACHE_PATH); }
export async function refreshTorveCloudModels(apiKey: string, opts: { force?: boolean } = {}): Promise<TorveModel[]> { const current = await load(); if (!opts.force && current && Date.now() - current.updatedAt < TTL_MS) return current.models; const response = await fetch(`${torveCloudUpstream()}/v1/models`, { headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json', 'x-torve-client-app': 'torve-desktop' }, signal: AbortSignal.timeout(12_000) }); if (!response.ok) throw new Error(`Torve API key validation failed (${response.status}).`); const payload = await response.json() as { data?: unknown }; if (!Array.isArray(payload.data)) throw new Error('Torve returned an invalid model catalog.'); const models = payload.data.filter((m): m is TorveModel => Boolean(m && typeof m === 'object' && typeof (m as TorveModel).id === 'string')); await save({ updatedAt: Date.now(), models }); return models; }
export async function torveCloudModelsStatus(): Promise<{ models: TorveModel[]; updatedAt: number | null; stale: boolean; upstream: string }> { const current = await load(); return { models: current?.models ?? [], updatedAt: current?.updatedAt ?? null, stale: !current || Date.now() - current.updatedAt >= TTL_MS, upstream: torveCloudUpstream() }; }
