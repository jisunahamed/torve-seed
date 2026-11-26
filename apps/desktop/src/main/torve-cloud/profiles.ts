import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { ensureClaudeDesktopGateway, setClaudeDesktopGatewayDirectCatalogSource, stopClaudeDesktopGateway } from '../connected-apps/claude-desktop-gateway.js';
import { CLAUDE_DESKTOP_PROFILE_ID, matchingClaudeDesktopTargets, opencodeConfigTargets, removeConfigPatch, applyConfigPatch } from '../system-proxy/config-patch.js';
import type { ConfigPatchDef } from '../system-proxy/config-patch.js';
import { systemProxyWslTargetsPath } from '../system-proxy/paths.js';
import type { DesktopSystemProxyProfile } from '../system-proxy/profiles.js';
import { startTorveCloudProxy, stopTorveCloudProxy, torveCloudProxyStatus } from './proxy.js';
import { directCloudBackupMatchesPatched, discardDirectCloudBackup, extendDirectCloudBackup, prepareDirectCloudBackup, restoreDirectCloudBackup, rollbackDirectCloudBackup, sealDirectCloudBackup } from './backups.js';
import { getDirectCloudOverrides } from './overrides.js';
import { torveCloudModelsStatus, type TorveModel } from './models.js';
import { CODEX_CATALOG_PATH, CODEX_MODELS_CACHE_PATH, invalidateCodexModelsCache, removeCodexModelCatalog, writeCodexModelCatalog } from './codex-catalog.js';
import { opencodeModelsFromCatalog } from './opencode-catalog.js';
import {
  checkTorveCloudProxyHealth,
  makeLifecycleProgress,
  relaunchOrVerifyApp,
  type AppLifecycleRuntime,
  type ConnectLifecycleProgress,
} from './app-lifecycle.js';

const PORT = Number(process.env['TORVE_CLOUD_PROXY_PORT']) || 8378;
const PROFILE_STATE_VERSION = 2;
type State = { version: number; profiles: string[]; updatedAt: number };
let latestDirectCatalogModels: readonly TorveModel[] = [];

setClaudeDesktopGatewayDirectCatalogSource(() => latestDirectCatalogModels);

function defaultStatePath(): string {
  return path.join(homedir(), '.torve', 'direct-cloud-profiles.json');
}

export type StartTorveCloudProfilesDeps = {
  getApiKey?: () => Promise<string | null>;
  getProfiles?: () => Promise<readonly DesktopSystemProxyProfile[]>;
  startProxy?: (port: number) => Promise<void>;
  getModelsStatus?: () => Promise<{ models: TorveModel[] }>;
  getOverrides?: () => Promise<Record<string, { modelId: string; enabled: boolean }>>;
  applyPatch?: (patch: ConfigPatchDef, peerId: string, buyerPort: number, wslTargetsFile?: string) => void;
  ensureClaudeGateway?: (port: number) => Promise<void>;
  stopClaudeGateway?: () => Promise<void>;
  lifecycleRuntime?: Partial<AppLifecycleRuntime>;
  statePath?: string;
  port?: number;
};

export type StartTorveCloudProfilesOptions = {
  onProgress?: (event: ConnectLifecycleProgress) => void;
  onAppLaunchedOrRestarted?: (appId: string) => void;
  restartApps?: boolean;
  launchIfStopped?: boolean;
  skipProxyHealthCheck?: boolean;
  skipVerify?: boolean;
  deps?: StartTorveCloudProfilesDeps;
};

async function load(statePath = defaultStatePath()): Promise<State> {
  try {
    const raw = JSON.parse(await readFile(statePath, 'utf8')) as Partial<State>;
    return {
      version: typeof raw.version === 'number' ? raw.version : 1,
      profiles: Array.isArray(raw.profiles) ? raw.profiles.filter((name): name is string => typeof name === 'string') : [],
      updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
    };
  } catch {
    return { version: PROFILE_STATE_VERSION, profiles: [], updatedAt: 0 };
  }
}

