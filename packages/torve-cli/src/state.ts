import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { AuthMode, CliConfig, ProxyPidInfo, TorveKeyMeta, TorveUserMeta } from './types.js';

export const DEFAULT_PROXY_PORT = 8378;
export const DEFAULT_CLAUDE_GATEWAY_PORT = 8380;

export function getHomeDir(): string {
  return process.env['TORVE_TEST_HOME']?.trim() || homedir();
}

export function getTorveDir(): string {
  return process.env['TORVE_HOME']?.trim() || path.join(getHomeDir(), '.torve');
}

export function expandHomePath(filePath: string): string {
  const home = getHomeDir();
  if (filePath === '~') return home;
  if (filePath.startsWith('~/')) return path.join(home, filePath.slice(2));
  return filePath;
}

export function cliConfigPath(): string {
  return path.join(getTorveDir(), 'config.json');
}

export function proxyPidPath(): string {
  return path.join(getTorveDir(), 'proxy.pid');
}

export function proxyLogPath(): string {
  return path.join(getTorveDir(), 'proxy.log');
}

export function modelsCachePath(): string {
  return path.join(getTorveDir(), 'models-cache.json');
}

export function legacyModelsCachePath(): string {
  return path.join(getTorveDir(), 'desktop-models.json');
}

export function desktopEncryptedCredentialsPath(): string {
  return path.join(getTorveDir(), 'desktop-credentials.enc');
}

export function desktopLegacyCredentialsPath(): string {
  return path.join(getTorveDir(), 'desktop-credentials.json');
}

export function directCloudProfilesPath(): string {
  return path.join(getTorveDir(), 'direct-cloud-profiles.json');
}

export function directCloudOverridesPath(): string {
  return path.join(getTorveDir(), 'direct-cloud-overrides.json');
}

export function codexCatalogPath(): string {
  return path.join(getTorveDir(), 'codex-model-catalog.json');
}

export function codexModelsCachePath(): string {
  return path.join(getHomeDir(), '.codex', 'models_cache.json');
}

export function usageStatsPath(): string {
  return path.join(getTorveDir(), 'usage-stats.json');
}

export function backupsRootDir(): string {
  return path.join(getTorveDir(), 'backups');
}

export async function writeFileAtomic(filePath: string, content: string | Buffer, mode = 0o600): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, content, { mode });
  await rename(temp, filePath);
}

export async function writeJsonAtomic(filePath: string, data: unknown, mode = 0o600): Promise<void> {
  await writeFileAtomic(filePath, `${JSON.stringify(data, null, 2)}\n`, mode);
}

export async function readJsonFile<T = Record<string, unknown>>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function removeFileIfExists(filePath: string): Promise<boolean> {
  if (!existsSync(filePath)) return false;
  try {
    await unlink(filePath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return false;
    throw err;
  }
}

export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  return trimmed.length < 12 ? '••••••••' : `${trimmed.slice(0, 8)}…${trimmed.slice(-4)}`;
}

export async function readCliConfig(): Promise<CliConfig> {
  const raw = await readJsonFile<Partial<CliConfig>>(cliConfigPath());
  if (!raw || typeof raw !== 'object') return { version: 1 };
  return {
    version: 1,
    ...(typeof raw.apiKey === 'string' && raw.apiKey.trim() ? { apiKey: raw.apiKey.trim() } : {}),
    ...(raw.authMode === 'oauth' || raw.authMode === 'manual' ? { authMode: raw.authMode } : {}),
    ...(raw.email !== undefined ? { email: raw.email } : {}),
    ...(raw.keyMeta !== undefined ? { keyMeta: raw.keyMeta } : {}),
    ...(raw.userMeta !== undefined ? { userMeta: raw.userMeta } : {}),
    ...(typeof raw.port === 'number' && Number.isFinite(raw.port) ? { port: raw.port } : {}),
    ...(typeof raw.webBaseUrl === 'string' ? { webBaseUrl: raw.webBaseUrl } : {}),
    ...(typeof raw.apiBaseUrl === 'string' ? { apiBaseUrl: raw.apiBaseUrl } : {}),
    ...(typeof raw.updatedAt === 'number' ? { updatedAt: raw.updatedAt } : {}),
  };
}

