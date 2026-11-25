import { TORVE_MODEL_CONTEXT_WINDOW, TORVE_MODEL_MAX_OUTPUT_TOKENS } from '@torveai/node/types';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { Document, parseDocument } from 'yaml';
import {
  WSL_TOOL_PROBES,
  clearWslTargetsForTool,
  discoverWslToolTargets,
  readWslTargetsForTool,
  saveWslTargetsForTool,
  type WslConfigTarget,
  type WslTool,
} from './wsl.js';

/**
 * Model alias resolved by the buyer proxy at request time to the route
 * currently selected in the desktop (floating pill / AI VPN). Must match
 * ROUTED_MODEL_ALIAS in apps/cli/src/proxy/request-utils.ts.
 */
export const ROUTED_MODEL_ALIAS = 'torve';
const ROUTED_MODEL_ALIAS_LABEL = 'Torve Auto';
// Droid requires the `custom:` namespace to resolve this through `customModels`;
// an unprefixed value is treated as a Factory-managed model and triggers Factory authentication.
const DROID_ROUTED_MODEL_ID = 'custom:Torve-Auto-0';

/**
 * Config patches point a tool's own configuration at the buyer proxy. Each
 * supported tool has its own on-disk format:
 *  - `opencode` (default): JSONC `provider` map (OpenCode's opencode.jsonc)
 *  - `codex`: TOML `[model_providers.*]` table (Codex CLI's config.toml)
 *  - `droid`: JSON `customModels` array plus default model (Factory settings.json)
 *  - `pi`: JSON providers map plus a settings file (pi's models.json/settings.json)
 *  - `crush`: JSON `providers` map with an openai-compat entry (Crush's crush.json)
 *  - `goose`: flat env-style YAML keys (goose's config.yaml)
 *  - `hermes`: nested YAML provider + model selection (Hermes' config.yaml)
 *  - `zed`: JSONC settings with `language_models.openai_compatible` (Zed's settings.json)
 *  - `claude-code`: JSON `env` and `model` keys (Claude Code's user settings.json)
 */
export type OpencodeConfigPatchDef = {
  readonly format?: 'opencode';
  readonly configPath: string;
  readonly providerKey: string;
  readonly npm: string;
  readonly providerName: string;
  readonly baseURL: string;
  /** Direct Cloud may expose the complete cached catalog. Generic/P2P
      profiles omit this and retain the single routed alias. */
  readonly models?: readonly OpencodeModelDefinition[];
  readonly modelAlias?: string;
  readonly apiKey?: string;
  /** When set, the patcher targets actual installations of the named tool —
      native only if install signals exist, plus every WSL distro carrying it
      (Windows) — and throws when the tool is found nowhere, instead of
      blindly creating a config for a program that isn't there. Unset keeps
      the write-the-one-path behavior for generic/external profiles.
      See applyWithInstallProbe. */
  readonly installProbe?: 'opencode';
};

export type OpencodeModelDefinition = {
  readonly id: string;
  readonly name: string;
  readonly context?: number;
  readonly output?: number;
  readonly vision?: boolean;
};

export type CodexConfigPatchDef = {
  readonly format: 'codex';
  readonly configPath: string;
  readonly providerKey: string;
  readonly providerName: string;
  readonly baseURL: string;
  readonly model?: string;
  readonly modelCatalogJson?: string;
  readonly bearerToken?: string;
  readonly installProbe?: 'codex';
};

export type DroidConfigPatchDef = {
  readonly format: 'droid';
  /** Droid CLI and Factory Desktop's shared user settings. */
  readonly configPath: string;
  /** Custom model ID sent to the buyer proxy. */
  readonly providerKey: string;
  readonly providerName: string;
  readonly baseURL: string;
  readonly originator?: string;
  readonly installProbe?: 'droid';
};

export type PiConfigPatchDef = {
  readonly format: 'pi';
  /** pi models.json (custom providers). */
  readonly configPath: string;
  /** pi settings.json (default provider/model selection). */
  readonly settingsPath: string;
  readonly providerKey: string;
  readonly baseURL: string;
  readonly api: 'openai-completions' | 'openai-responses' | 'anthropic-messages';
  readonly originator?: string;
  readonly installProbe?: 'pi';
};

export type CrushConfigPatchDef = {
  readonly format: 'crush';
  readonly configPath: string;
  /** POSIX config path for WSL installs — `configPath` is resolved to a
      Windows known folder at definition time, which is meaningless inside a
      distro. */
  readonly wslConfigPath?: string;
  readonly providerKey: string;
  readonly providerName: string;
  readonly baseURL: string;
  readonly installProbe?: 'crush';
};

export type GooseConfigPatchDef = {
  readonly format: 'goose';
  /** goose config.yaml (flat env-style keys). */
  readonly configPath: string;
  /** POSIX config path for WSL installs — see CrushConfigPatchDef. */
  readonly wslConfigPath?: string;
  /** goose provider engine ('openai' for openai-compatible hosts). */
  readonly providerKey: string;
  /** Host root without /v1 — goose appends the chat-completions path itself. */
  readonly baseURL: string;
  readonly installProbe?: 'goose';
};

export type HermesConfigPatchDef = {
  readonly format: 'hermes';
  /** Hermes user configuration (`~/.hermes/config.yaml`). */
  readonly configPath: string;
  /** Key under Hermes' named `providers` map. */
  readonly providerKey: string;
  readonly baseURL: string;
};

export type ZedConfigPatchDef = {
  readonly format: 'zed';
  readonly configPath: string;
  readonly providerKey: string;
  /** Key under language_models.openai_compatible; also the agent provider id. */
  readonly providerName: string;
  readonly baseURL: string;
};

export type ClaudeCodeConfigPatchDef = {
  readonly format: 'claude-code';
  readonly configPath: string;
  readonly providerKey: string;
  readonly baseURL: string;
  readonly models?: readonly OpencodeModelDefinition[];
  readonly installProbe?: 'claude';
};

export type T3CodeConfigPatchDef = {
  readonly format: 't3code';
  readonly configPath: string;
  readonly providerKey: string;
  readonly providerName: string;
  readonly baseURL: string;
};

/** Gemini CLI persists a loopback base URL in its user settings. */
export type GeminiConfigPatchDef = {
  readonly format: 'gemini-cli';
  readonly configPath: string;
  readonly envPath: string;
  readonly baseURL: string;
  readonly model?: string;
};
export type AiderConfigPatchDef = { readonly format: 'aider'; readonly configPath: string; readonly baseURL: string };
export type ContinueConfigPatchDef = { readonly format: 'continue'; readonly configPath: string; readonly legacyConfigPath?: string; readonly baseURL: string; readonly models?: readonly OpencodeModelDefinition[] };
export type AntigravityConfigPatchDef = {
  readonly format: 'antigravity-ide';
  /** VS Code user settings. `auto` is resolved per-platform by profiles.ts. */
  readonly configPath: string;
  readonly baseURL: string;
  /** Optional standalone Antigravity 2.0 fallback. */
  readonly mcpConfigPath?: string;
  readonly serverPath?: string;
  readonly mcpFallback?: boolean;
};

/**
 * Claude Desktop ships a native third-party inference mode: when the profile
 * config says `deploymentMode: "3p"` it boots against a separate profile
 * directory (`Claude-3p`) whose applied entry in `configLibrary/` names an
 * Anthropic-Messages-compatible gateway to send all inference to. The patch
 * writes that profile pointing at the desktop's local Claude gateway (see
 * connected-apps/claude-desktop-gateway.ts), which serves the model catalog
 * in Anthropic's native shape and forwards requests to the buyer proxy. The
 * 1p and 3p profiles are separate directories, so the user's normal Claude
 * login and state are untouched.
 */
export type ClaudeDesktopConfigPatchDef = {
  readonly format: 'claude-desktop';
  /** Claude's normal-profile claude_desktop_config.json (deploymentMode
      flip). posix only — Windows candidates come from
      claudeDesktopPatchTargets, which probes every known install layout. */
  readonly configPath: string;
  /** Claude's third-party profile root (the `Claude-3p` directory). */
  readonly thirdPartyDir: string;
  /** Gateway base URL carrying the `{claudeGatewayPort}` placeholder. */
  readonly baseURL: string;
};

export type ConfigPatchDef =
  | OpencodeConfigPatchDef
  | CodexConfigPatchDef
  | DroidConfigPatchDef
  | PiConfigPatchDef
  | CrushConfigPatchDef
  | GooseConfigPatchDef
  | HermesConfigPatchDef
  | ZedConfigPatchDef
  | ClaudeCodeConfigPatchDef
  | T3CodeConfigPatchDef
  | GeminiConfigPatchDef
  | AiderConfigPatchDef
  | ContinueConfigPatchDef
  | AntigravityConfigPatchDef
  | ClaudeDesktopConfigPatchDef;

/**
 * Loopback port of the desktop's Claude Desktop gateway. Lives here (not in
 * claude-desktop-gateway.ts) so this electron-free module stays the single
 * import direction: the gateway imports from config-patch, never the reverse.
 */
export const CLAUDE_GATEWAY_DEFAULT_PORT = Number(process.env['TORVE_CLAUDE_GATEWAY_PORT']) || 8380;
/** Fixed id of the managed third-party profile entry in Claude's configLibrary. */
export const CLAUDE_DESKTOP_PROFILE_ID = '00000000-0000-4000-8000-0000a4753eed';
const CLAUDE_DESKTOP_PROFILE_NAME = 'Torve';