async function save(next: State, statePath = defaultStatePath()): Promise<void> {
  await mkdir(path.dirname(statePath), { recursive: true });
  const temp = `${statePath}.tmp`;
  await writeFile(temp, JSON.stringify(next) + '\n', { mode: 0o600 });
  await rename(temp, statePath);
}

async function resolveSystemProxyProfiles(deps?: StartTorveCloudProfilesDeps): Promise<readonly DesktopSystemProxyProfile[]> {
  if (deps?.getProfiles) return deps.getProfiles();
  const mod = await import('../system-proxy/profiles.js');
  return mod.SYSTEM_PROXY_PROFILES;
}

function cloudProfiles(names: string[], available: readonly DesktopSystemProxyProfile[]): DesktopSystemProxyProfile[] {
  const found = names.map((name) => available.find((profile) => profile.name === name));
  if (found.some((profile) => !profile)) throw new Error('One or more selected apps are unknown.');
  if (found.some((profile) => profile?.kind !== 'config-patch' || !profile.configPatch)) {
    throw new Error('Closed desktop apps cannot use Direct Torve Cloud. Use their documented custom-endpoint option; TLS-pinned apps are never silently MITM-routed.');
  }
  return found as DesktopSystemProxyProfile[];
}

function directPatch(appId: string, patch: ConfigPatchDef, models: readonly TorveModel[] = []): ConfigPatchDef {
  if (patch.format === 'claude-desktop') return patch;
  if (!('baseURL' in patch)) return patch;
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
  if (scoped.format === 'continue') return { ...scoped, models: opencodeModelsFromCatalog(models) };
  if (scoped.format === 'claude-code') return { ...scoped, models: opencodeModelsFromCatalog(models) };
  return scoped;
}

function claudeCodeTabPatch(models: readonly TorveModel[], port = PORT): ConfigPatchDef {
  return {
    format: 'claude-code', configPath: '~/.claude/settings.json', providerKey: 'torve',
    baseURL: `http://127.0.0.1:${port}/app/claude-desktop`, models: opencodeModelsFromCatalog(models),
  };
}

function expandHome(filePath: string): string {
  return filePath === '~' ? homedir() : filePath.startsWith('~/') ? path.join(homedir(), filePath.slice(2)) : filePath;
}

function backupPaths(patch: ConfigPatchDef): string[] {
  if (patch.format === 'claude-desktop') {
    const targets = matchingClaudeDesktopTargets(patch);
    if (targets.length === 0) return [];
    const paths: string[] = [];
    for (const target of targets) {
      const library = path.join(target.thirdPartyDir, 'configLibrary');
      paths.push(
        target.configPath,
        path.join(target.thirdPartyDir, 'claude_desktop_config.json'),
        path.join(library, '_meta.json'),
        path.join(library, `${CLAUDE_DESKTOP_PROFILE_ID}.json`),
      );
    }
    paths.push(
      path.join(homedir(), '.claude', 'settings.json'),
      path.join(homedir(), '.claude', 'settings.json.torve.state.json'),
    );
    return paths;
  }
  const paths = patch.format === 'opencode' ? opencodeConfigTargets(patch) : [expandHome(patch.configPath)];
  if (patch.format === 'codex') paths.push(CODEX_MODELS_CACHE_PATH);
  if (patch.format === 'pi') paths.push(expandHome(patch.settingsPath));
  if (patch.format === 'gemini-cli') paths.push(expandHome(patch.envPath));
  if (patch.format === 'antigravity-ide' && patch.mcpFallback) {
    if (patch.mcpConfigPath) paths.push(expandHome(patch.mcpConfigPath));
    if (patch.serverPath) paths.push(expandHome(patch.serverPath));
  }
  if (patch.format === 'continue' && patch.legacyConfigPath && !existsSync(paths[0]!) && existsSync(expandHome(patch.legacyConfigPath))) return [expandHome(patch.legacyConfigPath)];
  return paths;
}

