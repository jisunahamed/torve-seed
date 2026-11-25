import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { TorveModel } from './models.js';

export const CODEX_CATALOG_PATH = path.join(homedir(), '.torve', 'codex-model-catalog.json');
export const CODEX_MODELS_CACHE_PATH = path.join(homedir(), '.codex', 'models_cache.json');
export const CODEX_CATALOG_MAX_BYTES = 1024 * 1024;

export type CodexCatalogModel = Record<string, unknown> & {
  slug: string; display_name: string; description: string; visibility: 'list'; supported_in_api: true; priority: number;
};
type CodexCatalog = { models: CodexCatalogModel[]; [key: string]: unknown };

function catalogCandidates(): string[] {
  return [CODEX_MODELS_CACHE_PATH, path.join(homedir(), '.codex', 'codex-router', 'native-models.json'), path.join(homedir(), '.codex', 'codex-router', 'merged-models.json')];
}
function readCatalog(filePath: string): CodexCatalog | null {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    if (!Array.isArray(parsed['models'])) return null;
    const models = parsed['models'].filter((item): item is CodexCatalogModel => Boolean(item && typeof item === 'object' && typeof (item as Record<string, unknown>)['slug'] === 'string'));
    return models.length > 0 ? { ...parsed, models } : null;
  } catch { return null; }
}
export function installedCodexCatalog(): CodexCatalog {
  for (const candidate of catalogCandidates()) { const catalog = readCatalog(candidate); if (catalog) return catalog; }
  throw new Error('No valid installed Codex model catalog was found. Start Codex once, then reconnect it in Torve Desktop.');
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function numberValue(...values: unknown[]): number | undefined { for (const value of values) if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value; return undefined; }

function firstReasoningLevel(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const first = value[0];
  return first && typeof first === 'object' ? [clone(first as Record<string, unknown>)] : null;
}

/** Merge native models and complete Torve entries cloned from the smallest
 * installed valid model. The clone retains every strict serde field required
 * by this exact Codex build, including fields added by future versions. */
export function codexCatalogPayload(models: readonly TorveModel[], base = installedCodexCatalog()): CodexCatalog {
  const native = base.models.map(clone);
  const template = native.reduce((smallest, item) => JSON.stringify(item).length < JSON.stringify(smallest).length ? item : smallest);
  const nativeSlugs = new Set(native.map((model) => model.slug));
  const torve = models.filter((model) => !nativeSlugs.has(model.id)).map((model, index) => {
    const entry = clone(template);
    entry.slug = model.id;
    entry.display_name = typeof model['display_name'] === 'string' ? model['display_name'] : typeof model['name'] === 'string' ? model['name'] : `Torve · ${model.id}`;
    entry.description = typeof model['description'] === 'string' ? model['description'] : 'Available through Direct Torve Cloud.';
    entry.visibility = 'list'; entry.supported_in_api = true; entry.priority = index;
    // Do not inherit deprecation/upgrade banners from the cloned native template.
    if ('upgrade' in entry) entry['upgrade'] = null;
    if ('availability_nux' in entry) entry['availability_nux'] = null;
    // Codex Desktop opens in "simple" view without the model list or slider when
    // `auto` exposes 2+ reasoning levels; keeping 1 level opens the full picker.
    if (model.id === 'auto') {
      const singleLevel = firstReasoningLevel(entry['supported_reasoning_levels']);
      if (singleLevel) {
        entry['supported_reasoning_levels'] = singleLevel;
        const level = singleLevel[0];
        if (level && typeof level['effort'] === 'string') entry['default_reasoning_level'] = level['effort'];
      }
    }
    const context = numberValue(model['max_input_tokens'], model['context_window'], model['context_length']);
    if (context !== undefined) { entry['context_window'] = context; entry['max_context_window'] = context; }
    return entry;
  });
  return { ...base, models: [...native, ...torve] };
}
export function modelsEndpointPayload(models: readonly TorveModel[], clientVersion: string | null): CodexCatalog | { object: 'list'; data: readonly TorveModel[] } {
  return clientVersion !== null ? codexCatalogPayload(models) : { object: 'list', data: models };
}
export async function writeCodexModelCatalog(models: readonly TorveModel[], filePath = CODEX_CATALOG_PATH): Promise<string> {
  const bytes = Buffer.from(`${JSON.stringify(codexCatalogPayload(models), null, 2)}\n`);
  if (bytes.byteLength >= CODEX_CATALOG_MAX_BYTES) throw new Error('Merged Codex model catalog exceeds Codex\'s 1 MiB limit.');
  await mkdir(path.dirname(filePath), { recursive: true }); const temp = `${filePath}.${process.pid}.tmp`;
  await writeFile(temp, bytes, { mode: 0o600 }); await rename(temp, filePath); return filePath;
}
export async function invalidateCodexModelsCache(filePath = CODEX_MODELS_CACHE_PATH): Promise<void> {
  if (!existsSync(filePath)) return; try { await unlink(filePath); } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
}
export async function removeCodexModelCatalog(filePath = CODEX_CATALOG_PATH): Promise<void> {
  if (!existsSync(filePath)) return; try { await unlink(filePath); } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
}