export function readString(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function readRequiredString(raw: Record<string, unknown>, key: string, context: string | number): string {
  const value = readString(raw, key);
  if (!value) throw new Error(`System Proxy profile ${context} requires ${key}`);
  return value;
}

/** Parses a profile's configPatch blob into a ConfigPatchDef. Every format in
 *  the union needs its own branch here — an unmatched format falls through to
 *  opencode, whose `npm` requirement then throws at profile load (i.e. app
 *  startup). Lives in this electron-free module so tests can feed every
 *  default profile through it. */
export function readConfigPatch(value: unknown, profileName: string): ConfigPatchDef | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`configPatch for ${profileName} must be an object`);
  }
  const raw = value as Record<string, unknown>;
  const format = readString(raw, 'format');
  // Claude Desktop's gateway profile has no provider entry of its own —
  // auth is a placeholder key the loopback gateway ignores — so it skips
  // the providerKey every other format requires.
  if (format === 'claude-desktop') {
    return {
      format: 'claude-desktop',
      configPath: readRequiredString(raw, 'configPath', profileName),
      thirdPartyDir: readRequiredString(raw, 'thirdPartyDir', profileName),
      baseURL: readRequiredString(raw, 'baseURL', profileName),
    };
  }
  if (format === 'gemini-cli') {
    return {
      format: 'gemini-cli',
      configPath: readRequiredString(raw, 'configPath', profileName),
      envPath: readRequiredString(raw, 'envPath', profileName),
      baseURL: readRequiredString(raw, 'baseURL', profileName),
      ...(readString(raw, 'model') ? { model: readString(raw, 'model') } : {}),
    };
  }
  if (format === 'aider') return { format: 'aider', configPath: readRequiredString(raw, 'configPath', profileName), baseURL: readRequiredString(raw, 'baseURL', profileName) };
  if (format === 'continue') return { format: 'continue', configPath: readRequiredString(raw, 'configPath', profileName), ...(readString(raw, 'legacyConfigPath') ? { legacyConfigPath: readString(raw, 'legacyConfigPath') } : {}), baseURL: readRequiredString(raw, 'baseURL', profileName) };
  if (format === 'antigravity-ide') {
    return {
      format: 'antigravity-ide',
      configPath: readRequiredString(raw, 'configPath', profileName),
      baseURL: readRequiredString(raw, 'baseURL', profileName),
      ...(readString(raw, 'mcpConfigPath') ? { mcpConfigPath: readString(raw, 'mcpConfigPath') } : {}),
      ...(readString(raw, 'serverPath') ? { serverPath: readString(raw, 'serverPath') } : {}),
      ...(raw['mcpFallback'] === true ? { mcpFallback: true } : {}),
    };
  }
  const configPath = readRequiredString(raw, 'configPath', profileName);
  const providerKey = readRequiredString(raw, 'providerKey', profileName);
  const baseURL = readRequiredString(raw, 'baseURL', profileName);
  if (format === 'codex') {
    return {
      format: 'codex',
      configPath,
      providerKey,
      providerName: readRequiredString(raw, 'providerName', profileName),
      baseURL,
      ...(readString(raw, 'model') ? { model: readString(raw, 'model') } : {}),
      ...(readString(raw, 'modelCatalogJson') ? { modelCatalogJson: readString(raw, 'modelCatalogJson') } : {}),
      ...(readString(raw, 'bearerToken') ? { bearerToken: readString(raw, 'bearerToken') } : {}),
      ...(raw['installProbe'] === 'codex' ? { installProbe: 'codex' as const } : {}),
    };
  }
  if (format === 'droid') {
    const originator = readString(raw, 'originator');
    return {
      format: 'droid',
      configPath,
      providerKey,
      providerName: readRequiredString(raw, 'providerName', profileName),
      baseURL,
      ...(originator ? { originator } : {}),
      ...(raw['installProbe'] === 'droid' ? { installProbe: 'droid' as const } : {}),
    };
  }
  if (format === 'pi') {
    const api = raw['api'];
    const originator = readString(raw, 'originator');
    return {
      format: 'pi',
      configPath,
      settingsPath: readRequiredString(raw, 'settingsPath', profileName),
      providerKey,
      baseURL,
      api: api === 'openai-responses' || api === 'anthropic-messages' ? api : 'openai-completions',
      ...(originator ? { originator } : {}),
      ...(raw['installProbe'] === 'pi' ? { installProbe: 'pi' as const } : {}),
    };
  }
  if (format === 'crush') {
    const wslConfigPath = readString(raw, 'wslConfigPath');
    return {
      format: 'crush',
      configPath,
      ...(wslConfigPath ? { wslConfigPath } : {}),
      providerKey,
      providerName: readRequiredString(raw, 'providerName', profileName),
      baseURL,
      ...(raw['installProbe'] === 'crush' ? { installProbe: 'crush' as const } : {}),
    };
  }
  if (format === 'goose') {
    const wslConfigPath = readString(raw, 'wslConfigPath');
    return {
      format: 'goose',
      configPath,
      ...(wslConfigPath ? { wslConfigPath } : {}),
      providerKey,
      baseURL,
      ...(raw['installProbe'] === 'goose' ? { installProbe: 'goose' as const } : {}),
    };
  }
  if (format === 'hermes') {
    return {
      format: 'hermes',
      configPath,
      providerKey,
      baseURL,
    };
  }
  if (format === 'zed') {
    return {
      format: 'zed',
      configPath,
      providerKey,
      providerName: readRequiredString(raw, 'providerName', profileName),
      baseURL,
    };
  }
  if (format === 'claude-code') {
    return {
      format: 'claude-code',
      configPath,
      providerKey,
      baseURL,
      ...(raw['installProbe'] === 'claude' ? { installProbe: 'claude' as const } : {}),
    };
  }
  if (format === 't3code') {
    return {
      format: 't3code',
      configPath,
      providerKey,
      providerName: readRequiredString(raw, 'providerName', profileName),
      baseURL,
    };
  }
  return {
    format: 'opencode',
    configPath,
    providerKey,
    npm: readRequiredString(raw, 'npm', profileName),
    providerName: readRequiredString(raw, 'providerName', profileName),
    baseURL,
    ...(raw['installProbe'] === 'opencode' ? { installProbe: 'opencode' as const } : {}),
  };
}

type JsonObject = Record<string, unknown>;

function expandTilde(p: string): string {
  return p.startsWith('~/') ? path.join(homedir(), p.slice(2)) : p;
}

/** OpenCode CLI and Desktop share the XDG config on the installed Windows
 * build. Older Desktop builds may instead place an explicit config under
 * APPDATA, so patch it only when that config file actually exists. */
export function opencodeConfigTargets(
  patch: OpencodeConfigPatchDef,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  fileExists: (filePath: string) => boolean = existsSync,
): string[] {
  const configured = expandTilde(patch.configPath);
  const configuredDir = path.dirname(configured);
  const configuredName = path.basename(configured).toLowerCase();
  const siblingName = configuredName === 'opencode.json' ? 'opencode.jsonc' : 'opencode.json';
  const candidates = [configured, path.join(configuredDir, siblingName)];
  if (platform === 'win32') {
    const roaming = env['APPDATA'] || path.join(homedir(), 'AppData', 'Roaming');
    for (const name of ['opencode.jsonc', 'opencode.json']) candidates.push(path.join(roaming, 'opencode', name));
  }
  const unique = [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
  const existing = unique.filter(fileExists);
  return existing.length > 0 ? existing : [path.resolve(configured)];
}

function isBuyerProxyRoutablePeerId(peerId: string): boolean {
  const normalized = peerId.trim().toLowerCase().replace(/^0x/, '');
  return /^[0-9a-f]{40}$/.test(normalized);
}

export function stripJsoncComments(raw: string): string {
  let result = '';
  let inString = false;
  let quote = '';
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    const next = raw[i + 1];
    if (inString) {
      result += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        inString = false;
        quote = '';
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      result += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < raw.length && raw[i] !== '\n') i++;
      if (i < raw.length) result += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < raw.length && !(raw[i] === '*' && raw[i + 1] === '/')) {
        result += raw[i] === '\n' ? '\n' : ' ';
        i++;
      }
      i++;
      continue;
    }
    result += ch;
  }
  return result;
}

export function stripJsoncTrailingCommas(raw: string): string {
  let result = '';
  let inString = false;
  let quote = '';
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (inString) {
      result += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        inString = false;
        quote = '';
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      result += ch;
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (j < raw.length && /\s/.test(raw[j]!)) j++;
      if (raw[j] === '}' || raw[j] === ']') {
        continue;
      }
    }
    result += ch;
  }
  return result;
}