async function removeDirectPatch(appId: string, patch: ConfigPatchDef, opts: { forceExact?: boolean } = {}): Promise<void> {
  const backupId = appId === 'antigravity' ? 'antigravity-ide' : appId;
  const restored = await restoreDirectCloudBackup(backupId, {
    forceExact: opts.forceExact ?? (appId === 'antigravity' || appId === 'claude-desktop'),
  });
  if (!restored) {
    removeConfigPatch(directPatch(appId, patch), systemProxyWslTargetsPath());
    await discardDirectCloudBackup(backupId);
  }
  if (appId === 'codex') {
    await invalidateCodexModelsCache();
    await removeCodexModelCatalog();
  }
}

export async function refreshCodexCatalogIfConnected(models?: readonly TorveModel[]): Promise<boolean> {
  const state = await load();
  if (!state.profiles.includes('codex')) return false;
  const catalog = models ?? (await torveCloudModelsStatus()).models;
  await writeCodexModelCatalog(catalog);
  await invalidateCodexModelsCache();
  return true;
}

export async function refreshCatalogConfigsIfConnected(models?: readonly TorveModel[]): Promise<boolean> {
  const state = await load();
  const catalog = models ?? (await torveCloudModelsStatus()).models;
  latestDirectCatalogModels = catalog;
  const available = await resolveSystemProxyProfiles();
  let changed = false;
  for (const name of ['opencode', 'continue']) {
    if (!state.profiles.includes(name)) continue;
    const profile = available.find((entry) => entry.name === name);
    if (!profile?.configPatch) continue;
    const patch = directPatch(name, profile.configPatch, catalog);
    const canReseal = await directCloudBackupMatchesPatched(name);
    applyConfigPatch(patch, 'direct', PORT, systemProxyWslTargetsPath());
    // Refresh mutates managed bytes. Reseal only an untouched patch; user/app
    // edits deliberately keep exact restore guarded and use semantic unpatch.
    if (canReseal) await sealDirectCloudBackup(name);
    changed = true;
  }
  return changed;
}

export async function torveCloudProfilesState(statePath = defaultStatePath(), port = PORT): Promise<{ running: boolean; port: number; activeProfileNames: string[]; mode: 'system-proxy'; peerId: string; pid: null; startedAt: number; lastExitCode: null; lastError: null }> {
  const state = await load(statePath);
  return { running: torveCloudProxyStatus().running, port, activeProfileNames: state.profiles, mode: 'system-proxy', peerId: 'direct', pid: null, startedAt: state.updatedAt || Date.now(), lastExitCode: null, lastError: null };
}