export async function writeCliConfig(config: CliConfig): Promise<void> {
  await writeJsonAtomic(cliConfigPath(), {
    ...config,
    version: 1,
    updatedAt: Date.now(),
  });
}

export async function saveCliCredentials(input: {
  apiKey: string;
  authMode: AuthMode;
  email?: string | null;
  keyMeta?: TorveKeyMeta | null;
  userMeta?: TorveUserMeta | null;
}): Promise<CliConfig> {
  const existing = await readCliConfig();
  const next: CliConfig = {
    ...existing,
    version: 1,
    apiKey: input.apiKey.trim(),
    authMode: input.authMode,
    email: input.email ?? input.userMeta?.email ?? null,
    keyMeta: input.keyMeta ?? null,
    userMeta: input.userMeta ?? null,
    updatedAt: Date.now(),
  };
  await writeCliConfig(next);
  return next;
}

export async function clearCliCredentials(): Promise<boolean> {
  const existing = await readCliConfig();
  const hadKey = Boolean(existing.apiKey);
  if (!existsSync(cliConfigPath())) return false;

  const rest: Record<string, unknown> = { ...existing };
  delete rest['apiKey'];
  delete rest['authMode'];
  delete rest['email'];
  delete rest['keyMeta'];
  delete rest['userMeta'];
  delete rest['updatedAt'];

  // Keep user preferences (port/baseUrl) if present; remove file if empty.
  const remainingKeys = Object.keys(rest).filter((k) => k !== 'version');
  if (remainingKeys.length === 0) {
    await removeFileIfExists(cliConfigPath());
  } else {
    await writeJsonAtomic(cliConfigPath(), { version: 1, ...rest });
  }
  return hadKey;
}

export interface ResolvedCredentials {
  apiKey: string;
  source: 'flag' | 'env' | 'cli-config' | 'desktop-legacy';
  authMode: AuthMode;
  email: string | null;
  keyMeta: TorveKeyMeta | null;
  userMeta: TorveUserMeta | null;
}

export async function resolveCredentials(tokenOverride?: string): Promise<ResolvedCredentials | null> {
  if (tokenOverride && tokenOverride.trim()) {
    return {
      apiKey: tokenOverride.trim(),
      source: 'flag',
      authMode: 'manual',
      email: null,
      keyMeta: null,
      userMeta: null,
    };
  }

  const envKey = process.env['TORVE_CLOUD_API_KEY']?.trim();
  if (envKey) {
    return {
      apiKey: envKey,
      source: 'env',
      authMode: 'manual',
      email: null,
      keyMeta: null,
      userMeta: null,
    };
  }

  const cli = await readCliConfig();
  if (cli.apiKey) {
    return {
      apiKey: cli.apiKey,
      source: 'cli-config',
      authMode: cli.authMode ?? 'manual',
      email: cli.email ?? cli.userMeta?.email ?? null,
      keyMeta: cli.keyMeta ?? null,
      userMeta: cli.userMeta ?? null,
    };
  }

  const legacy = await readJsonFile<{
    apiKey?: string;
    authMode?: AuthMode;
    email?: string | null;
    keyMeta?: TorveKeyMeta | null;
    userMeta?: TorveUserMeta | null;
  }>(desktopLegacyCredentialsPath());
  if (legacy && typeof legacy.apiKey === 'string' && legacy.apiKey.trim()) {
    return {
      apiKey: legacy.apiKey.trim(),
      source: 'desktop-legacy',
      authMode: legacy.authMode === 'oauth' ? 'oauth' : 'manual',
      email: legacy.email ?? legacy.userMeta?.email ?? null,
      keyMeta: legacy.keyMeta ?? null,
      userMeta: legacy.userMeta ?? null,
    };
  }

  return null;
}