export function parseJsoncObject(raw: string, filePath: string): JsonObject {
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

function readJsoncFile(filePath: string): JsonObject | null {
  try {
    const raw = readFileSync(filePath, 'utf8');
    return parseJsoncObject(raw, filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

function readConfigPatchFile(filePath: string): JsonObject {
  if (!existsSync(filePath)) {
    return {};
  }
  return readJsoncFile(filePath) ?? {};
}

function tryReadConfigPatchFile(filePath: string): JsonObject | null {
  if (!existsSync(filePath)) {
    return null;
  }
  return readJsoncFile(filePath);
}

function writeJsonFile(filePath: string, data: JsonObject): void {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const temp = path.join(dir, `.${path.basename(filePath)}.torve-${process.pid}-${Date.now()}.tmp`);
  try {
    writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', 'utf8');
    renameSync(temp, filePath);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}

function writeTextFileAtomically(filePath: string, content: string): void {
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

function backupConfigFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  const backupPath = `${filePath}.torve.bak`;
  if (existsSync(backupPath)) return;
  copyFileSync(filePath, backupPath);
}

function removeFromStringArray(config: JsonObject, key: string, value: string): void {
  const arr = config[key];
  if (!Array.isArray(arr)) return;
  const filtered = arr.filter((item) => item !== value);
  if (filtered.length === 0) delete config[key];
  else config[key] = filtered;
}

/**
 * Point the tool's config at the buyer proxy. The config exposes a single
 * model — the ROUTED_MODEL_ALIAS — which the buyer resolves per request to
 * the route currently selected in the desktop (floating pill / AI VPN). Concrete
 * `<peerId>@<service>` entries are no longer written: the only place to pick
 * a model is the desktop route selector, so route changes reach running tool
 * sessions without a config rewrite.
 */
export function applyConfigPatch(patch: ConfigPatchDef, peerId: string, buyerPort: number, wslTargetsFile?: string): void {
  if (peerId !== 'direct' && !isBuyerProxyRoutablePeerId(peerId)) {
    throw new Error('Config-based routing requires a 40-character hex peer ID. Select a chain-backed peer before enabling this tool.');
  }
  if (patch.format === 'codex') {
    applyCodexConfigPatch(patch, buyerPort, wslTargetsFile);
    return;
  }
  if (patch.format === 'droid') {
    applyDroidConfigPatch(patch, buyerPort, wslTargetsFile);
    return;
  }
  if (patch.format === 'pi') {
    applyPiConfigPatch(patch, buyerPort, wslTargetsFile);
    return;
  }
  if (patch.format === 'crush') {
    applyCrushConfigPatch(patch, buyerPort, wslTargetsFile);
    return;
  }
  if (patch.format === 'goose') {
    applyGooseConfigPatch(patch, buyerPort, wslTargetsFile);
    return;
  }
  if (patch.format === 'hermes') {
    applyHermesConfigPatch(patch, buyerPort);
    return;
  }
  if (patch.format === 'zed') {
    applyZedConfigPatch(patch, buyerPort);
    return;
  }
  if (patch.format === 'claude-code') {
    applyClaudeCodeConfigPatch(patch, buyerPort, wslTargetsFile);
    return;
  }
  if (patch.format === 't3code') {
    applyT3CodeConfigPatch(patch, buyerPort);
    return;
  }
  if (patch.format === 'gemini-cli') {
    applyGeminiCliConfigPatch(patch, buyerPort);
    return;
  }
  if (patch.format === 'aider') { applyAiderConfigPatch(patch, buyerPort); return; }
  if (patch.format === 'continue') { applyContinueConfigPatch(patch, buyerPort); return; }
  if (patch.format === 'antigravity-ide') { applyAntigravityPatch(patch, buyerPort); return; }
  if (patch.format === 'claude-desktop') {
    applyClaudeDesktopConfigPatch(patch);
    return;
  }
  applyOpencodeConfigPatch(patch, buyerPort, wslTargetsFile);
}

/** Replace the host of a base URL, leaving scheme, port, and path untouched.
    Regex rather than URL because the string may still carry the `{buyerPort}`
    placeholder, which URL refuses to parse. */
export function substituteBaseUrlHost(baseURL: string, host: string): string {
  return baseURL.replace(/^(https?:\/\/)[^/:]+/, `$1${host}`);
}

/** Signals that a tool actually exists natively: its config dir, its
    home-relative install/state locations (shared with the WSL probe), or the
    binary on PATH. Any one suffices — a GUI process sees a reduced PATH, and
    some tools only create the config dir once configured. */
function nativeToolInstalled(tool: WslTool, configFilePath: string): boolean {
  if (existsSync(path.dirname(configFilePath))) return true;
  if (tool === 'opencode' && process.platform === 'win32') {
    const local = process.env['LOCALAPPDATA'] || path.join(homedir(), 'AppData', 'Local');
    if (existsSync(path.join(local, 'Programs', '@opencode-aidesktop', 'OpenCode.exe'))) return true;
  }
  const probe = WSL_TOOL_PROBES[tool];
  if (probe.signals.some((signal) => existsSync(path.join(homedir(), ...signal.split('/'))))) return true;
  try {
    if (process.platform === 'win32') {
      execFileSync('where.exe', [probe.binary], { stdio: 'ignore', windowsHide: true });
    } else {
      execFileSync('/bin/sh', ['-c', `command -v ${probe.binary}`], { stdio: 'ignore' });
    }
    return true;
  } catch {
    return false;
  }
}

type PatchFilePaths = { configPath: string; settingsPath?: string };

/**
 * Shared install-probe patching: write the config to the native install only
 * when install signals exist, write it into every WSL distro carrying the
 * tool (with a base URL host that distro can reach), remember the WSL
 * targets for removal, and throw when the tool is found nowhere.
 */
function applyWithInstallProbe(opts: {
  tool: WslTool;
  native: PatchFilePaths;
  /** `~/`-rooted config locations, for mapping into WSL distros. */
  posix: PatchFilePaths;
  baseURL: string;
  wslTargetsFile?: string;
  write: (paths: PatchFilePaths, baseURL: string) => void;
}): void {
  const nativeInstalled = nativeToolInstalled(opts.tool, opts.native.configPath);
  const wslTargets = discoverWslToolTargets(opts.tool, opts.posix);
  if (!nativeInstalled && wslTargets.length === 0) {
    throw new Error(
      `${opts.tool} was not found on this machine`
      + (process.platform === 'win32' ? ' or in any WSL distro' : '')
      + ` — nothing to connect. Looked for ${path.dirname(opts.native.configPath)}, `
      + `its home install locations, and a ${WSL_TOOL_PROBES[opts.tool].binary} binary on PATH. `
      + `Install ${opts.tool} (or run it once), then reconnect.`,
    );
  }
  if (nativeInstalled) opts.write(opts.native, opts.baseURL);
  for (const target of wslTargets) {
    // Inside WSL, `localhost` is the distro's own VM under NAT networking —
    // the config must carry the host the distro can actually reach the
    // Windows-side buyer proxy on.
    opts.write(
      { configPath: target.configPath, ...(target.settingsPath ? { settingsPath: target.settingsPath } : {}) },
      substituteBaseUrlHost(opts.baseURL, target.host),
    );
  }
  if (opts.wslTargetsFile) saveWslTargetsForTool(opts.wslTargetsFile, opts.tool, wslTargets);
}

/** Unpatch the WSL targets remembered for `tool` and forget them. */
function removeWslInstalls(
  tool: WslTool,
  wslTargetsFile: string | undefined,
  removeFrom: (target: WslConfigTarget) => boolean,
): boolean {
  if (!wslTargetsFile) return false;
  let changed = false;
  for (const target of readWslTargetsForTool(wslTargetsFile, tool)) {
    try {
      if (removeFrom(target)) changed = true;
    } catch {
      // Distro stopped or the UNC share is unavailable. The stale provider
      // entry is inert (it points at a dead host/port) and the next connect
      // rewrites it.
    }
  }
  clearWslTargetsForTool(wslTargetsFile, tool);
  return changed;
}

function applyOpencodeConfigPatch(patch: OpencodeConfigPatchDef, buyerPort: number, wslTargetsFile?: string): void {
  const filePath = expandTilde(patch.configPath);
  const nativeTargets = opencodeConfigTargets(patch);
  const baseURL = patch.baseURL.replace('{buyerPort}', String(buyerPort));
  if (patch.installProbe !== 'opencode') {
    for (const target of nativeTargets) applyOpencodeProviderToFile(target, patch, baseURL);
    return;
  }
  applyWithInstallProbe({
    tool: 'opencode',
    native: { configPath: filePath },
    posix: { configPath: patch.configPath },
    baseURL,
    wslTargetsFile,
    write: (paths, url) => {
      if (path.resolve(paths.configPath) === path.resolve(filePath)) {
        for (const target of nativeTargets) applyOpencodeProviderToFile(target, patch, url);
      } else {
        applyOpencodeProviderToFile(paths.configPath, patch, url);
      }
    },
  });
}

function applyOpencodeProviderToFile(filePath: string, patch: OpencodeConfigPatchDef, baseURL: string): void {
  backupConfigFile(filePath);
  const config = readConfigPatchFile(filePath);

  const existingProviders = (config['provider'] && typeof config['provider'] === 'object' && !Array.isArray(config['provider']))
    ? config['provider'] as JsonObject
    : {};
  const existingModernProviders = (config['providers'] && typeof config['providers'] === 'object' && !Array.isArray(config['providers']))
    ? config['providers'] as JsonObject
    : {};
  const alias = patch.modelAlias?.trim() || ROUTED_MODEL_ALIAS;
  const apiKey = patch.apiKey ?? ROUTED_MODEL_ALIAS;

  // Build legacy `provider` entry (npm-based, OpenCode <=0.3)
  const models: JsonObject = {
    [alias]: {
      name: ROUTED_MODEL_ALIAS_LABEL,
      attachment: true,
      modalities: { input: ['text', 'image'], output: ['text'] },
      limit: { context: TORVE_MODEL_CONTEXT_WINDOW, output: TORVE_MODEL_MAX_OUTPUT_TOKENS },
    },
  };
  // Build modern `providers` entry (openai-compatible, OpenCode >=0.4)
  const modernModels: JsonObject = {
    [alias]: {
      modelID: alias,
      name: ROUTED_MODEL_ALIAS_LABEL,
      type: 'chat',
      limit: { context: TORVE_MODEL_CONTEXT_WINDOW, output: TORVE_MODEL_MAX_OUTPUT_TOKENS },
    },
  };
  for (const model of patch.models ?? []) {
    const id = model.id.trim();
    if (!id || id === alias || id === ROUTED_MODEL_ALIAS || id === 'auto') continue;
    const limit: JsonObject = {};
    if (typeof model.context === 'number' && Number.isFinite(model.context) && model.context > 0) limit['context'] = Math.max(model.context, 128_000);
    if (typeof model.output === 'number' && Number.isFinite(model.output) && model.output > 0) limit['output'] = model.output;
    models[id] = {
      name: model.name.trim() || id,
      attachment: model.vision === true,
      modalities: { input: model.vision === true ? ['text', 'image'] : ['text'], output: ['text'] },
      ...(Object.keys(limit).length > 0 ? { limit } : {}),
    };
    modernModels[id] = {
      modelID: id,
      name: model.name.trim() || id,
      type: 'chat',
      ...(Object.keys(limit).length > 0 ? { limit } : {}),
    };
  }
  existingProviders[patch.providerKey] = {
    name: patch.providerName,
    npm: patch.npm,
    options: {
      baseURL,
      apiKey,
    },
    models,
  };
  existingModernProviders[patch.providerKey] = {
    name: patch.providerName,
    package: '@opencode/ai/providers/openai-compatible',
    settings: {
      baseURL,
      apiKey,
      headerTimeout: 30_000,
      chunkTimeout: 60_000,
      timeout: 120_000,
    },
    models: modernModels,
  };
  config['provider'] = existingProviders;
  config['providers'] = existingModernProviders;
  config['model'] = `${patch.providerKey}/${alias}`;
  removeFromStringArray(config, 'disabled_providers', patch.providerKey);

  writeJsonFile(filePath, config);
}

export function removeConfigPatch(patch: ConfigPatchDef, wslTargetsFile?: string): boolean {
  if (patch.format === 'codex') {
    return removeCodexConfigPatch(patch, wslTargetsFile);
  }
  if (patch.format === 'droid') {
    return removeDroidConfigPatch(patch, wslTargetsFile);
  }
  if (patch.format === 'pi') {
    return removePiConfigPatch(patch, wslTargetsFile);
  }
  if (patch.format === 'crush') {
    return removeCrushConfigPatch(patch, wslTargetsFile);
  }
  if (patch.format === 'goose') {
    return removeGooseConfigPatch(patch, wslTargetsFile);
  }
  if (patch.format === 'hermes') {
    return removeHermesConfigPatch(patch);
  }
  if (patch.format === 'zed') {
    return removeZedConfigPatch(patch);
  }
  if (patch.format === 'claude-code') {
    return removeClaudeCodeConfigPatch(patch, wslTargetsFile);
  }
  if (patch.format === 't3code') {
    return removeT3CodeConfigPatch(patch);
  }
  if (patch.format === 'gemini-cli') {
    return removeGeminiCliConfigPatch(patch);
  }
  if (patch.format === 'aider') return removeAiderConfigPatch(patch);
  if (patch.format === 'continue') return removeContinueConfigPatch(patch);
  if (patch.format === 'antigravity-ide') return removeAntigravityPatch(patch);
  if (patch.format === 'claude-desktop') {
    return removeClaudeDesktopConfigPatch(patch);
  }
  let changed = false;
  for (const target of opencodeConfigTargets(patch)) changed = removeOpencodeProviderFromFile(target, patch) || changed;
  if (patch.installProbe === 'opencode') {
    changed = removeWslInstalls('opencode', wslTargetsFile, (target) => removeOpencodeProviderFromFile(target.configPath, patch)) || changed;
  }
  return changed;
}

function removeOpencodeProviderFromFile(filePath: string, patch: OpencodeConfigPatchDef): boolean {
  const config = tryReadConfigPatchFile(filePath);
  if (!config) return false;
  backupConfigFile(filePath);

  let changed = false;
  for (const key of ['provider', 'providers']) {
    const providers = config[key];
    if (providers && typeof providers === 'object' && !Array.isArray(providers) && (patch.providerKey in (providers as JsonObject))) {
      delete (providers as JsonObject)[patch.providerKey];
      changed = true;
    }
  }
  if (typeof config['model'] === 'string' && config['model'].startsWith(`${patch.providerKey}/`)) {
    delete config['model'];
    changed = true;
  }
  if (!changed) return false;
  writeJsonFile(filePath, config);
  return true;
}

function writeTextFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeTextFileAtomically(filePath, content);
}

// --- Droid CLI + Factory Desktop (`~/.factory/settings.json`) ---
//
// Both clients watch this file and share its `customModels` catalog. The
// sidecar remembers only the fields Torve temporarily owns so disconnect
// can restore the user's prior default without rolling back unrelated edits.

type DroidPatchState = {
  readonly version: 1 | 2;
  readonly configExisted: boolean;
  readonly customModelsPresent: boolean;
  readonly modelPresent: boolean;
  readonly modelValue?: unknown;
  readonly sessionDefaultSettingsPresent: boolean;
  readonly sessionDefaultModelPresent: boolean;
  readonly sessionDefaultModelValue?: unknown;
};

function droidPatchStatePath(filePath: string): string {
  return `${filePath}.torve.state.json`;
}

function readDroidPatchState(filePath: string): DroidPatchState | null {
  const state = tryReadConfigPatchFile(droidPatchStatePath(filePath));
  if (!state) return null;
  if ((state['version'] !== 1 && state['version'] !== 2)
    || typeof state['configExisted'] !== 'boolean'
    || typeof state['customModelsPresent'] !== 'boolean'
    || typeof state['modelPresent'] !== 'boolean'
    || (state['version'] === 2 && (
      typeof state['sessionDefaultSettingsPresent'] !== 'boolean'
      || typeof state['sessionDefaultModelPresent'] !== 'boolean'
    ))) {
    throw new Error(`Invalid Torve Droid restore state at ${droidPatchStatePath(filePath)}`);
  }
  return {
    version: state['version'],
    configExisted: state['configExisted'],
    customModelsPresent: state['customModelsPresent'],
    modelPresent: state['modelPresent'],
    ...(state['modelPresent'] ? { modelValue: state['modelValue'] } : {}),
    sessionDefaultSettingsPresent: state['version'] === 2 && state['sessionDefaultSettingsPresent'] === true,
    sessionDefaultModelPresent: state['version'] === 2 && state['sessionDefaultModelPresent'] === true,
    ...(state['version'] === 2 && state['sessionDefaultModelPresent']
      ? { sessionDefaultModelValue: state['sessionDefaultModelValue'] }
      : {}),
  };
}

function writeDroidPatchState(filePath: string, state: DroidPatchState): void {
  writeJsonFile(droidPatchStatePath(filePath), {
    version: 2,
    configExisted: state.configExisted,
    customModelsPresent: state.customModelsPresent,
    modelPresent: state.modelPresent,
    ...(state.modelPresent ? { modelValue: state.modelValue } : {}),
    sessionDefaultSettingsPresent: state.sessionDefaultSettingsPresent,
    sessionDefaultModelPresent: state.sessionDefaultModelPresent,
    ...(state.sessionDefaultModelPresent ? { sessionDefaultModelValue: state.sessionDefaultModelValue } : {}),
  });
}

function deleteDroidPatchState(filePath: string): void {
  try {
    unlinkSync(droidPatchStatePath(filePath));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

function droidCustomModels(config: JsonObject, filePath: string): unknown[] {
  const customModels = config['customModels'];
  if (customModels === undefined) return [];
  if (!Array.isArray(customModels)) {
    throw new Error(`Droid customModels at ${filePath} must be an array`);
  }
  return customModels;
}

function isDroidModel(value: unknown, model: string): boolean {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && (value as JsonObject)['model'] === model);
}

function droidSessionDefaultSettings(config: JsonObject, filePath: string): JsonObject | undefined {
  const settings = config['sessionDefaultSettings'];
  if (settings === undefined) return undefined;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error(`Droid sessionDefaultSettings at ${filePath} must be an object`);
  }
  return settings as JsonObject;
}

function applyDroidConfigPatch(patch: DroidConfigPatchDef, buyerPort: number, wslTargetsFile?: string): void {
  const filePath = expandTilde(patch.configPath);
  const baseURL = patch.baseURL.replace('{buyerPort}', String(buyerPort));
  if (patch.installProbe !== 'droid') {
    applyDroidModelToFile(filePath, patch, baseURL);
    return;
  }
  applyWithInstallProbe({
    tool: 'droid',
    native: { configPath: filePath },
    posix: { configPath: patch.configPath },
    baseURL,
    wslTargetsFile,
    write: (paths, url) => applyDroidModelToFile(paths.configPath, patch, url),
  });
}

function applyDroidModelToFile(filePath: string, patch: DroidConfigPatchDef, baseURL: string): void {
  const configExisted = existsSync(filePath);
  backupConfigFile(filePath);
  const config = readConfigPatchFile(filePath);
  const customModelsPresent = Object.prototype.hasOwnProperty.call(config, 'customModels');
  const customModels = droidCustomModels(config, filePath);
  const existingSessionDefaultSettings = droidSessionDefaultSettings(config, filePath);
  const state = readDroidPatchState(filePath);
  const matchingModels = customModels.filter((model) => isDroidModel(model, patch.providerKey));
  if (matchingModels.length > 0 && !state) {
    throw new Error(
      `Droid already defines a custom model named ${patch.providerKey} in ${filePath}; refusing to overwrite it.`,
    );
  }
  if (!state) {
    const modelPresent = Object.prototype.hasOwnProperty.call(config, 'model');
    const sessionDefaultSettingsPresent = existingSessionDefaultSettings !== undefined;
    const sessionDefaultModelPresent = existingSessionDefaultSettings !== undefined
      && Object.prototype.hasOwnProperty.call(existingSessionDefaultSettings, 'model');
    writeDroidPatchState(filePath, {
      version: 2,
      configExisted,
      customModelsPresent,
      modelPresent,
      ...(modelPresent ? { modelValue: config['model'] } : {}),
      sessionDefaultSettingsPresent,
      sessionDefaultModelPresent,
      ...(sessionDefaultModelPresent
        ? { sessionDefaultModelValue: existingSessionDefaultSettings['model'] }
        : {}),
    });
  }

  const extraHeaders = patch.originator ? { originator: patch.originator } : {};
  config['customModels'] = [
    ...customModels.filter((model) => !isDroidModel(model, patch.providerKey)),
    {
      model: patch.providerKey,
      id: DROID_ROUTED_MODEL_ID,
      displayName: patch.providerName,
      baseUrl: baseURL,
      provider: 'generic-chat-completion-api',
      maxOutputTokens: TORVE_MODEL_MAX_OUTPUT_TOKENS,
      ...(Object.keys(extraHeaders).length > 0 ? { extraHeaders } : {}),
    },
  ];
  const sessionDefaultSettings = existingSessionDefaultSettings ?? {};
  sessionDefaultSettings['model'] = DROID_ROUTED_MODEL_ID;
  config['sessionDefaultSettings'] = sessionDefaultSettings;
  writeJsonFile(filePath, config);
}

function removeDroidConfigPatch(patch: DroidConfigPatchDef, wslTargetsFile?: string): boolean {
  let changed = removeDroidModelFromFile(expandTilde(patch.configPath), patch);
  if (patch.installProbe === 'droid') {
    changed = removeWslInstalls('droid', wslTargetsFile, (target) => (
      removeDroidModelFromFile(target.configPath, patch)
    )) || changed;
  }
  return changed;
}

function removeDroidModelFromFile(filePath: string, patch: DroidConfigPatchDef): boolean {
  const state = readDroidPatchState(filePath);
  if (!state) return false;
  const config = tryReadConfigPatchFile(filePath);
  if (!config) {
    deleteDroidPatchState(filePath);
    return true;
  }
  backupConfigFile(filePath);

  let changed = false;
  const customModels = config['customModels'];
  if (Array.isArray(customModels)) {
    const filtered = customModels.filter((model) => !isDroidModel(model, patch.providerKey));
    if (filtered.length !== customModels.length) {
      if (filtered.length === 0 && !state.customModelsPresent) delete config['customModels'];
      else config['customModels'] = filtered;
      changed = true;
    }
  }
  const sessionDefaultSettings = droidSessionDefaultSettings(config, filePath);
  const managedSessionDefault = sessionDefaultSettings?.['model'] === DROID_ROUTED_MODEL_ID;
  if (managedSessionDefault && sessionDefaultSettings) {
    if (state.sessionDefaultModelPresent) {
      sessionDefaultSettings['model'] = state.sessionDefaultModelValue;
    } else {
      delete sessionDefaultSettings['model'];
    }
    if (!state.sessionDefaultSettingsPresent && Object.keys(sessionDefaultSettings).length === 0) {
      delete config['sessionDefaultSettings'];
    }
    changed = true;
  }
  const modelPresent = Object.prototype.hasOwnProperty.call(config, 'model');
  if (config['model'] === patch.providerKey || (managedSessionDefault && !modelPresent && state.modelPresent)) {
    if (state.modelPresent) config['model'] = state.modelValue;
    else delete config['model'];
    changed = true;
  }

  if (!state.configExisted && Object.keys(config).length === 0) {
    unlinkSync(filePath);
  } else if (changed) {
    writeJsonFile(filePath, config);
  }
  deleteDroidPatchState(filePath);
  return changed;
}

// --- Codex CLI (`~/.codex/config.toml`) ---
//
// Codex config is TOML, edited structurally instead of parsed: the managed
// `[model_providers.<key>]` table is replaced wholesale and the top-level
// `model_provider` / `model` keys are set in the region before the first
// table header (TOML requires top-level keys there). Everything the user
// wrote is left untouched.

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

function applyCodexConfigPatch(patch: CodexConfigPatchDef, buyerPort: number, wslTargetsFile?: string): void {
  const filePath = expandTilde(patch.configPath);
  const baseURL = patch.baseURL.replace('{buyerPort}', String(buyerPort));
  if (patch.installProbe !== 'codex') {
    applyCodexProviderToFile(filePath, patch, baseURL);
    return;
  }
  applyWithInstallProbe({
    tool: 'codex',
    native: { configPath: filePath },
    posix: { configPath: patch.configPath },
    baseURL,
    wslTargetsFile,
    write: (paths, url) => applyCodexProviderToFile(paths.configPath, patch, url),
  });
}

function applyCodexProviderToFile(filePath: string, patch: CodexConfigPatchDef, baseURL: string): void {
  backupConfigFile(filePath);
  const raw = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
  let lines = raw.length > 0 ? raw.split('\n') : [];
  lines = removeCodexProviderTable(lines, patch.providerKey).lines;
  lines = setTomlTopLevelString(lines, 'model_provider', patch.providerKey);
  lines = setTomlTopLevelString(lines, 'model', patch.model || ROUTED_MODEL_ALIAS);
  if (patch.modelCatalogJson) lines = setTomlTopLevelString(lines, 'model_catalog_json', expandTilde(patch.modelCatalogJson));
  lines = setTomlTopLevelValue(lines, 'model_context_window', String(TORVE_MODEL_CONTEXT_WINDOW));
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
  lines.push(
    '',
    `[model_providers.${patch.providerKey}]`,
    `name = ${tomlBasicString(patch.providerName)}`,
    `base_url = ${tomlBasicString(baseURL)}`,
    // The only wire API Codex still supports; no env_key means Codex sends no
    // Authorization header, which the keyless buyer proxy expects.
    'wire_api = "responses"',
    ...(patch.bearerToken ? [`experimental_bearer_token = ${tomlBasicString(patch.bearerToken)}`] : []),
  );
  writeTextFile(filePath, `${lines.join('\n')}\n`);
}

function removeCodexConfigPatch(patch: CodexConfigPatchDef, wslTargetsFile?: string): boolean {
  let changed = removeCodexProviderFromFile(expandTilde(patch.configPath), patch);
  if (patch.installProbe === 'codex') {
    changed = removeWslInstalls('codex', wslTargetsFile, (target) => removeCodexProviderFromFile(target.configPath, patch)) || changed;
  }
  return changed;
}

function removeCodexProviderFromFile(filePath: string, patch: CodexConfigPatchDef): boolean {
  if (!existsSync(filePath)) return false;
  const raw = readFileSync(filePath, 'utf8');
  const removal = removeCodexProviderTable(raw.split('\n'), patch.providerKey);
  let lines = removal.lines;
  let changed = removal.changed;
  if (readTomlTopLevelString(lines, 'model_provider') === patch.providerKey) {
    lines = removeTomlTopLevelKey(lines, 'model_provider');
    lines = removeTomlTopLevelKey(lines, 'model');
    lines = removeTomlTopLevelKey(lines, 'model_context_window');
    if (patch.modelCatalogJson) lines = removeTomlTopLevelKey(lines, 'model_catalog_json');
    changed = true;
  }
  if (!changed) return false;
  backupConfigFile(filePath);
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
  writeTextFile(filePath, lines.length > 0 ? `${lines.join('\n')}\n` : '');
  return true;
}

// --- pi (`~/.pi/agent/models.json` + `~/.pi/agent/settings.json`) ---
//
// pi discovers custom providers from models.json and picks the default
// provider/model from settings.json. The apiKey is a placeholder — the buyer
// proxy is keyless, but pi hides models that have no credential at all.

function applyPiConfigPatch(patch: PiConfigPatchDef, buyerPort: number, wslTargetsFile?: string): void {
  const baseURL = patch.baseURL.replace('{buyerPort}', String(buyerPort));
  const native = { configPath: expandTilde(patch.configPath), settingsPath: expandTilde(patch.settingsPath) };
  if (patch.installProbe !== 'pi') {
    applyPiProviderToFiles(native.configPath, native.settingsPath, patch, baseURL);
    return;
  }
  applyWithInstallProbe({
    tool: 'pi',
    native,
    posix: { configPath: patch.configPath, settingsPath: patch.settingsPath },
    baseURL,
    wslTargetsFile,
    write: (paths, url) => applyPiProviderToFiles(paths.configPath, paths.settingsPath ?? native.settingsPath, patch, url),
  });
}

function applyPiProviderToFiles(modelsPath: string, settingsPath: string, patch: PiConfigPatchDef, baseURL: string): void {
  backupConfigFile(modelsPath);
  const config = readConfigPatchFile(modelsPath);
  const providers = (config['providers'] && typeof config['providers'] === 'object' && !Array.isArray(config['providers']))
    ? config['providers'] as JsonObject
    : {};
  providers[patch.providerKey] = {
    baseUrl: baseURL,
    api: patch.api,
    apiKey: 'torve',
    ...(patch.originator ? { headers: { originator: patch.originator } } : {}),
    models: [
      {
        id: ROUTED_MODEL_ALIAS,
        name: ROUTED_MODEL_ALIAS_LABEL,
        contextWindow: TORVE_MODEL_CONTEXT_WINDOW,
        maxTokens: TORVE_MODEL_MAX_OUTPUT_TOKENS,
      },
    ],
  };
  config['providers'] = providers;
  writeJsonFile(modelsPath, config);

  backupConfigFile(settingsPath);
  const settings = readConfigPatchFile(settingsPath);
  settings['defaultProvider'] = patch.providerKey;
  settings['defaultModel'] = ROUTED_MODEL_ALIAS;
  writeJsonFile(settingsPath, settings);
}

function removePiConfigPatch(patch: PiConfigPatchDef, wslTargetsFile?: string): boolean {
  let changed = removePiProviderFromFiles(expandTilde(patch.configPath), expandTilde(patch.settingsPath), patch);
  if (patch.installProbe === 'pi') {
    changed = removeWslInstalls('pi', wslTargetsFile, (target) =>
      removePiProviderFromFiles(target.configPath, target.settingsPath ?? '', patch)) || changed;
  }
  return changed;
}

function removePiProviderFromFiles(modelsPath: string, settingsPath: string, patch: PiConfigPatchDef): boolean {
  let changed = false;
  const config = tryReadConfigPatchFile(modelsPath);
  const providers = config?.['providers'];
  if (config && providers && typeof providers === 'object' && !Array.isArray(providers) && (patch.providerKey in (providers as JsonObject))) {
    backupConfigFile(modelsPath);
    delete (providers as JsonObject)[patch.providerKey];
    writeJsonFile(modelsPath, config);
    changed = true;
  }
  const settings = tryReadConfigPatchFile(settingsPath);
  if (settings && settings['defaultProvider'] === patch.providerKey) {
    backupConfigFile(settingsPath);
    delete settings['defaultProvider'];
    delete settings['defaultModel'];
    writeJsonFile(settingsPath, settings);
    changed = true;
  }
  return changed;
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

// --- Crush (`~/.config/crush/crush.json`) ---
//
// Crush takes custom endpoints as a `providers` map entry with
// `type: "openai-compat"`; the default model selection lives under
// `models.large` / `models.small` as `{ provider, model }`.

function applyCrushConfigPatch(patch: CrushConfigPatchDef, buyerPort: number, wslTargetsFile?: string): void {
  const filePath = expandTilde(patch.configPath);
  const baseURL = patch.baseURL.replace('{buyerPort}', String(buyerPort));
  if (patch.installProbe !== 'crush') {
    applyCrushProviderToFile(filePath, patch, baseURL);
    return;
  }
  applyWithInstallProbe({
    tool: 'crush',
    native: { configPath: filePath },
    posix: { configPath: patch.wslConfigPath ?? patch.configPath },
    baseURL,
    wslTargetsFile,
    write: (paths, url) => applyCrushProviderToFile(paths.configPath, patch, url),
  });
}

function applyCrushProviderToFile(filePath: string, patch: CrushConfigPatchDef, baseURL: string): void {
  backupConfigFile(filePath);
  const config = readConfigPatchFile(filePath);
  const providers = asObject(config['providers']);
  providers[patch.providerKey] = {
    type: 'openai-compat',
    name: patch.providerName,
    base_url: baseURL,
    api_key: 'torve',
    models: [
      { id: ROUTED_MODEL_ALIAS, name: ROUTED_MODEL_ALIAS_LABEL, context_window: TORVE_MODEL_CONTEXT_WINDOW, default_max_tokens: TORVE_MODEL_MAX_OUTPUT_TOKENS },
    ],
  };
  config['providers'] = providers;
  const models = asObject(config['models']);
  const selection = { provider: patch.providerKey, model: ROUTED_MODEL_ALIAS };
  models['large'] = { ...selection };
  models['small'] = { ...selection };
  config['models'] = models;
  writeJsonFile(filePath, config);
}

function removeCrushConfigPatch(patch: CrushConfigPatchDef, wslTargetsFile?: string): boolean {
  let changed = removeCrushProviderFromFile(expandTilde(patch.configPath), patch);
  if (patch.installProbe === 'crush') {
    changed = removeWslInstalls('crush', wslTargetsFile, (target) => removeCrushProviderFromFile(target.configPath, patch)) || changed;
  }
  return changed;
}

function removeCrushProviderFromFile(filePath: string, patch: CrushConfigPatchDef): boolean {
  const config = tryReadConfigPatchFile(filePath);
  if (!config) return false;
  let changed = false;
  const providers = config['providers'];
  if (providers && typeof providers === 'object' && !Array.isArray(providers) && (patch.providerKey in (providers as JsonObject))) {
    delete (providers as JsonObject)[patch.providerKey];
    changed = true;
  }
  const models = config['models'];
  if (models && typeof models === 'object' && !Array.isArray(models)) {
    for (const size of ['large', 'small']) {
      const entry = (models as JsonObject)[size];
      if (entry && typeof entry === 'object' && (entry as JsonObject)['provider'] === patch.providerKey) {
        delete (models as JsonObject)[size];
        changed = true;
      }
    }
    if (Object.keys(models as JsonObject).length === 0) delete config['models'];
  }
  if (!changed) return false;
  backupConfigFile(filePath);
  writeJsonFile(filePath, config);
  return true;
}

// --- goose (`~/.config/goose/config.yaml`) ---
//
// goose config is flat env-style YAML keys (GOOSE_PROVIDER, GOOSE_MODEL,
// OPENAI_HOST, ...), edited line-based so user keys and comments survive.
// OPENAI_HOST is the host root — goose appends the /v1 chat path itself.
// The api key normally lives in the OS keyring; the config-file value covers
// keyring-less setups, and the buyer proxy ignores the credential anyway.

function yamlScalar(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function yamlTopLevelKeyIndex(lines: readonly string[], key: string): number {
  const pattern = new RegExp(`^${key}\\s*:`);
  return lines.findIndex((line) => pattern.test(line));
}

function setYamlTopLevelString(lines: readonly string[], key: string, value: string): string[] {
  const assignment = `${key}: ${yamlScalar(value)}`;
  const index = yamlTopLevelKeyIndex(lines, key);
  if (index !== -1) {
    const next = [...lines];
    next[index] = assignment;
    return next;
  }
  return [...lines, assignment];
}

function readYamlTopLevelString(lines: readonly string[], key: string): string | undefined {
  const index = yamlTopLevelKeyIndex(lines, key);
  if (index === -1) return undefined;
  const raw = lines[index]!.slice(lines[index]!.indexOf(':') + 1).trim();
  const quoted = raw.match(/^"((?:[^"\\]|\\.)*)"/) ?? raw.match(/^'([^']*)'/);
  if (quoted) return quoted[1]!.replace(/\\(.)/g, '$1');
  return raw.split('#')[0]!.trim();
}

function removeYamlTopLevelKey(lines: readonly string[], key: string): string[] {
  const index = yamlTopLevelKeyIndex(lines, key);
  if (index === -1) return [...lines];
  return [...lines.slice(0, index), ...lines.slice(index + 1)];
}

/** True for host values only this patch would have written: a loopback root,
    or one of the WSL-reachable hosts a recorded target carries. */
function isLoopbackHost(value: string | undefined, extraHosts: readonly string[] = []): boolean {
  if (!value) return false;
  if (/^https?:\/\/(localhost|127\.0\.0\.1):\d+\/?$/.test(value)) return true;
  return extraHosts.some((host) =>
    new RegExp(`^https?://${host.replace(/[.$]/g, '\\$&')}:\\d+/?$`).test(value));
}

function applyGooseConfigPatch(patch: GooseConfigPatchDef, buyerPort: number, wslTargetsFile?: string): void {
  const filePath = expandTilde(patch.configPath);
  const baseURL = patch.baseURL.replace('{buyerPort}', String(buyerPort));
  if (patch.installProbe !== 'goose') {
    applyGooseProviderToFile(filePath, patch, baseURL);
    return;
  }
  applyWithInstallProbe({
    tool: 'goose',
    native: { configPath: filePath },
    posix: { configPath: patch.wslConfigPath ?? patch.configPath },
    baseURL,
    wslTargetsFile,
    write: (paths, url) => applyGooseProviderToFile(paths.configPath, patch, url),
  });
}

function applyGooseProviderToFile(filePath: string, patch: GooseConfigPatchDef, baseURL: string): void {
  backupConfigFile(filePath);
  const raw = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
  let lines = raw.length > 0 ? raw.split('\n') : [];
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
  lines = setYamlTopLevelString(lines, 'GOOSE_PROVIDER', patch.providerKey);
  lines = setYamlTopLevelString(lines, 'GOOSE_MODEL', ROUTED_MODEL_ALIAS);
  lines = setYamlTopLevelString(lines, 'OPENAI_HOST', baseURL);
  lines = setYamlTopLevelString(lines, 'OPENAI_API_KEY', 'torve');
  writeTextFile(filePath, `${lines.join('\n')}\n`);
}

function removeGooseConfigPatch(patch: GooseConfigPatchDef, wslTargetsFile?: string): boolean {
  let changed = removeGooseProviderFromFile(expandTilde(patch.configPath), patch, []);
  if (patch.installProbe === 'goose') {
    // The WSL config carries the gateway address rather than a loopback
    // host, so the recorded host joins the ownership check.
    changed = removeWslInstalls('goose', wslTargetsFile, (target) => removeGooseProviderFromFile(target.configPath, patch, [target.host])) || changed;
  }
  return changed;
}

function removeGooseProviderFromFile(filePath: string, patch: GooseConfigPatchDef, extraHosts: readonly string[]): boolean {
  if (!existsSync(filePath)) return false;
  let lines = readFileSync(filePath, 'utf8').split('\n');
  let changed = false;
  if (isLoopbackHost(readYamlTopLevelString(lines, 'OPENAI_HOST'), extraHosts)) {
    lines = removeYamlTopLevelKey(lines, 'OPENAI_HOST');
    changed = true;
  }
  if (readYamlTopLevelString(lines, 'OPENAI_API_KEY') === 'torve') {
    lines = removeYamlTopLevelKey(lines, 'OPENAI_API_KEY');
    changed = true;
  }
  const model = readYamlTopLevelString(lines, 'GOOSE_MODEL');
  const ownsModel = model === ROUTED_MODEL_ALIAS || (model?.includes('@') ?? false);
  if (readYamlTopLevelString(lines, 'GOOSE_PROVIDER') === patch.providerKey && ownsModel) {
    lines = removeYamlTopLevelKey(lines, 'GOOSE_PROVIDER');
    lines = removeYamlTopLevelKey(lines, 'GOOSE_MODEL');
    changed = true;
  }
  if (!changed) return false;
  backupConfigFile(filePath);
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
  writeTextFile(filePath, lines.length > 0 ? `${lines.join('\n')}\n` : '');
  return true;
}

// --- Hermes Agent (`~/.hermes/config.yaml`) ---

function readHermesConfigDocument(filePath: string): Document.Parsed {
  const document = existsSync(filePath)
    ? parseDocument(readFileSync(filePath, 'utf8'))
    : parseDocument('{}\n');
  if (document.errors.length > 0) {
    throw new Error(`Unable to parse Hermes config: ${document.errors[0]!.message}`);
  }
  return document;
}

function writeHermesConfigDocument(filePath: string, document: Document.Parsed): void {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeTextFileAtomically(filePath, document.toString());
}

function applyHermesConfigPatch(patch: HermesConfigPatchDef, buyerPort: number): void {
  const filePath = expandTilde(patch.configPath);
  const document = readHermesConfigDocument(filePath);
  backupConfigFile(filePath);
  document.setIn(['providers', patch.providerKey], {
    name: 'Torve',
    api: patch.baseURL.replace('{buyerPort}', String(buyerPort)),
    transport: 'chat_completions',
    extra_headers: {
      originator: 'hermes',
    },
    default_model: ROUTED_MODEL_ALIAS,
    models: {
      [ROUTED_MODEL_ALIAS]: {
        context_length: TORVE_MODEL_CONTEXT_WINDOW,
      },
    },
  });
  document.setIn(['model', 'provider'], patch.providerKey);
  document.setIn(['model', 'default'], ROUTED_MODEL_ALIAS);
  document.setIn(['model', 'base_url'], '');
  document.setIn(['model', 'api_mode'], 'chat_completions');
  writeHermesConfigDocument(filePath, document);
}

function removeHermesConfigPatch(patch: HermesConfigPatchDef): boolean {
  const filePath = expandTilde(patch.configPath);
  if (!existsSync(filePath)) return false;
  const document = readHermesConfigDocument(filePath);
  const providerApi = document.getIn(['providers', patch.providerKey, 'api']);
  if (typeof providerApi !== 'string' || !/^https?:\/\/(localhost|127\.0\.0\.1):\d+\/v1\/?$/.test(providerApi)) {
    return false;
  }

  let changed = document.deleteIn(['providers', patch.providerKey]);
  if (document.getIn(['model', 'provider']) === patch.providerKey) {
    changed = document.deleteIn(['model', 'provider']) || changed;
    changed = document.deleteIn(['model', 'default']) || changed;
    changed = document.deleteIn(['model', 'base_url']) || changed;
    changed = document.deleteIn(['model', 'api_mode']) || changed;
  }
  if (!changed) return false;
  backupConfigFile(filePath);
  writeHermesConfigDocument(filePath, document);
  return true;
}

// --- Zed (`~/.config/zed/settings.json`) ---
//
// Zed takes custom endpoints under `language_models.openai_compatible`,
// keyed by provider name; the agent's default model references that name.
// Zed asks for the provider's API key once in its UI — any value satisfies
// the keyless buyer proxy.

function applyZedConfigPatch(patch: ZedConfigPatchDef, buyerPort: number): void {
  const filePath = expandTilde(patch.configPath);
  backupConfigFile(filePath);
  const config = readConfigPatchFile(filePath);
  const languageModels = asObject(config['language_models']);
  const compatible = asObject(languageModels['openai_compatible']);
  compatible[patch.providerName] = {
    api_url: patch.baseURL.replace('{buyerPort}', String(buyerPort)),
    available_models: [
      { name: ROUTED_MODEL_ALIAS, display_name: ROUTED_MODEL_ALIAS_LABEL, max_tokens: TORVE_MODEL_CONTEXT_WINDOW },
    ],
  };
  languageModels['openai_compatible'] = compatible;
  config['language_models'] = languageModels;
  const agent = asObject(config['agent']);
  agent['default_model'] = {
    provider: patch.providerName,
    model: ROUTED_MODEL_ALIAS,
  };
  config['agent'] = agent;
  writeJsonFile(filePath, config);
}

function removeZedConfigPatch(patch: ZedConfigPatchDef): boolean {
  const filePath = expandTilde(patch.configPath);
  const config = tryReadConfigPatchFile(filePath);
  if (!config) return false;
  let changed = false;
  const languageModels = config['language_models'];
  const compatible = languageModels && typeof languageModels === 'object' && !Array.isArray(languageModels)
    ? (languageModels as JsonObject)['openai_compatible']
    : undefined;
  if (compatible && typeof compatible === 'object' && !Array.isArray(compatible) && (patch.providerName in (compatible as JsonObject))) {
    delete (compatible as JsonObject)[patch.providerName];
    if (Object.keys(compatible as JsonObject).length === 0) {
      delete (languageModels as JsonObject)['openai_compatible'];
      if (Object.keys(languageModels as JsonObject).length === 0) delete config['language_models'];
    }
    changed = true;
  }
  const agent = config['agent'];
  if (agent && typeof agent === 'object' && !Array.isArray(agent)) {
    const defaultModel = (agent as JsonObject)['default_model'];
    if (defaultModel && typeof defaultModel === 'object' && (defaultModel as JsonObject)['provider'] === patch.providerName) {
      delete (agent as JsonObject)['default_model'];
      if (Object.keys(agent as JsonObject).length === 0) delete config['agent'];
      changed = true;
    }
  }
  if (!changed) return false;
  backupConfigFile(filePath);
  writeJsonFile(filePath, config);
  return true;
}

// --- Claude Code CLI (`~/.claude/settings.json`) ---
//
// Claude Code reads gateway settings from its user settings `env` block. The
// sidecar records only the env/model values Torve replaces so disconnect
// restores the user's prior state without rolling back unrelated settings.

const CLAUDE_CODE_SOURCE = 'claude-code';
const CLAUDE_CODE_SOURCE_HEADER = `x-torve-system-proxy-source: ${CLAUDE_CODE_SOURCE}`;
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

type ClaudeCodeManagedEnvKey = typeof CLAUDE_CODE_MANAGED_ENV_KEYS[number];

type ClaudeCodeSavedValue = {
  readonly present: boolean;
  readonly value?: unknown;
};

type ClaudeCodePatchState = {
  readonly version: 1;
  readonly configExisted: boolean;
  readonly envPresent: boolean;
  readonly env: Readonly<Record<ClaudeCodeManagedEnvKey, ClaudeCodeSavedValue>>;
  readonly model: ClaudeCodeSavedValue;
  readonly availableModels: ClaudeCodeSavedValue;
};

function claudeCodePatchStatePath(filePath: string): string {
  return `${filePath}.torve.state.json`;
}

function savedValue(source: JsonObject, key: string): ClaudeCodeSavedValue {
  return Object.prototype.hasOwnProperty.call(source, key)
    ? { present: true, value: source[key] }
    : { present: false };
}

function readSavedValue(raw: unknown, statePath: string, key: string): ClaudeCodeSavedValue {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof (raw as JsonObject)['present'] !== 'boolean') {
    throw new Error(`Invalid Torve Claude Code restore value ${key} at ${statePath}`);
  }
  const value = raw as JsonObject;
  return value['present'] ? { present: true, value: value['value'] } : { present: false };
}

function readClaudeCodePatchState(filePath: string): ClaudeCodePatchState | null {
  const statePath = claudeCodePatchStatePath(filePath);
  const state = tryReadConfigPatchFile(statePath);
  if (!state) return null;
  const env = state['env'];
  if (state['version'] !== 1
    || typeof state['configExisted'] !== 'boolean'
    || typeof state['envPresent'] !== 'boolean'
    || !env || typeof env !== 'object' || Array.isArray(env)) {
    throw new Error(`Invalid Torve Claude Code restore state at ${statePath}`);
  }
  const savedEnv = Object.fromEntries(CLAUDE_CODE_MANAGED_ENV_KEYS.map((key) => [
    key,
    readSavedValue((env as JsonObject)[key], statePath, key),
  ])) as Record<ClaudeCodeManagedEnvKey, ClaudeCodeSavedValue>;
  return {
    version: 1,
    configExisted: state['configExisted'],
    envPresent: state['envPresent'],
    env: savedEnv,
    model: readSavedValue(state['model'], statePath, 'model'),
    availableModels: state['availableModels'] ? readSavedValue(state['availableModels'], statePath, 'availableModels') : { present: false },
  };
}

function writeClaudeCodePatchState(filePath: string, state: ClaudeCodePatchState): void {
  writeJsonFile(claudeCodePatchStatePath(filePath), state as unknown as JsonObject);
}

function deleteClaudeCodePatchState(filePath: string): void {
  try {
    unlinkSync(claudeCodePatchStatePath(filePath));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

function claudeCodeEnv(config: JsonObject, filePath: string): JsonObject | undefined {
  const env = config['env'];
  if (env === undefined) return undefined;
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    throw new Error(`Claude Code env at ${filePath} must be an object`);
  }
  return env as JsonObject;
}

function applyClaudeCodeConfigPatch(patch: ClaudeCodeConfigPatchDef, buyerPort: number, wslTargetsFile?: string): void {
  const filePath = expandTilde(patch.configPath);
  const baseURL = patch.baseURL.replace('{buyerPort}', String(buyerPort));
  if (patch.installProbe !== 'claude') {
    applyClaudeCodeSettingsToFile(filePath, patch, baseURL);
    return;
  }
  applyWithInstallProbe({
    tool: 'claude',
    native: { configPath: filePath },
    posix: { configPath: patch.configPath },
    baseURL,
    wslTargetsFile,
    write: (paths, url) => applyClaudeCodeSettingsToFile(paths.configPath, patch, url),
  });
}

function applyClaudeCodeSettingsToFile(filePath: string, patch: ClaudeCodeConfigPatchDef, baseURL: string): void {
  const configExisted = existsSync(filePath);
  backupConfigFile(filePath);
  const config = readConfigPatchFile(filePath);
  const existingEnv = claudeCodeEnv(config, filePath);
  if (!readClaudeCodePatchState(filePath)) {
    const envSource = existingEnv ?? {};
    writeClaudeCodePatchState(filePath, {
      version: 1,
      configExisted,
      envPresent: existingEnv !== undefined,
      env: Object.fromEntries(CLAUDE_CODE_MANAGED_ENV_KEYS.map((key) => [key, savedValue(envSource, key)])) as Record<ClaudeCodeManagedEnvKey, ClaudeCodeSavedValue>,
      model: savedValue(config, 'model'),
      availableModels: savedValue(config, 'availableModels'),
    });
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
  config['availableModels'] = [...new Set([...native, ROUTED_MODEL_ALIAS, ...(patch.models ?? []).map((model) => model.id)])];
  writeJsonFile(filePath, config);
}

function removeClaudeCodeConfigPatch(patch: ClaudeCodeConfigPatchDef, wslTargetsFile?: string): boolean {
  let changed = removeClaudeCodeSettingsFromFile(expandTilde(patch.configPath));
  if (patch.installProbe === 'claude') {
    changed = removeWslInstalls('claude', wslTargetsFile, (target) => (
      removeClaudeCodeSettingsFromFile(target.configPath, [target.host])
    )) || changed;
  }
  return changed;
}

function restoreSavedValue(target: JsonObject, key: string, saved: ClaudeCodeSavedValue): void {
  if (saved.present) target[key] = saved.value;
  else delete target[key];
}

function removeClaudeCodeSettingsFromFile(
  filePath: string,
  extraHosts: readonly string[] = [],
): boolean {
  const state = readClaudeCodePatchState(filePath);
  if (!state) return false;
  const config = tryReadConfigPatchFile(filePath);
  if (!config) {
    deleteClaudeCodePatchState(filePath);
    return true;
  }
  backupConfigFile(filePath);

  let changed = false;
  const env = claudeCodeEnv(config, filePath);
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
      const managed = key === 'ANTHROPIC_BASE_URL'
        ? typeof value === 'string' && isLoopbackHost(value, extraHosts)
        : value === managedValues[key];
      if (!managed) continue;
      restoreSavedValue(env, key, state.env[key]);
      changed = true;
    }
    if (!state.envPresent && Object.keys(env).length === 0) delete config['env'];
  }
  if (config['model'] === ROUTED_MODEL_ALIAS) {
    restoreSavedValue(config, 'model', state.model);
    changed = true;
  }
  if (Array.isArray(config['availableModels']) && config['availableModels'].includes(ROUTED_MODEL_ALIAS)) {
    restoreSavedValue(config, 'availableModels', state.availableModels);
    changed = true;
  }

  if (!state.configExisted && Object.keys(config).length === 0) {
    unlinkSync(filePath);
  } else if (changed) {
    writeJsonFile(filePath, config);
  }
  deleteClaudeCodePatchState(filePath);
  return changed;
}

function applyT3CodeConfigPatch(patch: T3CodeConfigPatchDef, buyerPort: number): void {
  const filePath = expandTilde(patch.configPath);
  backupConfigFile(filePath);
  const config = readConfigPatchFile(filePath);
  const providerInstances = asObject(config['providerInstances']);
  const customModels = [ROUTED_MODEL_ALIAS];
  providerInstances[patch.providerKey] = {
    driver: 'claudeAgent',
    displayName: patch.providerName,
    environment: [
      { name: 'ANTHROPIC_BASE_URL', value: patch.baseURL.replace('{buyerPort}', String(buyerPort)), sensitive: false },
      { name: 'ANTHROPIC_API_KEY', value: 'torve', sensitive: false },
      { name: 'ANTHROPIC_CUSTOM_HEADERS', value: 'x-torve-system-proxy-source: t3code', sensitive: false },
      { name: 'HTTP_PROXY', value: '', sensitive: false },
      { name: 'HTTPS_PROXY', value: '', sensitive: false },
      { name: 'http_proxy', value: '', sensitive: false },
      { name: 'https_proxy', value: '', sensitive: false },
      { name: 'NO_PROXY', value: 'localhost,127.0.0.1,::1', sensitive: false },
      { name: 'no_proxy', value: 'localhost,127.0.0.1,::1', sensitive: false },
      { name: 'NODE_OPTIONS', value: '', sensitive: false },
    ],
    enabled: true,
    config: { customModels },
  };
  config['providerInstances'] = providerInstances;
  writeJsonFile(filePath, config);
}

function removeT3CodeConfigPatch(patch: T3CodeConfigPatchDef): boolean {
  const filePath = expandTilde(patch.configPath);
  const config = tryReadConfigPatchFile(filePath);
  if (!config) return false;
  const providerInstances = config['providerInstances'];
  if (!providerInstances || typeof providerInstances !== 'object' || Array.isArray(providerInstances)) return false;
  const instance = (providerInstances as JsonObject)[patch.providerKey];
  if (!instance || typeof instance !== 'object' || Array.isArray(instance)) return false;
  const environment = (instance as JsonObject)['environment'];
  const ownsInstance = Array.isArray(environment) && environment.some((variable) => {
    if (!variable || typeof variable !== 'object' || Array.isArray(variable)) return false;
    const value = (variable as JsonObject)['value'];
    return (variable as JsonObject)['name'] === 'ANTHROPIC_BASE_URL'
      && isLoopbackHost(typeof value === 'string' ? value : undefined);
  });
  if (!ownsInstance) return false;
  delete (providerInstances as JsonObject)[patch.providerKey];
  if (Object.keys(providerInstances as JsonObject).length === 0) delete config['providerInstances'];
  backupConfigFile(filePath);
  writeJsonFile(filePath, config);
  return true;
}

function applyGeminiCliConfigPatch(patch: GeminiConfigPatchDef, buyerPort: number): void {
  const configPath = expandTilde(patch.configPath);
  const envPath = expandTilde(patch.envPath);
  backupConfigFile(configPath);
  backupConfigFile(envPath);
  const config = readConfigPatchFile(configPath);
  const security = asObject(config['security']);
  const auth = asObject(security['auth']);
  auth['selectedType'] = 'gemini-api-key';
  security['auth'] = auth;
  config['security'] = security;
  writeJsonFile(configPath, config);
  writeManagedEnv(envPath, {
    GOOGLE_GEMINI_BASE_URL: patch.baseURL.replace('{buyerPort}', String(buyerPort)),
    GEMINI_API_KEY: 'torve-local-proxy',
    GEMINI_MODEL: patch.model ?? ROUTED_MODEL_ALIAS,
  });
}

function applyAiderConfigPatch(patch: AiderConfigPatchDef, buyerPort: number): void {
  const filePath = expandTilde(patch.configPath);
  backupConfigFile(filePath);
  const document = existsSync(filePath) ? parseDocument(readFileSync(filePath, 'utf8')) : new Document({});
  if (document.errors.length > 0) throw new Error(`Unable to parse Aider YAML config at ${filePath}`);
  document.set('openai-api-base', patch.baseURL.replace('{buyerPort}', String(buyerPort)));
  document.set('openai-api-key', 'torve-local-proxy');
  document.set('model', `openai/${ROUTED_MODEL_ALIAS}`);
  writeTextFileAtomically(filePath, document.toString());
}

function removeAiderConfigPatch(patch: AiderConfigPatchDef): boolean {
  const filePath = expandTilde(patch.configPath);
  if (!existsSync(filePath)) return false;
  const document = parseDocument(readFileSync(filePath, 'utf8'));
  const base = document.get('openai-api-base');
  if (typeof base !== 'string' || !isLoopbackHost(base)) return false;
  for (const key of ['openai-api-base', 'openai-api-key', 'model']) document.delete(key);
  writeTextFileAtomically(filePath, document.toString());
  return true;
}

function continuePath(patch: ContinueConfigPatchDef): string {
  const yamlPath = expandTilde(patch.configPath);
  const legacy = patch.legacyConfigPath ? expandTilde(patch.legacyConfigPath) : null;
  return !existsSync(yamlPath) && legacy && existsSync(legacy) ? legacy : yamlPath;
}

function applyContinueConfigPatch(patch: ContinueConfigPatchDef, buyerPort: number): void {
  const filePath = continuePath(patch);
  backupConfigFile(filePath);
  const base = patch.baseURL.replace('{buyerPort}', String(buyerPort));
  const entries = [{ name: 'Torve · Auto', provider: 'openai', model: ROUTED_MODEL_ALIAS, apiBase: base, apiKey: 'torve-local-proxy' },
    ...(patch.models ?? []).filter((model) => model.id !== 'auto' && model.id !== ROUTED_MODEL_ALIAS).map((model) => ({ name: `Torve · ${model.name}`, provider: 'openai', model: model.id, apiBase: base, apiKey: 'torve-local-proxy' }))];
  const isTorve = (item: unknown) => Boolean(item && typeof item === 'object' && !Array.isArray(item)
    && typeof (item as JsonObject)['name'] === 'string' && ((item as JsonObject)['name'] as string).startsWith('Torve · '));
  if (filePath.endsWith('.json')) {
    const config = readConfigPatchFile(filePath);
    const models = Array.isArray(config['models']) ? config['models'].filter((item) => !isTorve(item)) : [];
    config['models'] = [...models, ...entries];
    writeJsonFile(filePath, config);
    return;
  }
  const document = existsSync(filePath) ? parseDocument(readFileSync(filePath, 'utf8')) : new Document({});
  if (document.errors.length > 0) throw new Error(`Unable to parse Continue YAML config at ${filePath}`);
  const config = (document.toJS() ?? {}) as JsonObject;
  const models = Array.isArray(config['models']) ? config['models'].filter((item) => !isTorve(item)) : [];
  config['models'] = [...models, ...entries];
  writeTextFileAtomically(filePath, new Document(config).toString());
}

function removeContinueConfigPatch(patch: ContinueConfigPatchDef): boolean {
  const filePath = continuePath(patch);
  if (!existsSync(filePath)) return false;
  if (filePath.endsWith('.json')) {
    const config = tryReadConfigPatchFile(filePath); if (!config) return false;
    const models = Array.isArray(config['models']) ? config['models'] : [];
    const filtered = models.filter((item) => !(item && typeof item === 'object' && typeof (item as JsonObject)['name'] === 'string' && ((item as JsonObject)['name'] as string).startsWith('Torve · ')));
    if (filtered.length === models.length) return false;
    config['models'] = filtered; writeJsonFile(filePath, config); return true;
  }
  const document = parseDocument(readFileSync(filePath, 'utf8'));
  const config = (document.toJS() ?? {}) as JsonObject;
  const models = Array.isArray(config['models']) ? config['models'] : [];
  const filtered = models.filter((item) => !(item && typeof item === 'object' && typeof (item as JsonObject)['name'] === 'string' && ((item as JsonObject)['name'] as string).startsWith('Torve · ')));
  if (filtered.length === models.length) return false;
  config['models'] = filtered; writeTextFileAtomically(filePath, new Document(config).toString()); return true;
}

function applyAntigravityPatch(patch: AntigravityConfigPatchDef, buyerPort: number): void {
  const baseURL = patch.baseURL.replace('{buyerPort}', String(buyerPort));
  const settingsPath = expandTilde(patch.configPath);
  const settings = readConfigPatchFile(settingsPath);
  settings['jetski.cloudCodeUrl'] = baseURL;
  writeJsonFile(settingsPath, settings);

  if (!patch.mcpFallback || !patch.mcpConfigPath || !patch.serverPath) return;
  const configPath = expandTilde(patch.mcpConfigPath);
  const serverPath = expandTilde(patch.serverPath);
  const script = `import readline from 'node:readline';\nconst base=${JSON.stringify(baseURL)};\nconst send=(x)=>process.stdout.write(JSON.stringify(x)+'\\n');\nconst rl=readline.createInterface({input:process.stdin});\nrl.on('line',async(line)=>{let r;try{r=JSON.parse(line)}catch{return}const out={jsonrpc:'2.0',id:r.id};try{if(r.method==='initialize')send({...out,result:{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'torve-local',version:'1.0.0'}}});else if(r.method==='notifications/initialized'){}else if(r.method==='tools/list')send({...out,result:{tools:[{name:'torve_list_models',description:'List models available from the connected Torve Cloud account. Use before torve_chat when the user asks for a Torve model.',inputSchema:{type:'object',properties:{}}},{name:'torve_chat',description:'Send a prompt through Direct Torve Cloud. Use when the user asks to use Torve or a Torve Cloud model.',inputSchema:{type:'object',properties:{prompt:{type:'string'},model:{type:'string'}},required:['prompt']}}]}});else if(r.method==='tools/call'){const a=r.params?.arguments||{};if(r.params?.name==='torve_list_models'){const j=await fetch(base+'/v1/models',{headers:{authorization:'Bearer torve-local-proxy'}}).then(x=>x.json());send({...out,result:{content:[{type:'text',text:JSON.stringify(j.data||j)}]}})}else{const j=await fetch(base+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer torve-local-proxy'},body:JSON.stringify({model:a.model||'torve',messages:[{role:'user',content:a.prompt}]})}).then(x=>x.json());send({...out,result:{content:[{type:'text',text:j.choices?.[0]?.message?.content||JSON.stringify(j)}]}})}}else send({...out,error:{code:-32601,message:'Method not found'}})}catch(e){send({...out,error:{code:-32000,message:String(e?.message||e)}})}});\n`;
  writeTextFileAtomically(serverPath, script);
  const config = readConfigPatchFile(configPath);
  const servers = asObject(config['mcpServers']);
  servers['torve'] = { command: process.execPath, args: [serverPath], env: { ELECTRON_RUN_AS_NODE: '1' } };
  config['mcpServers'] = servers;
  writeJsonFile(configPath, config);
}

function removeAntigravityPatch(patch: AntigravityConfigPatchDef): boolean {
  let changed = false;
  const settingsPath = expandTilde(patch.configPath);
  const settings = tryReadConfigPatchFile(settingsPath);
  if (settings && typeof settings['jetski.cloudCodeUrl'] === 'string') {
    delete settings['jetski.cloudCodeUrl'];
    writeJsonFile(settingsPath, settings);
    changed = true;
  }
  if (!patch.mcpFallback || !patch.mcpConfigPath || !patch.serverPath) return changed;
  const configPath = expandTilde(patch.mcpConfigPath);
  const config = tryReadConfigPatchFile(configPath);
  if (config) {
    const servers = asObject(config['mcpServers']);
    if (servers['torve']) { delete servers['torve']; changed = true; }
    if (Object.keys(servers).length === 0) delete config['mcpServers']; else config['mcpServers'] = servers;
    if (changed) writeJsonFile(configPath, config);
  }
  const serverPath = expandTilde(patch.serverPath);
  if (existsSync(serverPath)) { unlinkSync(serverPath); changed = true; }
  return changed;
}

function removeGeminiCliConfigPatch(patch: GeminiConfigPatchDef): boolean {
  const configPath = expandTilde(patch.configPath);
  const envPath = expandTilde(patch.envPath);
  const config = tryReadConfigPatchFile(configPath);
  let changed = false;
  if (config) {
    const security = asObject(config['security']);
    const auth = asObject(security['auth']);
    if (auth['selectedType'] === 'gemini-api-key') {
      delete auth['selectedType'];
      if (Object.keys(auth).length === 0) delete security['auth']; else security['auth'] = auth;
      if (Object.keys(security).length === 0) delete config['security']; else config['security'] = security;
      writeJsonFile(configPath, config);
      changed = true;
    }
  }
  return removeManagedEnv(envPath, ['GOOGLE_GEMINI_BASE_URL', 'GEMINI_API_KEY', 'GEMINI_MODEL']) || changed;
}

function writeManagedEnv(filePath: string, values: Readonly<Record<string, string>>): void {
  const existing = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
  const keys = new Set(Object.keys(values));
  const lines = existing.split(/\r?\n/).filter((line) => {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    return !match || !keys.has(match[1]!);
  });
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  for (const [key, value] of Object.entries(values)) lines.push(`${key}=${value}`);
  writeTextFileAtomically(filePath, `${lines.join('\n')}\n`);
}

function removeManagedEnv(filePath: string, keysToRemove: readonly string[]): boolean {
  if (!existsSync(filePath)) return false;
  const keys = new Set(keysToRemove);
  const existing = readFileSync(filePath, 'utf8');
  let changed = false;
  const lines = existing.split(/\r?\n/).filter((line) => {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (match && keys.has(match[1]!)) { changed = true; return false; }
    return true;
  });
  if (changed) writeTextFileAtomically(filePath, lines.join('\n').replace(/\n*$/, '\n'));
  return changed;
}

/** One Claude Desktop install location: the normal-profile config plus the
    third-party profile directory next to it. */
export type ClaudeDesktopPatchTarget = {
  readonly configPath: string;
  readonly thirdPartyDir: string;
};

function claudeDesktopSafeListDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Candidate install locations for Claude Desktop, most likely first. macOS
 * has a single documented location (the profile's own paths). Windows varies
 * by installer: `%APPDATA%\Claude` for the classic installer, the MSIX
 * package's virtualized `LocalCache\Roaming\Claude` for Store/winget
 * installs, plus the `%LOCALAPPDATA%` and "Claude Nest" variants Ollama's
 * integration probes. Apply writes the first candidate that exists; remove
 * unwinds every candidate this patch owns. The third-party profile directory
 * is always the sibling `<root>-3p`, mirroring Claude's own 1p/3p layout.
 */
export function claudeDesktopPatchTargets(
  patch: ClaudeDesktopConfigPatchDef,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  listDir: (dir: string) => string[] = claudeDesktopSafeListDir,
): ClaudeDesktopPatchTarget[] {
  if (platform !== 'win32') {
    return [{ configPath: expandTilde(patch.configPath), thirdPartyDir: expandTilde(patch.thirdPartyDir) }];
  }
  const roaming = env['APPDATA'] || path.join(homedir(), 'AppData', 'Roaming');
  const local = env['LOCALAPPDATA'] || path.join(homedir(), 'AppData', 'Local');
  const packagesDir = path.join(local, 'Packages');
  const msixRoots = listDir(packagesDir)
    .filter((name) => name.startsWith('Claude_'))
    .map((name) => path.join(packagesDir, name, 'LocalCache', 'Roaming', 'Claude'));
  const roots = [
    path.join(roaming, 'Claude'),
    ...msixRoots,
    path.join(local, 'Claude'),
    path.join(roaming, 'Claude Nest'),
    path.join(local, 'Claude Nest'),
  ];
  const seen = new Set<string>();
  const targets: ClaudeDesktopPatchTarget[] = [];
  for (const root of roots) {
    const key = root.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({
      configPath: path.join(root, 'claude_desktop_config.json'),
      thirdPartyDir: `${root}-3p`,
    });
  }
  return targets;
}

type ClaudeDesktopPatchPaths = {
  readonly desktopConfig: string;
  readonly meta: string;
  readonly profile: string;
};

function claudeDesktopPatchPaths(target: ClaudeDesktopPatchTarget): ClaudeDesktopPatchPaths {
  return {
    desktopConfig: path.join(target.thirdPartyDir, 'claude_desktop_config.json'),
    meta: path.join(target.thirdPartyDir, 'configLibrary', '_meta.json'),
    profile: path.join(target.thirdPartyDir, 'configLibrary', `${CLAUDE_DESKTOP_PROFILE_ID}.json`),
  };
}

function claudeDesktopMetaEntries(meta: JsonObject): unknown[] {
  return Array.isArray(meta['entries']) ? meta['entries'] : [];
}

function isOwnClaudeDesktopMetaEntry(entry: unknown): boolean {
  return !!entry && typeof entry === 'object' && !Array.isArray(entry)
    && (entry as JsonObject)['id'] === CLAUDE_DESKTOP_PROFILE_ID;
}

export function matchingClaudeDesktopTargets(
  patch: ClaudeDesktopConfigPatchDef,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  listDir: (dir: string) => string[] = claudeDesktopSafeListDir,
  exists: (filePath: string) => boolean = existsSync,
): ClaudeDesktopPatchTarget[] {
  const explicitTarget = platform === 'win32' && path.isAbsolute(patch.configPath) && path.isAbsolute(patch.thirdPartyDir);
  const targets = explicitTarget
    ? [{ configPath: patch.configPath, thirdPartyDir: patch.thirdPartyDir }]
    : claudeDesktopPatchTargets(patch, platform, env, listDir);
  const matched = targets.filter(
    (candidate) => exists(path.dirname(candidate.configPath)) || exists(candidate.thirdPartyDir),
  );
  if (matched.length === 0 || explicitTarget || platform !== 'win32') return matched;

  // Modern Windows Claude Desktop (6.x+) always reads 3p mode & configLibrary
  // from %LOCALAPPDATA%\Claude-3p even when its 1p userData sits in
  // %APPDATA%\Claude or an MSIX LocalCache directory. Ensure that target is
  // included whenever any non-Nest Claude Desktop installation is detected.
  const local = env['LOCALAPPDATA'] || path.join(homedir(), 'AppData', 'Local');
  const localClaudeRoot = path.join(local, 'Claude');
  const hasPrimaryClaude = matched.some((candidate) => !path.dirname(candidate.configPath).endsWith('Claude Nest'));
  const hasLocalClaude = matched.some(
    (candidate) => path.dirname(candidate.configPath).toLowerCase() === localClaudeRoot.toLowerCase(),
  );
  if (hasPrimaryClaude && !hasLocalClaude) {
    matched.push({
      configPath: path.join(localClaudeRoot, 'claude_desktop_config.json'),
      thirdPartyDir: `${localClaudeRoot}-3p`,
    });
  }
  return matched;
}

function applyClaudeDesktopTarget(target: ClaudeDesktopPatchTarget, gatewayBaseUrl: string): void {
  const normalConfigPath = target.configPath;
  const paths = claudeDesktopPatchPaths(target);

  // Claude reads deploymentMode from the normal profile (or %LOCALAPPDATA%\Claude-3p
  // on modern Windows builds) at startup and, when it says '3p', boots against
  // the third-party profile directory instead — existing settings/MCP stay intact.
  backupConfigFile(normalConfigPath);
  const normalConfig = readConfigPatchFile(normalConfigPath);
  normalConfig['deploymentMode'] = '3p';
  writeJsonFile(normalConfigPath, normalConfig);

  const desktopConfig = readConfigPatchFile(paths.desktopConfig);
  desktopConfig['deploymentMode'] = '3p';
  writeJsonFile(paths.desktopConfig, desktopConfig);

  const profile = readConfigPatchFile(paths.profile);
  profile['inferenceProvider'] = 'gateway';
  profile['inferenceGatewayBaseUrl'] = gatewayBaseUrl;
  // The gateway is loopback-only and ignores credentials; Claude just needs a
  // non-empty key for its gateway auth scheme.
  profile['inferenceGatewayApiKey'] = 'torve';
  profile['inferenceGatewayAuthScheme'] = 'bearer';
  profile['deploymentDisplayName'] = CLAUDE_DESKTOP_PROFILE_NAME;
  profile['chatTabEnabled'] = true;
  profile['disableDeploymentModeChooser'] = true;
  // Cowork needs unrestricted egress for user-configured plugins/MCP servers.
  profile['coworkEgressAllowedHosts'] = ['*'];
  profile['disableEssentialTelemetry'] = true;
  profile['disableNonessentialTelemetry'] = true;
  // Model discovery comes from the gateway's /v1/models — a pinned list here
  // would shadow it.
  delete profile['inferenceModels'];
  // Claude's published model catalog (fetched from downloads.claude.ai on 3p
  // boots) relabels picker entries by id, so "Torve Auto" behind
  // claude-fable-5 would show as "Fable 5" and every curated slot as the
  // Claude model whose id it borrows. The gateway's display names are the
  // real labels; keep the catalog off so they win.
  profile['modelCatalogEnabled'] = false;
  writeJsonFile(paths.profile, profile);

  const meta = readConfigPatchFile(paths.meta);
  meta['appliedId'] = CLAUDE_DESKTOP_PROFILE_ID;
  meta['entries'] = [
    ...claudeDesktopMetaEntries(meta).filter((entry) => !isOwnClaudeDesktopMetaEntry(entry)),
    { id: CLAUDE_DESKTOP_PROFILE_ID, name: CLAUDE_DESKTOP_PROFILE_NAME },
  ];
  writeJsonFile(paths.meta, meta);
}

function applyClaudeDesktopConfigPatch(patch: ClaudeDesktopConfigPatchDef): void {
  const matched = matchingClaudeDesktopTargets(patch);
  if (matched.length === 0) {
    const candidates = claudeDesktopPatchTargets(patch);
    throw new Error(
      'Claude Desktop was not found on this machine — nothing to connect. '
      + `Looked for ${candidates.map((candidate) => path.dirname(candidate.configPath)).join(', ')}. `
      + 'Install Claude Desktop (or run it once), then reconnect.',
    );
  }
  const gatewayBaseUrl = patch.baseURL.replace('{claudeGatewayPort}', String(CLAUDE_GATEWAY_DEFAULT_PORT));
  for (const target of matched) {
    applyClaudeDesktopTarget(target, gatewayBaseUrl);
  }
}

function removeClaudeDesktopConfigPatch(patch: ClaudeDesktopConfigPatchDef): boolean {
  // Every candidate root is checked: the install this patch configured may
  // not be the first candidate anymore (e.g. an MSIX Claude installed since).
  let changed = false;
  const targets = process.platform === 'win32' && path.isAbsolute(patch.configPath) && path.isAbsolute(patch.thirdPartyDir)
    ? [{ configPath: patch.configPath, thirdPartyDir: patch.thirdPartyDir }]
    : claudeDesktopPatchTargets(patch);
  for (const target of targets) {
    if (removeClaudeDesktopTarget(target)) changed = true;
  }
  return changed;
}

function removeClaudeDesktopTarget(target: ClaudeDesktopPatchTarget): boolean {
  const paths = claudeDesktopPatchPaths(target);
  const meta = tryReadConfigPatchFile(paths.meta);
  const profile = tryReadConfigPatchFile(paths.profile);
  // Only unwind a third-party setup this patch created: our profile file
  // pointing at a loopback gateway, or the configLibrary applying our entry.
  // An enterprise/MDM-provisioned 3p profile must keep its deployment mode.
  const gatewayUrl = profile && typeof profile['inferenceGatewayBaseUrl'] === 'string'
    ? profile['inferenceGatewayBaseUrl']
    : undefined;
  const ownsProfileFile = profile?.['inferenceProvider'] === 'gateway' && isLoopbackHost(gatewayUrl);
  const ownsSetup = ownsProfileFile
    || meta?.['appliedId'] === CLAUDE_DESKTOP_PROFILE_ID
    || claudeDesktopMetaEntries(meta ?? {}).some(isOwnClaudeDesktopMetaEntry);
  if (!ownsSetup) return false;

  let changed = false;
  for (const configPath of [target.configPath, paths.desktopConfig]) {
    const config = tryReadConfigPatchFile(configPath);
    if (config && config['deploymentMode'] === '3p') {
      config['deploymentMode'] = '1p';
      writeJsonFile(configPath, config);
      changed = true;
    }
  }
  if (meta) {
    let metaChanged = false;
    if (meta['appliedId'] === CLAUDE_DESKTOP_PROFILE_ID) {
      delete meta['appliedId'];
      metaChanged = true;
    }
    const entries = claudeDesktopMetaEntries(meta);
    const filtered = entries.filter((entry) => !isOwnClaudeDesktopMetaEntry(entry));
    if (filtered.length !== entries.length) {
      meta['entries'] = filtered;
      metaChanged = true;
    }
    if (metaChanged) {
      writeJsonFile(paths.meta, meta);
      changed = true;
    }
  }
  if (profile && ownsProfileFile) {
    for (const key of [
      'inferenceProvider',
      'inferenceGatewayBaseUrl',
      'inferenceGatewayApiKey',
      'inferenceGatewayAuthScheme',
      'deploymentDisplayName',
      'coworkEgressAllowedHosts',
      'disableEssentialTelemetry',
      'disableNonessentialTelemetry',
      'inferenceModels',
    ]) {
      delete profile[key];
    }
    profile['disableDeploymentModeChooser'] = false;
    writeJsonFile(paths.profile, profile);
    changed = true;
  }
  return changed;
}