export async function startTorveCloudProfiles(
  names: string[],
  opts: StartTorveCloudProfilesOptions = {},
): Promise<Awaited<ReturnType<typeof torveCloudProfilesState>>> {
  const deps = opts.deps;
  const port = deps?.port ?? PORT;
  const statePath = deps?.statePath ?? defaultStatePath();
  const apiKey = deps?.getApiKey
    ? await deps.getApiKey()
    : await (await import('../ipc/torve-account.js')).getTorveCloudApiKey();
  if (!apiKey) throw new Error('Connect a Torve account before enabling an app.');

  const available = await resolveSystemProxyProfiles(deps);
  const profiles = cloudProfiles([...new Set(names)], available);
  const previous = await load(statePath);
  const alreadyConnected = new Set(previous.profiles);
  const toApply = profiles.filter((profile) => !alreadyConnected.has(profile.name) || (previous.version < PROFILE_STATE_VERSION && profile.name === 'antigravity'));

  const emit = (appId: string, stage: ConnectLifecycleProgress['stage'], label: string, detail?: string): void => {
    opts.onProgress?.(makeLifecycleProgress(appId, stage, label, detail));
  };

  for (const profile of toApply) {
    emit(profile.name, 'checking-proxy', 'Checking Torve proxy...');
  }

  const startProxyFn = deps?.startProxy ?? startTorveCloudProxy;
  await startProxyFn(port);
  if (!opts.skipProxyHealthCheck && toApply.length > 0) {
    const proxyHealth = await checkTorveCloudProxyHealth(port, deps?.lifecycleRuntime);
    if (!proxyHealth.reachable) {
      const error = proxyHealth.error ?? `Torve proxy is not reachable on 127.0.0.1:${port}.`;
      for (const profile of toApply) {
        emit(profile.name, 'error', 'Proxy check failed', error);
      }
      throw new Error(error);
    }
  }

  const catalog = deps?.getModelsStatus
    ? await deps.getModelsStatus()
    : await torveCloudModelsStatus();
  latestDirectCatalogModels = catalog.models;
  if (profiles.some((profile) => profile.configPatch?.format === 'claude-desktop')) {
    if (deps?.ensureClaudeGateway) {
      await deps.ensureClaudeGateway(port);
    } else {
      await ensureClaudeDesktopGateway(port, undefined, path.join(homedir(), '.torve', 'claude-direct-models.json'), '/app/claude-desktop');
    }
  }

  const applied: DesktopSystemProxyProfile[] = [];
  const overrides = deps?.getOverrides ? await deps.getOverrides() : await getDirectCloudOverrides();
  const applyPatchFn = deps?.applyPatch ?? applyConfigPatch;

  const resolvedPatch = async (profile: DesktopSystemProxyProfile): Promise<ConfigPatchDef> => {
    const scoped = directPatch(profile.name, profile.configPatch!, catalog.models);
    if (scoped.format === 'gemini-cli' && overrides[profile.name]?.enabled) {
      return { ...scoped, model: overrides[profile.name]!.modelId };
    }
    if (scoped.format === 'codex') {
      const selected = overrides[profile.name]?.enabled ? overrides[profile.name]!.modelId : catalog.models[0]?.id;
      if (!selected) throw new Error('No Torve models are available for Codex. Refresh models and try again.');
      await writeCodexModelCatalog(catalog.models);
      await invalidateCodexModelsCache();
      return { ...scoped, model: selected, modelCatalogJson: CODEX_CATALOG_PATH };
    }
    return scoped;
  };

  let activeAppId: string | null = null;
  try {
    for (const profile of toApply) {
      activeAppId = profile.name;
      const patch = await resolvedPatch(profile);
      const backupId = profile.name === 'antigravity' ? 'antigravity-ide' : profile.name;

      emit(profile.name, 'backing-up', `Backing up ${profile.label} config...`);
      await prepareDirectCloudBackup(backupId, backupPaths(patch));

      emit(profile.name, 'patching', `Patching ${profile.label} config...`);
      try {
        applyPatchFn(patch, 'direct', port, systemProxyWslTargetsPath());
        if (profile.name === 'claude-desktop') {
          applyPatchFn(claudeCodeTabPatch(catalog.models, port), 'direct', port, systemProxyWslTargetsPath());
        }
        await sealDirectCloudBackup(backupId);
      } catch (err) {
        // A multi-file patch may fail after its first atomic write. Since the
        // backup is not sealed yet, restore its raw originals directly.
        await rollbackDirectCloudBackup(backupId);
        if (profile.name === 'codex') {
          await invalidateCodexModelsCache();
          await removeCodexModelCatalog();
        }
        throw err;
      }
      applied.push(profile);

      if (opts.restartApps !== false) {
        if (profile.name === 'antigravity') {
          // Keep Antigravity's unified 1-toggle flow intact: if the standalone app
          // is running and not yet natively patched, let the UI prompt to close & apply.
          const agStatus = deps?.lifecycleRuntime?.getAntigravityStatus
            ? await deps.lifecycleRuntime.getAntigravityStatus()
            : await (await import('./antigravity-standalone-patch.js')).antigravityStandaloneStatus({ bypassCache: true }).catch(() => null);
          if (agStatus?.running && !agStatus.enabled) {
            emit(profile.name, 'restarting-app', 'Waiting for Antigravity...', 'Close Antigravity to apply Native Model Picker');
          } else {
            const relaunch = await relaunchOrVerifyApp(profile.name, {
              restartAppName: profile.restartAppName,
              launchIfStopped: opts.launchIfStopped ?? false,
              port,
              skipProxyVerify: true,
              onProgress: opts.onProgress,
              runtime: deps?.lifecycleRuntime,
            });
            if (relaunch.launched || relaunch.restarted) {
              opts.onAppLaunchedOrRestarted?.(profile.name);
            }
          }
        } else {
          const relaunch = await relaunchOrVerifyApp(profile.name, {
            restartAppName: profile.restartAppName,
            launchIfStopped: opts.launchIfStopped ?? (profile.appAction === 'open-tool'),
            port,
            skipProxyVerify: true,
            onProgress: opts.onProgress,
            runtime: deps?.lifecycleRuntime,
          });
          if (relaunch.launched || relaunch.restarted) {
            opts.onAppLaunchedOrRestarted?.(profile.name);
          }
        }
      }

      emit(profile.name, 'verifying', `Verifying ${profile.label} connection...`);
      if (!opts.skipVerify) {
        const proxyHealth = await checkTorveCloudProxyHealth(port, deps?.lifecycleRuntime);
        if (!proxyHealth.reachable) {
          throw new Error(proxyHealth.error ?? `Torve proxy stopped responding on 127.0.0.1:${port}.`);
        }
      }

      emit(profile.name, 'done', `${profile.label} connected`);
    }

    // OpenCode Desktop and Claude Desktop may normalize their config files
    // while Torve is not running. The persisted connection state alone is
    // therefore not proof that the managed entries still exist. On resume,
    // re-apply the additive patch without replacing the original backup. If
    // the app/user changed the file, leave the old seal untouched so OFF uses
    // semantic removal instead of overwriting those edits.
    for (const profile of profiles) {
      if (toApply.includes(profile)) continue;
      activeAppId = profile.name;
      const patch = await resolvedPatch(profile);
      const backupId = profile.name === 'antigravity' ? 'antigravity-ide' : profile.name;
      await extendDirectCloudBackup(backupId, backupPaths(patch));
      const canReseal = await directCloudBackupMatchesPatched(backupId);
      applyPatchFn(patch, 'direct', port, systemProxyWslTargetsPath());
      if (profile.name === 'claude-desktop') {
        applyPatchFn(claudeCodeTabPatch(catalog.models, port), 'direct', port, systemProxyWslTargetsPath());
      }
      if (canReseal) await sealDirectCloudBackup(backupId);
    }
  } catch (err) {
    // Do not leave a partially connected batch behind when an install probe,
    // config parse, or post-patch verification fails midway through connect.
    for (const profile of [...applied].reverse()) {
      await removeDirectPatch(profile.name, profile.configPatch!, { forceExact: true });
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    const errorAppId = activeAppId ?? toApply[0]?.name ?? names[0] ?? 'torve';
    emit(errorAppId, 'error', 'Connection failed — rolled back changes', errMsg);
    throw err;
  }

  const requested = new Set(profiles.map((profile) => profile.name));
  for (const name of previous.profiles) {
    if (requested.has(name)) continue;
    const removed = available.find((profile) => profile.name === name);
    if (removed?.configPatch) await removeDirectPatch(removed.name, removed.configPatch);
  }
  if (!profiles.some((profile) => profile.configPatch?.format === 'claude-desktop')) {
    if (deps?.stopClaudeGateway) await deps.stopClaudeGateway();
    else await stopClaudeDesktopGateway();
  }
  await save({ version: PROFILE_STATE_VERSION, profiles: profiles.map((profile) => profile.name), updatedAt: Date.now() }, statePath);
  return torveCloudProfilesState(statePath, port);
}

export async function stopTorveCloudProfiles(
  opts: { statePath?: string; deps?: StartTorveCloudProfilesDeps } = {},
): Promise<Awaited<ReturnType<typeof torveCloudProfilesState>>> {
  const statePath = opts.statePath ?? defaultStatePath();
  const port = opts.deps?.port ?? PORT;
  const state = await load(statePath);
  const available = await resolveSystemProxyProfiles(opts.deps);
  for (const name of state.profiles) {
    const profile = available.find((entry) => entry.name === name);
    if (profile?.configPatch) await removeDirectPatch(profile.name, profile.configPatch);
  }
  await save({ version: PROFILE_STATE_VERSION, profiles: [], updatedAt: Date.now() }, statePath);
  await stopTorveCloudProxy();
  if (opts.deps?.stopClaudeGateway) await opts.deps.stopClaudeGateway();
  else await stopClaudeDesktopGateway();
  return torveCloudProfilesState(statePath, port);
}