export function hasDesktopEncryptedCredentials(): boolean {
  return existsSync(desktopEncryptedCredentialsPath());
}

export async function clearAllSharedTorveState(): Promise<string[]> {
  const cleared: string[] = [];
  const candidates = [
    cliConfigPath(),
    desktopLegacyCredentialsPath(),
    desktopEncryptedCredentialsPath(),
    modelsCachePath(),
    legacyModelsCachePath(),
    directCloudProfilesPath(),
    directCloudOverridesPath(),
    codexCatalogPath(),
    usageStatsPath(),
    proxyPidPath(),
  ];
  for (const filePath of candidates) {
    if (await removeFileIfExists(filePath)) {
      cleared.push(filePath);
    }
  }
  const mcpDir = path.join(getTorveDir(), 'mcp');
  if (existsSync(mcpDir)) {
    await rm(mcpDir, { recursive: true, force: true });
    cleared.push(mcpDir);
  }
  return cleared;
}

export async function readProxyPid(): Promise<ProxyPidInfo | null> {
  try {
    const raw = await readFile(proxyPidPath(), 'utf8');
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) {
      return {
        pid: Number(trimmed),
        port: DEFAULT_PROXY_PORT,
        startedAt: 0,
        upstream: '',
      };
    }
    const parsed = JSON.parse(trimmed) as Partial<ProxyPidInfo>;
    if (typeof parsed.pid !== 'number' || !Number.isFinite(parsed.pid) || parsed.pid <= 0) return null;
    return {
      pid: parsed.pid,
      port: typeof parsed.port === 'number' && Number.isFinite(parsed.port) ? parsed.port : DEFAULT_PROXY_PORT,
      startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : 0,
      upstream: typeof parsed.upstream === 'string' ? parsed.upstream : '',
    };
  } catch {
    return null;
  }
}

export async function writeProxyPid(info: ProxyPidInfo): Promise<void> {
  await writeJsonAtomic(proxyPidPath(), info);
}

export async function removeProxyPid(): Promise<void> {
  await removeFileIfExists(proxyPidPath());
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code === 'EPERM';
  }
}

export async function readActiveProfilesState(): Promise<{ version: number; profiles: string[]; updatedAt: number }> {
  const raw = await readJsonFile<{ version?: number; profiles?: unknown[]; updatedAt?: number }>(directCloudProfilesPath());
  return {
    version: typeof raw?.version === 'number' ? raw.version : 2,
    profiles: Array.isArray(raw?.profiles) ? raw.profiles.filter((x): x is string => typeof x === 'string') : [],
    updatedAt: typeof raw?.updatedAt === 'number' ? raw.updatedAt : 0,
  };
}

export async function writeActiveProfilesState(profiles: string[]): Promise<void> {
  await writeJsonAtomic(directCloudProfilesPath(), {
    version: 2,
    profiles: [...new Set(profiles)],
    updatedAt: Date.now(),
  });
}

export type DirectCloudOverride = { modelId: string; enabled: boolean };

export async function readDirectCloudOverrides(): Promise<Record<string, DirectCloudOverride>> {
  const raw = await readJsonFile<Record<string, unknown>>(directCloudOverridesPath());
  if (!raw || typeof raw !== 'object') return {};
  const result: Record<string, DirectCloudOverride> = {};
  for (const [appId, value] of Object.entries(raw)) {
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(appId) || !value || typeof value !== 'object') continue;
    const entry = value as Record<string, unknown>;
    if (typeof entry['modelId'] !== 'string' || !entry['modelId'].trim()) continue;
    result[appId] = { modelId: entry['modelId'].trim(), enabled: entry['enabled'] !== false };
  }
  return result;
}
