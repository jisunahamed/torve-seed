import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  antigravityIdeSettingsPath,
  claudeDesktopDefaultPaths,
  findAppDefinition,
  getAppDefinitions,
  isAppDetected,
  opencodeTargets,
  stripJsoncComments,
  stripJsoncTrailingCommas,
} from './apps.js';
import { migrateCodexThreadsToTorve, restoreCodexThreadsFromTorve } from './codex-threads.js';
import {
  backupsRootDir,
  codexCatalogPath,
  codexModelsCachePath,
  expandHomePath,
  getHomeDir,
  readActiveProfilesState,
  readDirectCloudOverrides,
  writeActiveProfilesState,
} from './state.js';
import type {
  AppDefinition,
  CodexConfigPatchDef,
  ConfigPatchDef,
  OpencodeConfigPatchDef,
  OpencodeModelDefinition,
  TorveModel,
} from './types.js';

export const MIN_CONTEXT_WINDOW_FLOOR = 1_000_000;
export const MIN_OUTPUT_TOKENS_FLOOR = 32_768;
export const ROUTED_MODEL_ALIAS = 'torve';
const ROUTED_MODEL_ALIAS_LABEL = 'Torve Auto';
const CLAUDE_DESKTOP_PROFILE_ID = '00000000-0000-4000-8000-0000a4753eed';
const CLAUDE_DESKTOP_PROFILE_NAME = 'Torve';
const CLAUDE_GATEWAY_DEFAULT_PORT = Number(process.env['TORVE_CLAUDE_GATEWAY_PORT']) || 8380;
const CODEX_CATALOG_MAX_BYTES = 1024 * 1024;

type JsonObject = Record<string, unknown>;

type BackupEntry = {
  originalPath: string;
  existedBefore: boolean;
  originalFile: string | null;
  sha256: string | null;
  patchedSha256: string | null;
};

type BackupManifest = {
  version: 1;
  appId: string;
  patchedAt: number | null;
  entries: BackupEntry[];
};

function backupDir(appId: string): string {
  return path.join(backupsRootDir(), appId);
}

