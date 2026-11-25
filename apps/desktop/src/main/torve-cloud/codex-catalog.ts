import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { TorveModel } from './models.js';

export const CODEX_CATALOG_PATH = path.join(homedir(), '.torve', 'codex-model-catalog.json');
export const CODEX_MODELS_CACHE_PATH = path.join(homedir(), '.codex', 'models_cache.json');
export const CODEX_CATALOG_MAX_BYTES = 1024 * 1024;

export type CodexCatalogModel = Record<string, unknown> & {
  slug: string;
  display_name: string;
  description: string;
  visibility: 'list';
  supported_in_api: true;
  priority: number;
};
export type CodexCatalog = { models: CodexCatalogModel[]; [key: string]: unknown };

/** Built-in baseline Codex serde schema used only when no local Codex cache exists yet. */
export const FALLBACK_CODEX_MODEL_TEMPLATE: CodexCatalogModel = {
  slug: 'gpt-5.4-mini',
  display_name: 'GPT-5.4-Mini',
  description: 'Small, fast, and cost-efficient model for simpler coding tasks.',
  default_reasoning_level: 'medium',
  supported_reasoning_levels: [
    { effort: 'low', description: 'Fast responses with lighter reasoning' },
    { effort: 'medium', description: 'Balances speed and reasoning depth for everyday tasks' },
    { effort: 'high', description: 'Greater reasoning depth for complex problems' },
    { effort: 'xhigh', description: 'Extra high reasoning depth for complex problems' },
  ],
  shell_type: 'shell_command',
  visibility: 'list',
  supported_in_api: true,
  priority: 23,
  additional_speed_tiers: [],
  service_tiers: [],
  availability_nux: null,
  upgrade: null,
  include_skills_usage_instructions: true,
  include_plugin_usage_instructions: true,
  include_apps_usage_instructions: true,
  default_reasoning_summary: 'none',
  support_verbosity: true,
  default_verbosity: 'medium',
  apply_patch_tool_type: 'freeform',
  web_search_tool_type: 'text_and_image',
  truncation_policy: { mode: 'tokens', limit: 10000 },
  supports_image_detail_original: true,
  context_window: 272000,
  max_context_window: 272000,
  effective_context_window_percent: 95,
  experimental_supported_tools: [],
  input_modalities: ['text', 'image'],
  supports_search_tool: true,
  use_responses_lite: false,
  node_repl_auto_review_required: false,
  node_repl_disabled: false,
  base_instructions: 'You are Codex, a coding agent.',
};

export const FALLBACK_CODEX_CATALOG: CodexCatalog = {
  models: [FALLBACK_CODEX_MODEL_TEMPLATE],
};

function catalogCandidates(): string[] {
  return [
    CODEX_MODELS_CACHE_PATH,
    path.join(homedir(), '.codex', 'codex-router', 'native-models.json'),
    path.join(homedir(), '.codex', 'codex-router', 'merged-models.json'),
  ];
}

export function readCodexCatalogFile(filePath: string): CodexCatalog | null {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    if (!Array.isArray(parsed['models'])) return null;
    const models = parsed['models'].filter((item): item is CodexCatalogModel => (
      Boolean(item && typeof item === 'object' && typeof (item as Record<string, unknown>)['slug'] === 'string')
    ));
    return models.length > 0 ? { ...parsed, models } : null;
  } catch {
    return null;
  }
}

export function installedCodexCatalog(candidates: readonly string[] = catalogCandidates()): CodexCatalog {
  for (const candidate of candidates) {
    const catalog = readCodexCatalogFile(candidate);
    if (catalog) return catalog;
  }
  return clone(FALLBACK_CODEX_CATALOG);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function numberValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

function firstReasoningLevel(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const first = value[0];
  return first && typeof first === 'object' ? [clone(first as Record<string, unknown>)] : null;
}

/** Merge native models and complete Torve entries cloned from the smallest
 * installed valid model (or the built-in baseline schema when no local cache
 * exists). The clone retains every strict serde field required by Codex. */
export function codexCatalogPayload(models: readonly TorveModel[], base = installedCodexCatalog()): CodexCatalog {
  const native = base.models.map(clone);
  const template = native.reduce((smallest, item) => (
    JSON.stringify(item).length < JSON.stringify(smallest).length ? item : smallest
  ));
  const nativeSlugs = new Set(native.map((model) => model.slug));
  const torve = models.filter((model) => !nativeSlugs.has(model.id)).map((model, index) => {
    const entry = clone(template);
    entry.slug = model.id;
    entry.display_name = typeof model['display_name'] === 'string'
      ? model['display_name']
      : typeof model['name'] === 'string'
        ? model['name']
        : `Torve · ${model.id}`;
    entry.description = typeof model['description'] === 'string'
      ? model['description']
      : 'Available through Direct Torve Cloud.';
    entry.visibility = 'list';
    entry.supported_in_api = true;
    entry.priority = index;
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
    const rawContext = numberValue(model['max_input_tokens'], model['context_window'], model['context_length']);
    // Raise the floor so 100K+ token Codex sessions never get "no model" / context limit errors.
    // 1M-capable models keep their full window; all others get at least 200K.
    const context = rawContext !== undefined
      ? (rawContext >= 500_000 ? rawContext : Math.max(rawContext, 200_000))
      : 200_000;
    entry['context_window'] = context;
    entry['max_context_window'] = context;
    // Allow sessions that fill up to 95% of the window (Codex default is already 95%,
    // but some older templates hard-code lower values).
    if (typeof entry['effective_context_window_percent'] === 'number' && (entry['effective_context_window_percent'] as number) < 90) {
      entry['effective_context_window_percent'] = 95;
    }
    return entry;
  });
  return { ...base, models: [...native, ...torve] };
}

export function modelsEndpointPayload(
  models: readonly TorveModel[],
  clientVersion: string | null,
  base?: CodexCatalog,
): CodexCatalog | { object: 'list'; data: readonly TorveModel[] } {
  return clientVersion !== null ? codexCatalogPayload(models, base) : { object: 'list', data: models };
}

export async function writeCodexModelCatalog(
  models: readonly TorveModel[],
  filePath = CODEX_CATALOG_PATH,
  base?: CodexCatalog,
): Promise<string> {
  const bytes = Buffer.from(`${JSON.stringify(codexCatalogPayload(models, base), null, 2)}\n`);
  if (bytes.byteLength >= CODEX_CATALOG_MAX_BYTES) {
    throw new Error('Merged Codex model catalog exceeds Codex\'s 1 MiB limit.');
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  await writeFile(temp, bytes, { mode: 0o600 });
  await rename(temp, filePath);
  return filePath;
}

export async function invalidateCodexModelsCache(filePath = CODEX_MODELS_CACHE_PATH): Promise<void> {
  if (!existsSync(filePath)) return;
  try {
    await unlink(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

export async function removeCodexModelCatalog(filePath = CODEX_CATALOG_PATH): Promise<void> {
  if (!existsSync(filePath)) return;
  try {
    await unlink(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}