function manifestPath(appId: string): string {
  return path.join(backupDir(appId), 'manifest.json');
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

async function readBytesOrNull(filePath: string): Promise<Buffer | null> {
  try {
    return await readFile(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function saveBackupManifest(manifest: BackupManifest): Promise<void> {
  const filePath = manifestPath(manifest.appId);
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, filePath);
}

async function loadBackupManifest(appId: string): Promise<BackupManifest | null> {
  try {
    return JSON.parse(await readFile(manifestPath(appId), 'utf8')) as BackupManifest;
  } catch {
    return null;
  }
}

export async function prepareBackup(appId: string, sourcePaths: readonly string[]): Promise<void> {
  const dir = backupDir(appId);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const entries: BackupEntry[] = [];
  for (const [index, sourcePath] of [...new Set(sourcePaths)].entries()) {
    const original = await readBytesOrNull(sourcePath);
    const originalFile = original ? `original.${index}.${path.basename(sourcePath)}` : null;
    if (original && originalFile) {
      await writeFile(path.join(dir, originalFile), original, { mode: 0o600 });
    }
    entries.push({
      originalPath: sourcePath,
      existedBefore: original !== null,
      originalFile,
      sha256: original ? sha256(original) : null,
      patchedSha256: null,
    });
  }
  await saveBackupManifest({ version: 1, appId, patchedAt: null, entries });
}

export async function sealBackup(appId: string): Promise<void> {
  const manifest = await loadBackupManifest(appId);
  if (!manifest) return;
  for (const entry of manifest.entries) {
    const current = await readBytesOrNull(entry.originalPath);
    entry.patchedSha256 = current ? sha256(current) : null;
  }
  manifest.patchedAt = Date.now();
  await saveBackupManifest(manifest);
}

export async function backupMatchesPatched(appId: string): Promise<boolean> {
  const manifest = await loadBackupManifest(appId);
  if (!manifest || manifest.patchedAt === null) return false;
  for (const entry of manifest.entries) {
    const current = await readBytesOrNull(entry.originalPath);
    const currentSha = current ? sha256(current) : null;
    if (entry.patchedSha256 !== currentSha) return false;
  }
  return true;
}

export async function restoreBackup(appId: string, options: { forceExact?: boolean } = {}): Promise<boolean> {
  const manifest = await loadBackupManifest(appId);
  if (!manifest) return false;
  if (!options.forceExact && !(await backupMatchesPatched(appId))) return false;
  const dir = backupDir(appId);
  for (const entry of manifest.entries) {
    if (entry.existedBefore && entry.originalFile) {
      await mkdir(path.dirname(entry.originalPath), { recursive: true });
      await copyFile(path.join(dir, entry.originalFile), entry.originalPath);
    } else {
      await rm(entry.originalPath, { force: true });
    }
  }
  await rm(dir, { recursive: true, force: true });
  return true;
}

export async function rollbackBackup(appId: string): Promise<void> {
  const manifest = await loadBackupManifest(appId);
  if (!manifest) return;
  const dir = backupDir(appId);
  for (const entry of manifest.entries) {
    if (entry.existedBefore && entry.originalFile) {
      await mkdir(path.dirname(entry.originalPath), { recursive: true });
      await copyFile(path.join(dir, entry.originalFile), entry.originalPath);
    } else {
      await rm(entry.originalPath, { force: true });
    }
  }
  await rm(dir, { recursive: true, force: true });
}

export async function discardBackup(appId: string): Promise<void> {
  await rm(backupDir(appId), { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Catalog helpers (OpenCode & Codex)
// ---------------------------------------------------------------------------

function positiveNum(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function opencodeModelsFromCatalog(models: readonly TorveModel[]): OpencodeModelDefinition[] {
  return models.map((model) => {
    const capabilities = Array.isArray(model['capabilities']) ? model['capabilities'] : [];
    const displayName = typeof model['display_name'] === 'string'
      ? model['display_name'].trim()
      : typeof model['name'] === 'string'
        ? model['name'].trim()
        : '';
    const context = positiveNum(model['max_input_tokens'] ?? model['context_window'] ?? model['context_length']);
    const rawOutput = positiveNum(model['max_output_tokens'] ?? model['max_tokens']);
    const output = Math.max(rawOutput ?? 0, MIN_OUTPUT_TOKENS_FLOOR);
    return {
      id: model.id,
      name: displayName || model.id,
      ...(context !== undefined ? { context } : {}),
      output,
      vision: capabilities.includes('vision'),
    };
  });
}

export type CodexCatalogModel = Record<string, unknown> & {
  slug: string;
  display_name: string;
  description: string;
  visibility: 'list';
  supported_in_api: true;
  priority: number;
};

export type CodexCatalog = { models: CodexCatalogModel[]; [key: string]: unknown };

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
  supports_parallel_tool_calls: true,
  use_responses_lite: false,
  node_repl_auto_review_required: false,
  node_repl_disabled: false,
  base_instructions: 'You are Codex, a coding agent.',
};

function readCodexCatalogFile(filePath: string): CodexCatalog | null {
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

export function installedCodexCatalog(): CodexCatalog {
  const home = getHomeDir();
  const candidates = [
    codexModelsCachePath(),
    path.join(home, '.codex', 'codex-router', 'native-models.json'),
    path.join(home, '.codex', 'codex-router', 'merged-models.json'),
  ];
  for (const candidate of candidates) {
    const cat = readCodexCatalogFile(candidate);
    if (cat) return cat;
  }
  return JSON.parse(JSON.stringify({ models: [FALLBACK_CODEX_MODEL_TEMPLATE] })) as CodexCatalog;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function codexCatalogPayload(models: readonly TorveModel[], base = installedCodexCatalog()): CodexCatalog {
  const native = base.models.map(clone);
  const template = native.reduce((smallest, item) => (
    JSON.stringify(item).length < JSON.stringify(smallest).length ? item : smallest
  ));
  const nativeSlugs = new Set(native.map((m) => m.slug));
  const torve = models.filter((m) => !nativeSlugs.has(m.id)).map((model, index) => {
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
    if ('upgrade' in entry) entry['upgrade'] = null;
    if ('availability_nux' in entry) entry['availability_nux'] = null;
    if (model.id === 'auto') {
      const levels = Array.isArray(entry['supported_reasoning_levels']) ? entry['supported_reasoning_levels'] : [];
      if (levels.length > 0 && levels[0] && typeof levels[0] === 'object') {
        const first = clone(levels[0] as Record<string, unknown>);
        entry['supported_reasoning_levels'] = [first];
        if (typeof first['effort'] === 'string') entry['default_reasoning_level'] = first['effort'];
      }
    }
    const rawContext = positiveNum(model['max_input_tokens'] ?? model['context_window'] ?? model['context_length']);
    const contextWindow = Math.max(rawContext ?? 0, MIN_CONTEXT_WINDOW_FLOOR);
    entry['context_window'] = contextWindow;
    entry['max_context_window'] = contextWindow;
    entry['auto_compact_token_limit'] = 900_000;
    entry['effective_context_window_percent'] = 95;
    entry['supports_parallel_tool_calls'] = true;
    return entry;
  });
  return { ...base, models: [...native, ...torve] };
}

export async function writeCodexModelCatalog(models: readonly TorveModel[], filePath = codexCatalogPath()): Promise<string> {
  const bytes = Buffer.from(`${JSON.stringify(codexCatalogPayload(models), null, 2)}\n`);
  if (bytes.byteLength >= CODEX_CATALOG_MAX_BYTES) {
    throw new Error("Merged Codex model catalog exceeds Codex's 1 MiB limit.");
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  await writeFile(temp, bytes, { mode: 0o600 });
  await rename(temp, filePath);
  return filePath;
}

export async function invalidateCodexModelsCache(filePath = codexModelsCachePath()): Promise<void> {
  if (!existsSync(filePath)) return;
  try {
    await unlink(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

export async function removeCodexModelCatalog(filePath = codexCatalogPath()): Promise<void> {
  if (!existsSync(filePath)) return;
  try {
    await unlink(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

// ---------------------------------------------------------------------------
// File I/O helpers
// ---------------------------------------------------------------------------

function parseJsoncObject(raw: string, filePath: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsoncTrailingCommas(stripJsoncComments(raw.replace(/^\uFEFF/, ''))));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Unable to parse JSONC config at ${filePath}: ${message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`JSONC config at ${filePath} must be an object`);
  }
  return parsed as JsonObject;
}

function readConfigJson(filePath: string): JsonObject {
  if (!existsSync(filePath)) return {};
  return parseJsoncObject(readFileSync(filePath, 'utf8'), filePath);
}

function tryReadConfigJson(filePath: string): JsonObject | null {
  if (!existsSync(filePath)) return null;
  return parseJsoncObject(readFileSync(filePath, 'utf8'), filePath);
}

function writeTextAtomically(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(filePath)}.torve-${process.pid}-${Date.now()}.tmp`);
  try {
    writeFileSync(temp, content, 'utf8');
    renameSync(temp, filePath);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}

function writeJsonFile(filePath: string, data: JsonObject): void {
  writeTextAtomically(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function backupConfigFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  const bak = `${filePath}.torve.bak`;
  if (existsSync(bak)) return;
  copyFileSync(filePath, bak);
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {};
}

function removeFromStringArray(config: JsonObject, key: string, value: string): void {
  const arr = config[key];
  if (!Array.isArray(arr)) return;
  const filtered = arr.filter((item) => item !== value);
  if (filtered.length === 0) delete config[key];
  else config[key] = filtered;
}

function isLoopbackHost(value: unknown): boolean {
  return typeof value === 'string' && /^https?:\/\/(localhost|127\.0\.0\.1):\d+/.test(value);
}

// ---------------------------------------------------------------------------
// Direct patch construction (matches apps/desktop/src/main/torve-cloud/profiles.ts)
// ---------------------------------------------------------------------------

export function scopePatchForDirectCloud(
  appId: string,
  patch: ConfigPatchDef,
  models: readonly TorveModel[] = [],
): ConfigPatchDef {
  if (patch.format === 'claude-desktop') return patch;
  const base = patch.baseURL.replace(/\/+$/, '');
  const suffix = base.endsWith('/v1') ? '/v1' : '';
  const root = suffix ? base.slice(0, -3) : base;
  const scoped = { ...patch, baseURL: `${root}/app/${appId}${suffix}` } as ConfigPatchDef;
  if (scoped.format === 'opencode') {
    return {
      ...scoped,
      apiKey: 'torve-local-proxy',
      modelAlias: 'auto',
      models: opencodeModelsFromCatalog(models),
    };
  }
  if (scoped.format === 'claude-code') {
    return { ...scoped, models: opencodeModelsFromCatalog(models) };
  }
  return scoped;
}

function claudeCodeTabPatch(models: readonly TorveModel[], port: number): ConfigPatchDef {
  return {
    format: 'claude-code',
    configPath: '~/.claude/settings.json',
    providerKey: 'torve',
    baseURL: `http://127.0.0.1:${port}/app/claude-desktop`,
    models: opencodeModelsFromCatalog(models),
  };
}

// ---------------------------------------------------------------------------
// Per-format patch / unpatch implementations
// ---------------------------------------------------------------------------

function applyOpencodePatch(patch: OpencodeConfigPatchDef, port: number): void {
  const baseURL = patch.baseURL.replace('{buyerPort}', String(port));
  for (const filePath of opencodeTargets(patch)) {
    backupConfigFile(filePath);
    const config = readConfigJson(filePath);
    // OpenCode 1.x strictly requires singular `provider`.
    delete config['providers'];

    const existingProviders = asObject(config['provider']);
    const alias = patch.modelAlias?.trim() || ROUTED_MODEL_ALIAS;
    const apiKey = patch.apiKey ?? 'torve-local-proxy';
    const aliasModel = patch.models?.find((m) => m.id.trim() === alias);
    const aliasRawContext = positiveNum(aliasModel?.context) ?? 0;
    const aliasRawOutput = positiveNum(aliasModel?.output) ?? 0;

    const models: JsonObject = {
      [alias]: {
        name: ROUTED_MODEL_ALIAS_LABEL,
        attachment: true,
        modalities: { input: ['text', 'image'], output: ['text'] },
        limit: {
          context: Math.max(aliasRawContext, MIN_CONTEXT_WINDOW_FLOOR),
          output: Math.max(aliasRawOutput, MIN_OUTPUT_TOKENS_FLOOR),
        },
      },
    };
    for (const model of patch.models ?? []) {
      const id = model.id.trim();
      if (!id || id === alias || id === ROUTED_MODEL_ALIAS || id === 'auto') continue;
      const rawContext = positiveNum(model.context) ?? 0;
      const rawOutput = positiveNum(model.output) ?? 0;
      models[id] = {
        name: model.name.trim() || id,
        attachment: model.vision === true,
        modalities: { input: model.vision === true ? ['text', 'image'] : ['text'], output: ['text'] },
        limit: {
          context: Math.max(rawContext, MIN_CONTEXT_WINDOW_FLOOR),
          output: Math.max(rawOutput, MIN_OUTPUT_TOKENS_FLOOR),
        },
      };
    }

    existingProviders[patch.providerKey] = {
      name: patch.providerName,
      npm: patch.npm,
      options: { baseURL, apiKey },
      models,
    };
    config['provider'] = existingProviders;
    config['model'] = `${patch.providerKey}/${alias}`;
    removeFromStringArray(config, 'disabled_providers', patch.providerKey);
    writeJsonFile(filePath, config);
  }
}

function removeOpencodePatch(patch: OpencodeConfigPatchDef): boolean {
  let changed = false;
  for (const filePath of opencodeTargets(patch)) {
    const config = tryReadConfigJson(filePath);
    if (!config) continue;
    backupConfigFile(filePath);
    let fileChanged = false;
    for (const key of ['provider', 'providers']) {
      const providers = config[key];
      if (providers && typeof providers === 'object' && !Array.isArray(providers) && (patch.providerKey in (providers as JsonObject))) {
        delete (providers as JsonObject)[patch.providerKey];
        fileChanged = true;
      }
    }
    if (typeof config['model'] === 'string' && config['model'].startsWith(`${patch.providerKey}/`)) {
      delete config['model'];
      fileChanged = true;
    }
    if (fileChanged) {
      writeJsonFile(filePath, config);
      changed = true;
    }
  }
  return changed;
}

// --- Codex TOML ---

function tomlBasicString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function firstTomlTableIndex(lines: readonly string[]): number {
  const index = lines.findIndex((line) => /^\s*\[/.test(line));
  return index === -1 ? lines.length : index;
}

function isCodexProviderTableHeader(line: string, providerKey: string): boolean {
  const match = line.match(/^\s*\[\s*model_providers\s*\.\s*("?)([^\]"]+)\1\s*\]\s*(#.*)?$/);
  return match?.[2]?.trim() === providerKey;
}

function removeCodexProviderTable(lines: readonly string[], providerKey: string): { lines: string[]; changed: boolean } {
  const start = lines.findIndex((line) => isCodexProviderTableHeader(line, providerKey));
  if (start === -1) return { lines: [...lines], changed: false };
  let end = start + 1;
  while (end < lines.length && !/^\s*\[/.test(lines[end]!)) end++;
  return { lines: [...lines.slice(0, start), ...lines.slice(end)], changed: true };
}

function tomlTopLevelKeyIndex(lines: readonly string[], key: string): number {
  const limit = firstTomlTableIndex(lines);
  const pattern = new RegExp(`^\\s*${key}\\s*=`);
  for (let i = 0; i < limit; i++) {
    if (pattern.test(lines[i]!)) return i;
  }
  return -1;
}

function setTomlTopLevelValue(lines: readonly string[], key: string, value: string): string[] {
  const assignment = `${key} = ${value}`;
  const index = tomlTopLevelKeyIndex(lines, key);
  if (index !== -1) {
    const next = [...lines];
    next[index] = assignment;
    return next;
  }
  const limit = firstTomlTableIndex(lines);
  return [...lines.slice(0, limit), assignment, ...lines.slice(limit)];
}

function setTomlTopLevelString(lines: readonly string[], key: string, value: string): string[] {
  return setTomlTopLevelValue(lines, key, tomlBasicString(value));
}

function readTomlTopLevelString(lines: readonly string[], key: string): string | undefined {
  const index = tomlTopLevelKeyIndex(lines, key);
  if (index === -1) return undefined;
  const match = lines[index]!.match(/=\s*"((?:[^"\\]|\\.)*)"\s*(#.*)?$/);
  return match ? match[1]!.replace(/\\(.)/g, '$1') : undefined;
}

function removeTomlTopLevelKey(lines: readonly string[], key: string): string[] {
  const index = tomlTopLevelKeyIndex(lines, key);
  if (index === -1) return [...lines];
  return [...lines.slice(0, index), ...lines.slice(index + 1)];
}

function applyCodexPatch(patch: CodexConfigPatchDef, port: number): void {
  const filePath = expandHomePath(patch.configPath);
  const baseURL = patch.baseURL.replace('{buyerPort}', String(port));
  backupConfigFile(filePath);
  const raw = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
  let lines = raw.length > 0 ? raw.split(/\r?\n/) : [];
  lines = removeCodexProviderTable(lines, patch.providerKey).lines;
  lines = setTomlTopLevelString(lines, 'model_provider', patch.providerKey);
  lines = setTomlTopLevelString(lines, 'model', patch.model || ROUTED_MODEL_ALIAS);
  if (patch.modelCatalogJson) {
    lines = setTomlTopLevelString(lines, 'model_catalog_json', expandHomePath(patch.modelCatalogJson));
  }
  lines = setTomlTopLevelValue(lines, 'model_context_window', String(MIN_CONTEXT_WINDOW_FLOOR));
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
  lines.push(
    '',
    `[model_providers.${patch.providerKey}]`,
    `name = ${tomlBasicString(patch.providerName)}`,
    `base_url = ${tomlBasicString(baseURL)}`,
    'wire_api = "responses"',
    ...(patch.bearerToken ? [`experimental_bearer_token = ${tomlBasicString(patch.bearerToken)}`] : []),
  );
  writeTextAtomically(filePath, `${lines.join('\n')}\n`);
}

function removeCodexPatch(patch: CodexConfigPatchDef): boolean {
  const filePath = expandHomePath(patch.configPath);
  if (!existsSync(filePath)) return false;
  const raw = readFileSync(filePath, 'utf8');
  const removal = removeCodexProviderTable(raw.split(/\r?\n/), patch.providerKey);
  let lines = removal.lines;
  let changed = removal.changed;
  if (readTomlTopLevelString(lines, 'model_provider') === patch.providerKey) {
    lines = removeTomlTopLevelKey(lines, 'model_provider');
    lines = removeTomlTopLevelKey(lines, 'model');
    lines = removeTomlTopLevelKey(lines, 'model_context_window');
    lines = removeTomlTopLevelKey(lines, 'model_catalog_json');
    changed = true;
  }
  if (!changed) return false;
  backupConfigFile(filePath);
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
  writeTextAtomically(filePath, lines.length > 0 ? `${lines.join('\n')}\n` : '');
  return true;
}

// --- Claude Code ---

const CLAUDE_CODE_SOURCE_HEADER = 'x-torve-system-proxy-source: claude-code';
const CLAUDE_CODE_MANAGED_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_CUSTOM_HEADERS',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
] as const;

type ClaudeCodeManagedEnvKey = (typeof CLAUDE_CODE_MANAGED_ENV_KEYS)[number];
type SavedVal = { present: boolean; value?: unknown };
type ClaudeCodePatchState = {
  version: 1;
  configExisted: boolean;
  envPresent: boolean;
  env: Record<ClaudeCodeManagedEnvKey, SavedVal>;
  model: SavedVal;
  availableModels: SavedVal;
};

function savedVal(source: JsonObject, key: string): SavedVal {
  return Object.prototype.hasOwnProperty.call(source, key)
    ? { present: true, value: source[key] }
    : { present: false };
}

function restoreSavedVal(target: JsonObject, key: string, saved: SavedVal): void {
  if (saved.present) target[key] = saved.value;
  else delete target[key];
}

function applyClaudeCodePatch(patch: Extract<ConfigPatchDef, { format: 'claude-code' }>, port: number): void {
  const filePath = expandHomePath(patch.configPath);
  const statePath = `${filePath}.torve.state.json`;
  const baseURL = patch.baseURL.replace('{buyerPort}', String(port));
  const configExisted = existsSync(filePath);
  backupConfigFile(filePath);
  const config = readConfigJson(filePath);
  const existingEnv = config['env'] !== undefined ? asObject(config['env']) : undefined;
  if (!existsSync(statePath)) {
    const envSource = existingEnv ?? {};
    const state: ClaudeCodePatchState = {
      version: 1,
      configExisted,
      envPresent: existingEnv !== undefined,
      env: Object.fromEntries(CLAUDE_CODE_MANAGED_ENV_KEYS.map((k) => [k, savedVal(envSource, k)])) as Record<ClaudeCodeManagedEnvKey, SavedVal>,
      model: savedVal(config, 'model'),
      availableModels: savedVal(config, 'availableModels'),
    };
    writeJsonFile(statePath, state as unknown as JsonObject);
  }
  const env = existingEnv ?? {};
  env['ANTHROPIC_BASE_URL'] = baseURL;
  env['ANTHROPIC_AUTH_TOKEN'] = 'torve-local-proxy';
  env['ANTHROPIC_API_KEY'] = 'torve-local-proxy';
  env['ANTHROPIC_CUSTOM_HEADERS'] = CLAUDE_CODE_SOURCE_HEADER;
  env['ANTHROPIC_MODEL'] = ROUTED_MODEL_ALIAS;
  env['ANTHROPIC_DEFAULT_SONNET_MODEL'] = ROUTED_MODEL_ALIAS;
  env['ANTHROPIC_DEFAULT_OPUS_MODEL'] = ROUTED_MODEL_ALIAS;
  env['ANTHROPIC_DEFAULT_HAIKU_MODEL'] = ROUTED_MODEL_ALIAS;
  config['env'] = env;
  config['model'] = ROUTED_MODEL_ALIAS;
  const native = ['sonnet', 'opus', 'haiku', 'claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'];
  config['availableModels'] = [...new Set([...native, ROUTED_MODEL_ALIAS, ...(patch.models ?? []).map((m) => m.id)])];
  writeJsonFile(filePath, config);
}

function removeClaudeCodePatch(patch: Extract<ConfigPatchDef, { format: 'claude-code' }>): boolean {
  const filePath = expandHomePath(patch.configPath);
  const statePath = `${filePath}.torve.state.json`;
  const state = tryReadConfigJson(statePath) as ClaudeCodePatchState | null;
  if (!state) return false;
  const config = tryReadConfigJson(filePath);
  if (!config) {
    if (existsSync(statePath)) unlinkSync(statePath);
    return true;
  }
  backupConfigFile(filePath);
  let changed = false;
  const env = config['env'] && typeof config['env'] === 'object' && !Array.isArray(config['env'])
    ? (config['env'] as JsonObject)
    : undefined;
  if (env) {
    const managedValues: Record<ClaudeCodeManagedEnvKey, unknown> = {
      ANTHROPIC_BASE_URL: undefined,
      ANTHROPIC_AUTH_TOKEN: 'torve-local-proxy',
      ANTHROPIC_API_KEY: 'torve-local-proxy',
      ANTHROPIC_CUSTOM_HEADERS: CLAUDE_CODE_SOURCE_HEADER,
      ANTHROPIC_MODEL: ROUTED_MODEL_ALIAS,
      ANTHROPIC_DEFAULT_SONNET_MODEL: ROUTED_MODEL_ALIAS,
      ANTHROPIC_DEFAULT_OPUS_MODEL: ROUTED_MODEL_ALIAS,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: ROUTED_MODEL_ALIAS,
    };
    for (const key of CLAUDE_CODE_MANAGED_ENV_KEYS) {
      const value = env[key];
      const managed = key === 'ANTHROPIC_BASE_URL' ? isLoopbackHost(value) : value === managedValues[key];
      if (!managed) continue;
      restoreSavedVal(env, key, state.env[key]);
      changed = true;
    }
    if (!state.envPresent && Object.keys(env).length === 0) delete config['env'];
  }
  if (config['model'] === ROUTED_MODEL_ALIAS) {
    restoreSavedVal(config, 'model', state.model);
    changed = true;
  }
  if (Array.isArray(config['availableModels']) && config['availableModels'].includes(ROUTED_MODEL_ALIAS)) {
    restoreSavedVal(config, 'availableModels', state.availableModels);
    changed = true;
  }
  if (!state.configExisted && Object.keys(config).length === 0) {
    unlinkSync(filePath);
  } else if (changed) {
    writeJsonFile(filePath, config);
  }
  if (existsSync(statePath)) unlinkSync(statePath);
  return changed;
}

// --- Claude Desktop ---

function claudeDesktopTargets(patch: Extract<ConfigPatchDef, { format: 'claude-desktop' }>): Array<{ configPath: string; thirdPartyDir: string }> {
  if (process.platform !== 'win32') {
    return [{ configPath: expandHomePath(patch.configPath), thirdPartyDir: expandHomePath(patch.thirdPartyDir) }];
  }
  const home = getHomeDir();
  const roaming = process.env['APPDATA'] || path.join(home, 'AppData', 'Roaming');
  const local = process.env['LOCALAPPDATA'] || path.join(home, 'AppData', 'Local');
  const packagesDir = path.join(local, 'Packages');
  let msixRoots: string[] = [];
  try {
    msixRoots = readdirSync(packagesDir)
      .filter((name) => name.startsWith('Claude_'))
      .map((name) => path.join(packagesDir, name, 'LocalCache', 'Roaming', 'Claude'));
  } catch { /* no Packages dir */ }
  const roots = [
    path.join(roaming, 'Claude'),
    ...msixRoots,
    path.join(local, 'Claude'),
    path.join(roaming, 'Claude Nest'),
    path.join(local, 'Claude Nest'),
  ];
  const matched = roots
    .map((root) => ({ configPath: path.join(root, 'claude_desktop_config.json'), thirdPartyDir: `${root}-3p` }))
    .filter((t) => existsSync(path.dirname(t.configPath)) || existsSync(t.thirdPartyDir));
  if (matched.length > 0) {
    const localClaudeRoot = path.join(local, 'Claude');
    if (!matched.some((t) => path.dirname(t.configPath).toLowerCase() === localClaudeRoot.toLowerCase())) {
      matched.push({ configPath: path.join(localClaudeRoot, 'claude_desktop_config.json'), thirdPartyDir: `${localClaudeRoot}-3p` });
    }
    return matched;
  }
  return [{ configPath: expandHomePath(patch.configPath), thirdPartyDir: expandHomePath(patch.thirdPartyDir) }];
}

function applyClaudeDesktopPatch(patch: Extract<ConfigPatchDef, { format: 'claude-desktop' }>): void {
  const targets = claudeDesktopTargets(patch);
  const gatewayBaseUrl = patch.baseURL.replace('{claudeGatewayPort}', String(CLAUDE_GATEWAY_DEFAULT_PORT));
  for (const target of targets) {
    backupConfigFile(target.configPath);
    const normal = readConfigJson(target.configPath);
    normal['deploymentMode'] = '3p';
    writeJsonFile(target.configPath, normal);

    const thirdConfigPath = path.join(target.thirdPartyDir, 'claude_desktop_config.json');
    const thirdConfig = readConfigJson(thirdConfigPath);
    thirdConfig['deploymentMode'] = '3p';
    writeJsonFile(thirdConfigPath, thirdConfig);

    const profilePath = path.join(target.thirdPartyDir, 'configLibrary', `${CLAUDE_DESKTOP_PROFILE_ID}.json`);
    const profile = readConfigJson(profilePath);
    profile['inferenceProvider'] = 'gateway';
    profile['inferenceGatewayBaseUrl'] = gatewayBaseUrl;
    profile['inferenceGatewayApiKey'] = 'torve';
    profile['inferenceGatewayAuthScheme'] = 'bearer';
    profile['deploymentDisplayName'] = CLAUDE_DESKTOP_PROFILE_NAME;
    profile['chatTabEnabled'] = true;
    profile['disableDeploymentModeChooser'] = true;
    profile['coworkEgressAllowedHosts'] = ['*'];
    profile['disableEssentialTelemetry'] = true;
    profile['disableNonessentialTelemetry'] = true;
    delete profile['inferenceModels'];
    profile['modelCatalogEnabled'] = false;
    writeJsonFile(profilePath, profile);

    const metaPath = path.join(target.thirdPartyDir, 'configLibrary', '_meta.json');
    const meta = readConfigJson(metaPath);
    const entries = Array.isArray(meta['entries']) ? meta['entries'] : [];
    meta['appliedId'] = CLAUDE_DESKTOP_PROFILE_ID;
    meta['entries'] = [
      ...entries.filter((e) => !(e && typeof e === 'object' && (e as JsonObject)['id'] === CLAUDE_DESKTOP_PROFILE_ID)),
      { id: CLAUDE_DESKTOP_PROFILE_ID, name: CLAUDE_DESKTOP_PROFILE_NAME },
    ];
    writeJsonFile(metaPath, meta);
  }
}

function removeClaudeDesktopPatch(patch: Extract<ConfigPatchDef, { format: 'claude-desktop' }>): boolean {
  let changed = false;
  for (const target of claudeDesktopTargets(patch)) {
    const metaPath = path.join(target.thirdPartyDir, 'configLibrary', '_meta.json');
    const profilePath = path.join(target.thirdPartyDir, 'configLibrary', `${CLAUDE_DESKTOP_PROFILE_ID}.json`);
    const meta = tryReadConfigJson(metaPath);
    const profile = tryReadConfigJson(profilePath);
    const owns = (profile?.['inferenceProvider'] === 'gateway' && isLoopbackHost(profile?.['inferenceGatewayBaseUrl']))
      || meta?.['appliedId'] === CLAUDE_DESKTOP_PROFILE_ID;
    if (!owns) continue;

    for (const cfgPath of [target.configPath, path.join(target.thirdPartyDir, 'claude_desktop_config.json')]) {
      const cfg = tryReadConfigJson(cfgPath);
      if (cfg && cfg['deploymentMode'] === '3p') {
        cfg['deploymentMode'] = '1p';
        writeJsonFile(cfgPath, cfg);
        changed = true;
      }
    }
    if (meta) {
      if (meta['appliedId'] === CLAUDE_DESKTOP_PROFILE_ID) delete meta['appliedId'];
      if (Array.isArray(meta['entries'])) {
        meta['entries'] = meta['entries'].filter((e) => !(e && typeof e === 'object' && (e as JsonObject)['id'] === CLAUDE_DESKTOP_PROFILE_ID));
      }
      writeJsonFile(metaPath, meta);
      changed = true;
    }
    if (profile) {
      for (const k of [
        'inferenceProvider', 'inferenceGatewayBaseUrl', 'inferenceGatewayApiKey', 'inferenceGatewayAuthScheme',
        'deploymentDisplayName', 'coworkEgressAllowedHosts', 'disableEssentialTelemetry',
        'disableNonessentialTelemetry', 'inferenceModels',
      ]) {
        delete profile[k];
      }
      profile['disableDeploymentModeChooser'] = false;
      writeJsonFile(profilePath, profile);
      changed = true;
    }
  }
  return changed;
}

// --- Gemini CLI ---

function writeManagedEnv(filePath: string, values: Readonly<Record<string, string>>): void {
  const existing = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
  const keys = new Set(Object.keys(values));
  const lines = existing.split(/\r?\n/).filter((line) => {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    return !match || !keys.has(match[1]!);
  });
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  for (const [key, value] of Object.entries(values)) lines.push(`${key}=${value}`);
  writeTextAtomically(filePath, `${lines.join('\n')}\n`);
}

function removeManagedEnv(filePath: string, keysToRemove: readonly string[]): boolean {
  if (!existsSync(filePath)) return false;
  const keys = new Set(keysToRemove);
  const existing = readFileSync(filePath, 'utf8');
  let changed = false;
  const lines = existing.split(/\r?\n/).filter((line) => {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (match && keys.has(match[1]!)) {
      changed = true;
      return false;
    }
    return true;
  });
  if (changed) writeTextAtomically(filePath, lines.join('\n').replace(/\n*$/, '\n'));
  return changed;
}

function applyGeminiPatch(patch: Extract<ConfigPatchDef, { format: 'gemini-cli' }>, port: number): void {
  const configPath = expandHomePath(patch.configPath);
  const envPath = expandHomePath(patch.envPath);
  backupConfigFile(configPath);
  backupConfigFile(envPath);
  const config = readConfigJson(configPath);
  const security = asObject(config['security']);
  const auth = asObject(security['auth']);
  auth['selectedType'] = 'gemini-api-key';
  security['auth'] = auth;
  config['security'] = security;
  writeJsonFile(configPath, config);
  writeManagedEnv(envPath, {
    GOOGLE_GEMINI_BASE_URL: patch.baseURL.replace('{buyerPort}', String(port)),
    GEMINI_API_KEY: 'torve-local-proxy',
    GEMINI_MODEL: patch.model ?? ROUTED_MODEL_ALIAS,
  });
}

function removeGeminiPatch(patch: Extract<ConfigPatchDef, { format: 'gemini-cli' }>): boolean {
  const configPath = expandHomePath(patch.configPath);
  const envPath = expandHomePath(patch.envPath);
  const config = tryReadConfigJson(configPath);
  let changed = false;
  if (config) {
    const security = asObject(config['security']);
    const auth = asObject(security['auth']);
    if (auth['selectedType'] === 'gemini-api-key') {
      delete auth['selectedType'];
      if (Object.keys(auth).length === 0) delete security['auth'];
      else security['auth'] = auth;
      if (Object.keys(security).length === 0) delete config['security'];
      else config['security'] = security;
      writeJsonFile(configPath, config);
      changed = true;
    }
  }
  return removeManagedEnv(envPath, ['GOOGLE_GEMINI_BASE_URL', 'GEMINI_API_KEY', 'GEMINI_MODEL']) || changed;
}

// --- Antigravity IDE ---

function applyAntigravityPatch(patch: Extract<ConfigPatchDef, { format: 'antigravity-ide' }>, port: number): void {
  const baseURL = patch.baseURL.replace('{buyerPort}', String(port));
  const settingsPath = expandHomePath(patch.configPath);
  backupConfigFile(settingsPath);
  const settings = readConfigJson(settingsPath);
  settings['jetski.cloudCodeUrl'] = baseURL;
  writeJsonFile(settingsPath, settings);

  if (!patch.mcpFallback || !patch.mcpConfigPath || !patch.serverPath) return;
  const configPath = expandHomePath(patch.mcpConfigPath);
  const serverPath = expandHomePath(patch.serverPath);
  const script = `import readline from 'node:readline';\nconst base=${JSON.stringify(baseURL)};\nconst send=(x)=>process.stdout.write(JSON.stringify(x)+'\\n');\nconst rl=readline.createInterface({input:process.stdin});\nrl.on('line',async(line)=>{let r;try{r=JSON.parse(line)}catch{return}const out={jsonrpc:'2.0',id:r.id};try{if(r.method==='initialize')send({...out,result:{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'torve-local',version:'1.0.0'}}});else if(r.method==='notifications/initialized'){}else if(r.method==='tools/list')send({...out,result:{tools:[{name:'torve_list_models',description:'List models available from the connected Torve Cloud account.',inputSchema:{type:'object',properties:{}}},{name:'torve_chat',description:'Send a prompt through Direct Torve Cloud.',inputSchema:{type:'object',properties:{prompt:{type:'string'},model:{type:'string'}},required:['prompt']}}]}});else if(r.method==='tools/call'){const a=r.params?.arguments||{};if(r.params?.name==='torve_list_models'){const j=await fetch(base+'/v1/models',{headers:{authorization:'Bearer torve-local-proxy'}}).then(x=>x.json());send({...out,result:{content:[{type:'text',text:JSON.stringify(j.data||j)}]}})}else{const j=await fetch(base+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer torve-local-proxy'},body:JSON.stringify({model:a.model||'torve',messages:[{role:'user',content:a.prompt}]})}).then(x=>x.json());send({...out,result:{content:[{type:'text',text:j.choices?.[0]?.message?.content||JSON.stringify(j)}]}})}}else send({...out,error:{code:-32601,message:'Method not found'}})}catch(e){send({...out,error:{code:-32000,message:String(e?.message||e)}})}});\n`;
  writeTextAtomically(serverPath, script);
  const config = readConfigJson(configPath);
  const servers = asObject(config['mcpServers']);
  servers['torve'] = { command: 'node', args: [serverPath] };
  config['mcpServers'] = servers;
  writeJsonFile(configPath, config);
}

function removeAntigravityPatch(patch: Extract<ConfigPatchDef, { format: 'antigravity-ide' }>): boolean {
  let changed = false;
  const settingsPath = expandHomePath(patch.configPath);
  const settings = tryReadConfigJson(settingsPath);
  if (settings && typeof settings['jetski.cloudCodeUrl'] === 'string') {
    delete settings['jetski.cloudCodeUrl'];
    writeJsonFile(settingsPath, settings);
    changed = true;
  }
  if (!patch.mcpFallback || !patch.mcpConfigPath || !patch.serverPath) return changed;
  const configPath = expandHomePath(patch.mcpConfigPath);
  const config = tryReadConfigJson(configPath);
  if (config) {
    const servers = asObject(config['mcpServers']);
    if (servers['torve']) {
      delete servers['torve'];
      changed = true;
    }
    if (Object.keys(servers).length === 0) delete config['mcpServers'];
    else config['mcpServers'] = servers;
    if (changed) writeJsonFile(configPath, config);
  }
  const serverPath = expandHomePath(patch.serverPath);
  if (existsSync(serverPath)) {
    unlinkSync(serverPath);
    changed = true;
  }
  return changed;
}

export function applyConfigPatch(patch: ConfigPatchDef, port: number): void {
  switch (patch.format) {
    case 'opencode': applyOpencodePatch(patch, port); return;
    case 'codex': applyCodexPatch(patch, port); return;
    case 'claude-code': applyClaudeCodePatch(patch, port); return;
    case 'claude-desktop': applyClaudeDesktopPatch(patch); return;
    case 'gemini-cli': applyGeminiPatch(patch, port); return;
    case 'antigravity-ide': applyAntigravityPatch(patch, port); return;
  }
}

export function removeConfigPatch(patch: ConfigPatchDef): boolean {
  switch (patch.format) {
    case 'opencode': return removeOpencodePatch(patch);
    case 'codex': return removeCodexPatch(patch);
    case 'claude-code': return removeClaudeCodePatch(patch);
    case 'claude-desktop': return removeClaudeDesktopPatch(patch);
    case 'gemini-cli': return removeGeminiPatch(patch);
    case 'antigravity-ide': return removeAntigravityPatch(patch);
  }
}

function backupPathsForPatch(patch: ConfigPatchDef): string[] {
  if (patch.format === 'claude-desktop') {
    const paths: string[] = [];
    for (const target of claudeDesktopTargets(patch)) {
      const lib = path.join(target.thirdPartyDir, 'configLibrary');
      paths.push(
        target.configPath,
        path.join(target.thirdPartyDir, 'claude_desktop_config.json'),
        path.join(lib, '_meta.json'),
        path.join(lib, `${CLAUDE_DESKTOP_PROFILE_ID}.json`),
      );
    }
    paths.push(
      path.join(getHomeDir(), '.claude', 'settings.json'),
      path.join(getHomeDir(), '.claude', 'settings.json.torve.state.json'),
    );
    return paths;
  }
  const paths = patch.format === 'opencode' ? opencodeTargets(patch) : [expandHomePath(patch.configPath)];
  if (patch.format === 'codex') paths.push(codexModelsCachePath());
  if (patch.format === 'gemini-cli') paths.push(expandHomePath(patch.envPath));
  if (patch.format === 'antigravity-ide' && patch.mcpFallback) {
    if (patch.mcpConfigPath) paths.push(expandHomePath(patch.mcpConfigPath));
    if (patch.serverPath) paths.push(expandHomePath(patch.serverPath));
  }
  return paths;
}

export interface PatchAppResult {
  app: string;
  action: 'patched' | 'skipped';
  configPaths: string[];
  message: string;
}

export async function enableApp(
  appName: string,
  opts: { port: number; models: readonly TorveModel[] },
): Promise<PatchAppResult> {
  const app = findAppDefinition(appName);
  if (!app) throw new Error(`Unknown app "${appName}". Run "torve apps" to see supported apps.`);

  const overrides = await readDirectCloudOverrides();
  let patch = scopePatchForDirectCloud(app.name, app.configPatch, opts.models);
  if (patch.format === 'gemini-cli' && overrides[app.name]?.enabled) {
    patch = { ...patch, model: overrides[app.name]!.modelId };
  }
  if (patch.format === 'codex') {
    const selected = overrides[app.name]?.enabled ? overrides[app.name]!.modelId : (opts.models[0]?.id ?? 'auto');
    await writeCodexModelCatalog(opts.models);
    await invalidateCodexModelsCache();
    patch = { ...patch, model: selected, modelCatalogJson: codexCatalogPath() };
  }

  const backupId = app.name === 'antigravity' ? 'antigravity-ide' : app.name;
  const targets = backupPathsForPatch(patch);
  await prepareBackup(backupId, targets);
  try {
    applyConfigPatch(patch, opts.port);
    if (app.name === 'claude-desktop') {
      applyConfigPatch(claudeCodeTabPatch(opts.models, opts.port), opts.port);
    }
    await sealBackup(backupId);
    if (patch.format === 'codex') {
      await migrateCodexThreadsToTorve();
    }
  } catch (err) {
    await rollbackBackup(backupId);
    if (app.name === 'codex') {
      await invalidateCodexModelsCache();
      await removeCodexModelCatalog();
    }
    throw err;
  }

  const active = await readActiveProfilesState();
  if (!active.profiles.includes(app.name)) {
    await writeActiveProfilesState([...active.profiles, app.name]);
  }

  return {
    app: app.name,
    action: 'patched',
    configPaths: targets,
    message: `Patched ${app.displayName} -> http://127.0.0.1:${opts.port}/app/${app.name}`,
  };
}

export async function disableApp(appName: string): Promise<PatchAppResult> {
  const app = findAppDefinition(appName);
  if (!app) throw new Error(`Unknown app "${appName}". Run "torve apps" to see supported apps.`);

  const backupId = app.name === 'antigravity' ? 'antigravity-ide' : app.name;
  const patch = scopePatchForDirectCloud(app.name, app.configPatch);
  const restored = await restoreBackup(backupId, {
    forceExact: app.name === 'antigravity' || app.name === 'claude-desktop',
  });
  let unpatched = restored;
  if (!restored) {
    unpatched = removeConfigPatch(patch);
    if (app.name === 'claude-desktop') {
      unpatched = removeConfigPatch(claudeCodeTabPatch([], 8378)) || unpatched;
    }
    await discardBackup(backupId);
  }
  if (app.name === 'codex') {
    await invalidateCodexModelsCache();
    await removeCodexModelCatalog();
    await restoreCodexThreadsFromTorve();
  }

  const active = await readActiveProfilesState();
  if (active.profiles.includes(app.name)) {
    await writeActiveProfilesState(active.profiles.filter((p) => p !== app.name));
  }

  return {
    app: app.name,
    action: unpatched ? 'patched' : 'skipped',
    configPaths: backupPathsForPatch(patch),
    message: restored
      ? `Restored ${app.displayName} backup.`
      : unpatched
        ? `Removed Torve config patch from ${app.displayName}.`
        : `${app.displayName} had no active Torve patch.`,
  };
}

export async function enableAllDetectedApps(opts: { port: number; models: readonly TorveModel[] }): Promise<PatchAppResult[]> {
  const results: PatchAppResult[] = [];
  for (const app of getAppDefinitions()) {
    if (!isAppDetected(app)) continue;
    results.push(await enableApp(app.name, opts));
  }
  return results;
}

export async function disableAllApps(): Promise<PatchAppResult[]> {
  const results: PatchAppResult[] = [];
  const active = await readActiveProfilesState();
  const candidates = new Set<string>(active.profiles);
  for (const app of getAppDefinitions()) {
    candidates.add(app.name);
  }
  for (const name of candidates) {
    const app: AppDefinition | undefined = findAppDefinition(name);
    if (!app) continue;
    const res = await disableApp(app.name);
    if (res.action !== 'skipped') results.push(res);
  }
  return results;
}

export { antigravityIdeSettingsPath, claudeDesktopDefaultPaths, rmSync };
