/**
 * Seamless Connect lifecycle orchestration for Torve Cloud connected apps.
 *
 * Keeps GUI desktop apps (graceful quit -> wait -> safe fallback -> relaunch ->
 * window wait -> verify) cleanly separated from pure terminal CLIs (never kill
 * user terminal/shell processes; verify config and advise session restart).
 *
 * NOTE: This module avoids top-level `electron` imports so it can be imported
 * directly by plain Node unit tests (`node --test`). Electron-backed helpers
 * are loaded lazily at runtime and can be overridden via `AppLifecycleRuntime`.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { AppLaunchTarget } from '../connected-apps/launch-settings.js';
import type { ConfigPatchDef } from '../system-proxy/config-patch.js';
import type { DesktopSystemProxyProfile } from '../system-proxy/profiles.js';
import type { TorveModel } from './models.js';

export type ConnectLifecycleStage =
  | 'checking-proxy'
  | 'backing-up'
  | 'patching'
  | 'restarting-app'
  | 'verifying'
  | 'done'
  | 'error';

export type ConnectLifecycleProgress = {
  appId: string;
  stage: ConnectLifecycleStage;
  label: string;
  detail?: string;
  timestamp: number;
};

export type AppClassification = 'gui' | 'cli';

export type RelaunchOrVerifyResult = {
  ok: boolean;
  appId: string;
  isGui: boolean;
  restarted: boolean;
  launched?: boolean;
  needsSessionRestart?: boolean;
  verified: boolean;
  detail: string;
  error?: string;
};

export type LifecycleOpenResult = {
  ok: boolean;
  appId: string;
  isGui: boolean;
  fallback?: string;
  targetPath?: string;
  error?: string;
};

export type LifecycleVerifyResult = {
  ok: boolean;
  appId: string;
  verified: boolean;
  proxyReachable: boolean;
  configPresent: boolean;
  detail: string;
  error?: string;
};

export type ProxyHealthResult = {
  ok: boolean;
  reachable: boolean;
  statusCode?: number;
  error?: string;
};

export type AppLifecycleRuntime = {
  platform: NodeJS.Platform;
  listProfiles: () => Promise<DesktopSystemProxyProfile[]>;
  resolveLaunchTarget: (profileName: string, restartAppName?: string) => Promise<AppLaunchTarget | null>;
  resolveExecutablePath: (targetPath: string) => Promise<string | null>;
  isTargetRunning: (target: AppLaunchTarget) => Promise<boolean>;
  quitTarget: (target: AppLaunchTarget) => Promise<void> | void;
  killTarget: (target: AppLaunchTarget) => Promise<void> | void;
  launchTarget: (target: AppLaunchTarget, opts?: { env?: Record<string, string> }) => Promise<{ ok: boolean; error?: string }> | { ok: boolean; error?: string };
  waitForTarget: (target: AppLaunchTarget, timeoutMs?: number) => Promise<void>;
  markManaged: (target: AppLaunchTarget) => Promise<void> | void;
  captureManaged: (target: AppLaunchTarget) => Promise<void>;
  launchAntigravity: () => Promise<{ ok: boolean; targetPath?: string; error?: string }>;
  getAntigravityStatus: () => Promise<{ installed: boolean; enabled: boolean; running: boolean; state: string } | null>;
  openExternalUrl: (url: string) => Promise<void>;
  startProxy: (port: number) => Promise<void>;
  isProxyRunning: () => boolean;
  probeProxyModels: (port: number, timeoutMs?: number) => Promise<ProxyHealthResult>;
  getActiveProfiles: () => Promise<string[]>;
  getCatalogModels: () => Promise<readonly TorveModel[]>;
  resyncProfileConfig: (profileName: string, port: number) => Promise<{ ok: boolean; configPaths: string[]; error?: string }>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
};

export type RelaunchOrVerifyOptions = {
  restartAppName?: string;
  launchIfStopped?: boolean;
  forceAfterGrace?: boolean;
  graceTimeoutMs?: number;
  settleDelayMs?: number;
  launchTimeoutMs?: number;
  port?: number;
  skipConfigVerify?: boolean;
  skipProxyVerify?: boolean;
  onProgress?: (event: ConnectLifecycleProgress) => void;
  runtime?: Partial<AppLifecycleRuntime>;
};

const DEFAULT_PORT = Number(process.env['TORVE_CLOUD_PROXY_PORT']) || 8378;
const DEFAULT_GRACE_TIMEOUT_MS = 8_000;
const DEFAULT_FORCE_WAIT_MS = 3_000;
const DEFAULT_SETTLE_DELAY_MS = 400;
const DEFAULT_LAUNCH_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 250;

/** Pure terminal CLIs whose processes (and parent shells) must NEVER be terminated. */
export const TERMINAL_CLI_PROFILES: ReadonlySet<string> = new Set([
  'gemini-cli',
  'opencode-cli',
  'claude-code',
  'codex-cli',
]);

/** Known GUI desktop / IDE applications that read config at startup. */
export const KNOWN_GUI_PROFILES: ReadonlySet<string> = new Set([
  'antigravity',
  'claude-desktop',
  'opencode-desktop',
  'codex-desktop',
]);

/** Default GUI application names per profile when `restartAppName` isn't specified. */
const DEFAULT_GUI_APP_NAMES: Readonly<Record<string, readonly string[]>> = {
  antigravity: ['Antigravity'],
  'claude-desktop': ['Claude'],
  opencode: ['OpenCode'],
  'opencode-desktop': ['OpenCode'],
  codex: ['Codex', 'ChatGPT'],
  'codex-desktop': ['Codex', 'ChatGPT'],
};

/**
 * Process / application names that must NEVER be quit or force-killed by
 * lifecycle automation (protects Torve Desktop itself and all user shells/terminals).
 */
const FORBIDDEN_PROCESS_NAMES: ReadonlySet<string> = new Set([
  'torve',
  'torve desktop',
  'torve-desktop',
  'torveai',
  'electron',
  'explorer',
  'finder',
  'terminal',
  'iterm',
  'iterm2',
  'warp',
  'alacritty',
  'kitty',
  'wezterm',
  'wezterm-gui',
  'hyper',
  'windowsterminal',
  'windows terminal',
  'wt',
  'cmd',
  'powershell',
  'pwsh',
  'bash',
  'zsh',
  'sh',
  'fish',
  'nu',
  'conhost',
  'openconsole',
  'node',
]);

function normalizeProcessToken(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const base = path.basename(trimmed);
  const withoutExt = base.replace(/\.(exe|app|lnk)$/i, '');
  return withoutExt.trim().toLowerCase();
}

export function isSafeGuiTargetName(name: string): boolean {
  const token = normalizeProcessToken(name);
  if (!token) return false;
  return !FORBIDDEN_PROCESS_NAMES.has(token);
}

async function isSafeGuiTarget(target: AppLaunchTarget, runtime: AppLifecycleRuntime): Promise<boolean> {
  if (!isSafeGuiTargetName(target.name)) return false;
  if (target.path && !isSafeGuiTargetName(target.path)) return false;
  if (runtime.platform === 'win32' && target.path) {
    const exe = await runtime.resolveExecutablePath(target.path).catch(() => null);
    if (exe && !isSafeGuiTargetName(exe)) return false;
  }
  return true;
}

/**
 * Determines whether a profile represents a GUI desktop application (safe to
 * quit+wait+relaunch) vs. a pure terminal CLI (must NEVER kill running shells).
 */
export function isGuiAppProfile(profileName: string, restartAppName?: string): boolean {
  const id = profileName.trim().toLowerCase();
  if (!id) return false;
  if (TERMINAL_CLI_PROFILES.has(id)) return false;
  if (typeof restartAppName === 'string' && restartAppName.trim().length > 0) {
    return isSafeGuiTargetName(restartAppName);
  }
  return KNOWN_GUI_PROFILES.has(id);
}

export function classifyAppProfile(profileName: string, restartAppName?: string): AppClassification {
  return isGuiAppProfile(profileName, restartAppName) ? 'gui' : 'cli';
}

export function makeLifecycleProgress(
  appId: string,
  stage: ConnectLifecycleStage,
  label: string,
  detail?: string,
  timestamp = Date.now(),
): ConnectLifecycleProgress {
  return {
    appId,
    stage,
    label,
    ...(detail ? { detail } : {}),
    timestamp,
  };
}

function expandHome(filePath: string): string {
  return filePath === '~'
    ? homedir()
    : filePath.startsWith('~/')
      ? path.join(homedir(), filePath.slice(2))
      : filePath;
}

async function collectPatchConfigPaths(patch: ConfigPatchDef): Promise<string[]> {
  const cp = await import('../system-proxy/config-patch.js');
  if (patch.format === 'claude-desktop') {
    const targets = cp.matchingClaudeDesktopTargets(patch);
    const paths = targets.map((t) => t.configPath);
    const claudeCodePath = path.join(homedir(), '.claude', 'settings.json');
    if (existsSync(claudeCodePath)) paths.push(claudeCodePath);
    return paths;
  }
  if (patch.format === 'opencode') {
    return cp.opencodeConfigTargets(patch);
  }
  const paths = [expandHome(patch.configPath)];
  if (patch.format === 'gemini-cli') paths.push(expandHome(patch.envPath));
  if (patch.format === 'antigravity-ide' && patch.mcpFallback && patch.mcpConfigPath) {
    paths.push(expandHome(patch.mcpConfigPath));
  }
  return paths;
}

async function defaultProbeProxyModels(port: number, timeoutMs = 2_000): Promise<ProxyHealthResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      method: 'GET',
      signal: controller.signal,
    });
    // 200 means full catalog health; 401 still proves the local proxy is alive and responding.
    return {
      ok: res.ok || res.status === 401,
      reachable: true,
      statusCode: res.status,
      ...(!res.ok && res.status !== 401 ? { error: `Proxy returned HTTP ${res.status}` } : {}),
    };
  } catch (err) {
    return {
      ok: false,
      reachable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

export function createDefaultLifecycleRuntime(): AppLifecycleRuntime {
  return {
    platform: process.platform,
    async listProfiles() {
      const mod = await import('../system-proxy/profiles.js');
      return mod.allSystemProxyProfiles();
    },
    async resolveLaunchTarget(profileName, restartAppName) {
      const id = profileName.trim().toLowerCase();
      if (TERMINAL_CLI_PROFILES.has(id)) return null;
      const [{ effectiveLaunchTargetAsync }, { namedAppTarget }] = await Promise.all([
        import('../connected-apps/profile-targets.js'),
        import('../connected-apps/launcher.js'),
      ]);
      const overrideOrDefault = await effectiveLaunchTargetAsync(profileName);
      if (overrideOrDefault) return overrideOrDefault;
      const candidates = [
        ...(restartAppName ? [restartAppName] : []),
        ...(DEFAULT_GUI_APP_NAMES[id] ?? []),
      ];
      for (const candidate of candidates) {
        const resolved = namedAppTarget(candidate);
        if (resolved) return resolved;
      }
      return null;
    },
    async resolveExecutablePath(targetPath) {
      const { windowsExecutablePathAsync } = await import('../connected-apps/launcher.js');
      return windowsExecutablePathAsync(targetPath);
    },
    async isTargetRunning(target) {
      const { isAppTargetRunning } = await import('../connected-apps/launcher.js');
      return isAppTargetRunning(target);
    },
    async quitTarget(target) {
      const { quitAppTarget } = await import('../connected-apps/launcher.js');
      quitAppTarget(target);
    },
    async killTarget(target) {
      const { killAppTarget } = await import('../connected-apps/launcher.js');
      killAppTarget(target);
    },
    async launchTarget(target, opts) {
      const { launchAppTarget } = await import('../connected-apps/installed.js');
      return launchAppTarget(target, opts);
    },
    async waitForTarget(target, timeoutMs) {
      const { waitForAppTarget } = await import('../connected-apps/launcher.js');
      return waitForAppTarget(target, timeoutMs);
    },
    async markManaged(target) {
      const { markAppTargetManaged } = await import('../connected-apps/launcher.js');
      markAppTargetManaged(target);
    },
    async captureManaged(target) {
      const { captureManagedAppTarget } = await import('../connected-apps/launcher.js');
      return captureManagedAppTarget(target);
    },
    async launchAntigravity() {
      const { launchAntigravity } = await import('./antigravity-standalone-patch.js');
      return launchAntigravity();
    },
    async getAntigravityStatus() {
      const { antigravityStandaloneStatus } = await import('./antigravity-standalone-patch.js');
      return antigravityStandaloneStatus({ bypassCache: true }).catch(() => null);
    },
    async openExternalUrl(url) {
      const { shell } = await import('electron');
      await shell.openExternal(url);
    },
    async startProxy(port) {
      const { startTorveCloudProxy } = await import('./proxy.js');
      await startTorveCloudProxy(port);
    },
    isProxyRunning() {
      // Best-effort sync check; caller also probes loopback HTTP directly.
      return true;
    },
    probeProxyModels: defaultProbeProxyModels,
    async getActiveProfiles() {
      const { torveCloudProfilesState } = await import('./profiles.js');
      return (await torveCloudProfilesState()).activeProfileNames;
    },
    async getCatalogModels() {
      const { torveCloudModelsStatus } = await import('./models.js');
      return (await torveCloudModelsStatus()).models;
    },
    async resyncProfileConfig(profileName, port) {
      const [{ SYSTEM_PROXY_PROFILES }, cp, backups, pathsMod, modelsMod, overridesMod, codexMod, opencodeMod] = await Promise.all([
        import('../system-proxy/profiles.js'),
        import('../system-proxy/config-patch.js'),
        import('./backups.js'),
        import('../system-proxy/paths.js'),
        import('./models.js'),
        import('./overrides.js'),
        import('./codex-catalog.js'),
        import('./opencode-catalog.js'),
      ]);
      const profile = SYSTEM_PROXY_PROFILES.find((entry) => entry.name === profileName);
      if (!profile?.configPatch) {
        return { ok: true, configPaths: [] };
      }
      const catalog = (await modelsMod.torveCloudModelsStatus()).models;
      const overrides = await overridesMod.getDirectCloudOverrides();
      let patch: ConfigPatchDef = profile.configPatch;
      if ('baseURL' in patch && patch.format !== 'claude-desktop') {
        const base = patch.baseURL.replace(/\/+$/, '');
        const suffix = base.endsWith('/v1') ? '/v1' : '';
        const root = suffix ? base.slice(0, -3) : base;
        patch = { ...patch, baseURL: `${root}/app/${profileName}${suffix}` } as ConfigPatchDef;
      }
      if (patch.format === 'opencode') {
        patch = { ...patch, apiKey: 'torve-local-proxy', modelAlias: 'auto', models: opencodeMod.opencodeModelsFromCatalog(catalog) };
      } else if (patch.format === 'claude-code') {
        patch = { ...patch, models: opencodeMod.opencodeModelsFromCatalog(catalog) };
      } else if (patch.format === 'gemini-cli' && overrides[profileName]?.enabled) {
        patch = { ...patch, model: overrides[profileName]!.modelId };
      } else if (patch.format === 'codex') {
        const selected = overrides[profileName]?.enabled ? overrides[profileName]!.modelId : catalog[0]?.id;
        if (selected) {
          await codexMod.writeCodexModelCatalog(catalog);
          await codexMod.invalidateCodexModelsCache();
          patch = { ...patch, model: selected, modelCatalogJson: codexMod.CODEX_CATALOG_PATH };
        }
      }
      const backupId = profileName === 'antigravity' ? 'antigravity-ide' : profileName;
      const canReseal = await backups.directCloudBackupMatchesPatched(backupId);
      cp.applyConfigPatch(patch, 'direct', port, pathsMod.systemProxyWslTargetsPath());
      if (profileName === 'claude-desktop') {
        cp.applyConfigPatch(
          {
            format: 'claude-code',
            configPath: '~/.claude/settings.json',
            providerKey: 'torve',
            baseURL: `http://127.0.0.1:${port}/app/claude-desktop`,
            models: opencodeMod.opencodeModelsFromCatalog(catalog),
          },
          'direct',
          port,
          pathsMod.systemProxyWslTargetsPath(),
        );
      }
      if (canReseal) await backups.sealDirectCloudBackup(backupId);
      const configPaths = await collectPatchConfigPaths(patch);
      return { ok: true, configPaths };
    },
    sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },
    now: () => Date.now(),
  };
}

function mergeRuntime(overrides?: Partial<AppLifecycleRuntime>): AppLifecycleRuntime {
  const base = createDefaultLifecycleRuntime();
  return overrides ? { ...base, ...overrides } : base;
}

export async function checkTorveCloudProxyHealth(
  port = DEFAULT_PORT,
  runtimeOverrides?: Partial<AppLifecycleRuntime>,
): Promise<ProxyHealthResult> {
  const runtime = mergeRuntime(runtimeOverrides);
  return runtime.probeProxyModels(port);
}

async function waitUntilExited(
  target: AppLaunchTarget,
  timeoutMs: number,
  runtime: AppLifecycleRuntime,
): Promise<boolean> {
  const deadline = runtime.now() + timeoutMs;
  while (runtime.now() < deadline) {
    if (!(await runtime.isTargetRunning(target))) return true;
    await runtime.sleep(POLL_INTERVAL_MS);
  }
  return !(await runtime.isTargetRunning(target));
}

async function resolveProfileAndTarget(
  profileName: string,
  restartAppName: string | undefined,
  runtime: AppLifecycleRuntime,
): Promise<{
  profile: DesktopSystemProxyProfile | undefined;
  resolvedRestartName: string | undefined;
  target: AppLaunchTarget | null;
  isGui: boolean;
}> {
  const id = profileName.trim().toLowerCase();
  const profiles = await runtime.listProfiles().catch(() => [] as DesktopSystemProxyProfile[]);
  const profile = profiles.find((p) => p.name === profileName || p.name.toLowerCase() === id);
  const resolvedRestartName = restartAppName ?? profile?.restartAppName;

  if (TERMINAL_CLI_PROFILES.has(id)) {
    return { profile, resolvedRestartName, target: null, isGui: false };
  }

  const target = await runtime.resolveLaunchTarget(profileName, resolvedRestartName);
  const explicitGui = isGuiAppProfile(profileName, resolvedRestartName);
  const targetSafe = target ? await isSafeGuiTarget(target, runtime) : true;
  if (target && !targetSafe) {
    // Preserve target so callers can explicitly reject protected shell/Torve targets
    // without ever falling through to quit/kill.
    return { profile, resolvedRestartName, target, isGui: true };
  }
  // Hybrid tools (like opencode/codex/goose) only count as GUI when an actual
  // desktop app target is resolved and safe.
  const isGui = explicitGui || target !== null;
  return { profile, resolvedRestartName, target, isGui };
}

async function launchResolvedApp(
  profileName: string,
  target: AppLaunchTarget | null,
  runtime: AppLifecycleRuntime,
  launchTimeoutMs: number,
): Promise<{ ok: boolean; targetPath?: string; error?: string }> {
  if (profileName === 'antigravity') {
    const agResult = await runtime.launchAntigravity();
    if (agResult.ok) {
      if (target) {
        await runtime.markManaged(target);
        await runtime.waitForTarget(target, launchTimeoutMs);
        await runtime.captureManaged(target);
      }
      return { ok: true, ...(agResult.targetPath ? { targetPath: agResult.targetPath } : {}) };
    }
    if (!target) {
      return { ok: false, error: agResult.error ?? 'Unable to launch Antigravity.' };
    }
  }

  if (!target) {
    return { ok: false, error: `Could not locate desktop application for ${profileName}.` };
  }

  const launchRes = await runtime.launchTarget(target);
  if (!launchRes.ok) {
    return { ok: false, error: launchRes.error ?? `Could not launch ${target.name}.` };
  }
  await runtime.markManaged(target);
  await runtime.waitForTarget(target, launchTimeoutMs);
  await runtime.captureManaged(target);
  return { ok: true, targetPath: target.path };
}

/**
 * Safely closes, waits, and relaunches a GUI desktop app so it picks up newly
 * patched configuration, or non-destructively verifies a terminal CLI without
 * ever terminating user shells or CLI processes.
 */
export async function relaunchOrVerifyApp(
  profileName: string,
  opts: RelaunchOrVerifyOptions = {},
): Promise<RelaunchOrVerifyResult> {
  const runtime = mergeRuntime(opts.runtime);
  const port = opts.port ?? DEFAULT_PORT;
  const graceTimeoutMs = opts.graceTimeoutMs ?? DEFAULT_GRACE_TIMEOUT_MS;
  const settleDelayMs = opts.settleDelayMs ?? DEFAULT_SETTLE_DELAY_MS;
  const launchTimeoutMs = opts.launchTimeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS;
  const emit = (stage: ConnectLifecycleStage, label: string, detail?: string) => {
    opts.onProgress?.(makeLifecycleProgress(profileName, stage, label, detail, runtime.now()));
  };

  const { target, isGui } = await resolveProfileAndTarget(profileName, opts.restartAppName, runtime);

  if (!isGui) {
    emit('restarting-app', 'Preserving terminal CLI session', 'Open terminal sessions are left running');
    const proxyOk = opts.skipProxyVerify
      ? true
      : (await runtime.probeProxyModels(port)).ok;
    return {
      ok: true,
      appId: profileName,
      isGui: false,
      restarted: false,
      needsSessionRestart: true,
      verified: proxyOk,
      detail: 'Terminal CLI preserved (open sessions are never killed). Start a new CLI session to apply.',
    };
  }

  if (!target) {
    if (profileName === 'antigravity') {
      const agStatus = await runtime.getAntigravityStatus();
      if (agStatus?.running) {
        return {
          ok: true,
          appId: profileName,
          isGui: true,
          restarted: false,
          needsSessionRestart: true,
          verified: true,
          detail: 'Antigravity is running. Close and relaunch Antigravity to apply changes.',
        };
      }
      if (opts.launchIfStopped && agStatus?.installed) {
        emit('restarting-app', 'Launching Antigravity...');
        const launched = await launchResolvedApp(profileName, null, runtime, launchTimeoutMs);
        return {
          ok: launched.ok,
          appId: profileName,
          isGui: true,
          restarted: false,
          launched: launched.ok,
          verified: launched.ok,
          detail: launched.ok ? 'Antigravity launched.' : (launched.error ?? 'Unable to launch Antigravity.'),
          ...(launched.error ? { error: launched.error } : {}),
        };
      }
    }
    return {
      ok: true,
      appId: profileName,
      isGui: true,
      restarted: false,
      verified: true,
      detail: `${profileName} desktop target not found on device; config patched for next launch.`,
    };
  }

  if (!(await isSafeGuiTarget(target, runtime))) {
    return {
      ok: false,
      appId: profileName,
      isGui: true,
      restarted: false,
      verified: false,
      detail: `Refused unsafe process target: ${target.name}`,
      error: `Refused to terminate protected process "${target.name}".`,
    };
  }

  const running = await runtime.isTargetRunning(target);
  if (!running) {
    if (!opts.launchIfStopped) {
      return {
        ok: true,
        appId: profileName,
        isGui: true,
        restarted: false,
        launched: false,
        verified: true,
        detail: `${target.name} is stopped; config ready for launch.`,
      };
    }
    emit('restarting-app', `Launching ${target.name}...`);
    const launchRes = await launchResolvedApp(profileName, target, runtime, launchTimeoutMs);
    if (!launchRes.ok) {
      return {
        ok: false,
        appId: profileName,
        isGui: true,
        restarted: false,
        launched: false,
        verified: false,
        detail: launchRes.error ?? `Failed to launch ${target.name}.`,
        error: launchRes.error,
      };
    }
    const proxyOk = opts.skipProxyVerify ? true : (await runtime.probeProxyModels(port)).ok;
    return {
      ok: true,
      appId: profileName,
      isGui: true,
      restarted: false,
      launched: true,
      verified: proxyOk,
      detail: `${target.name} launched cleanly.`,
    };
  }

  emit('restarting-app', `Restarting ${target.name}...`, `Closing ${target.name} cleanly`);
  try {
    await runtime.quitTarget(target);
  } catch {
    // App may ignore AppleScript / WM_CLOSE or already be exiting; wait loop checks.
  }

  let exited = await waitUntilExited(target, graceTimeoutMs, runtime);
  if (!exited) {
    if (opts.forceAfterGrace === false) {
      const error = `${target.name} did not quit within ${Math.round(graceTimeoutMs / 1000)}s — restart it manually.`;
      return {
        ok: false,
        appId: profileName,
        isGui: true,
        restarted: false,
        verified: false,
        detail: error,
        error,
      };
    }
    if (await isSafeGuiTarget(target, runtime)) {
      emit('restarting-app', `Restarting ${target.name}...`, 'Force-closing unresponsive app window');
      try {
        await runtime.killTarget(target);
      } catch {
        // Best-effort fallback.
      }
      exited = await waitUntilExited(target, DEFAULT_FORCE_WAIT_MS, runtime);
    }
  }

  if (!exited) {
    const error = `${target.name} is still running and could not be restarted automatically.`;
    return {
      ok: false,
      appId: profileName,
      isGui: true,
      restarted: false,
      verified: false,
      detail: error,
      error,
    };
  }

  if (settleDelayMs > 0) {
    await runtime.sleep(settleDelayMs);
  }

  emit('restarting-app', `Relaunching ${target.name}...`, 'Waiting for application window');
  const launchRes = await launchResolvedApp(profileName, target, runtime, launchTimeoutMs);
  if (!launchRes.ok) {
    return {
      ok: false,
      appId: profileName,
      isGui: true,
      restarted: false,
      launched: false,
      verified: false,
      detail: launchRes.error ?? `Failed to relaunch ${target.name}.`,
      error: launchRes.error,
    };
  }

  const proxyOk = opts.skipProxyVerify ? true : (await runtime.probeProxyModels(port)).ok;
  return {
    ok: true,
    appId: profileName,
    isGui: true,
    restarted: true,
    launched: true,
    verified: proxyOk,
    detail: `${target.name} restarted and connected.`,
  };
}

/**
 * Cleanly closes a running GUI app (with graceful quit, exit poll, and safe
 * unresponsive fallback) BEFORE mutating app databases or sensitive configs.
 */
export async function stopAppIfRunning(
  profileName: string,
  opts: {
    restartAppName?: string;
    graceTimeoutMs?: number;
    settleDelayMs?: number;
    forceAfterGrace?: boolean;
    onProgress?: (event: ConnectLifecycleProgress) => void;
    runtime?: Partial<AppLifecycleRuntime>;
  } = {},
): Promise<{ ok: boolean; wasRunning: boolean; error?: string }> {
  const runtime = mergeRuntime(opts.runtime);
  const graceTimeoutMs = opts.graceTimeoutMs ?? DEFAULT_GRACE_TIMEOUT_MS;
  const settleDelayMs = opts.settleDelayMs ?? DEFAULT_SETTLE_DELAY_MS;
  const emit = (stage: ConnectLifecycleStage, label: string, detail?: string) => {
    opts.onProgress?.(makeLifecycleProgress(profileName, stage, label, detail, runtime.now()));
  };

  const { target, isGui } = await resolveProfileAndTarget(profileName, opts.restartAppName, runtime);
  if (!isGui || !target) {
    return { ok: true, wasRunning: false };
  }

  if (!(await isSafeGuiTarget(target, runtime))) {
    return {
      ok: false,
      wasRunning: false,
      error: `Refused to terminate protected process "${target.name}".`,
    };
  }

  const running = await runtime.isTargetRunning(target);
  if (!running) {
    return { ok: true, wasRunning: false };
  }

  emit('restarting-app', `Closing ${target.name}...`, `Waiting for ${target.name} to exit safely`);
  try {
    await runtime.quitTarget(target);
  } catch {
    // Wait loop checks exit status regardless.
  }

  let exited = await waitUntilExited(target, graceTimeoutMs, runtime);
  if (!exited && opts.forceAfterGrace !== false && (await isSafeGuiTarget(target, runtime))) {
    emit('restarting-app', `Closing ${target.name}...`, 'Force-closing unresponsive app window');
    try {
      await runtime.killTarget(target);
    } catch {
      // Best-effort fallback.
    }
    exited = await waitUntilExited(target, DEFAULT_FORCE_WAIT_MS, runtime);
  }

  if (!exited) {
    return {
      ok: false,
      wasRunning: true,
      error: `${target.name} is still running. Close it completely before modifying Codex state.`,
    };
  }

  if (settleDelayMs > 0) {
    await runtime.sleep(settleDelayMs);
  }

  return { ok: true, wasRunning: true };
}

/**
 * Launches (or focuses) a connected application when installed, or opens its URL.
 */
export async function reopenConnectedApp(
  profileName: string,
  opts: { runtime?: Partial<AppLifecycleRuntime>; launchTimeoutMs?: number } = {},
): Promise<LifecycleOpenResult> {
  const runtime = mergeRuntime(opts.runtime);
  const launchTimeoutMs = opts.launchTimeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS;
  const { profile, target, isGui } = await resolveProfileAndTarget(profileName, undefined, runtime);

  if (profileName === 'antigravity') {
    const agRes = await runtime.launchAntigravity();
    if (agRes.ok) {
      if (target) {
        await runtime.markManaged(target);
        await runtime.waitForTarget(target, launchTimeoutMs);
        await runtime.captureManaged(target);
      }
      return { ok: true, appId: profileName, isGui: true, ...(agRes.targetPath ? { targetPath: agRes.targetPath } : {}) };
    }
    if (!target) {
      return { ok: false, appId: profileName, isGui: true, error: agRes.error ?? 'Could not open Antigravity.' };
    }
  }

  if (target) {
    const launchRes = await runtime.launchTarget(target);
    if (!launchRes.ok) {
      return { ok: false, appId: profileName, isGui: true, error: launchRes.error ?? `Could not open ${target.name}.` };
    }
    await runtime.markManaged(target);
    await runtime.waitForTarget(target, launchTimeoutMs);
    await runtime.captureManaged(target);
    return { ok: true, appId: profileName, isGui: true, targetPath: target.path };
  }

  if (profile?.openUrl) {
    await runtime.openExternalUrl(profile.openUrl);
    return { ok: true, appId: profileName, isGui, fallback: profile.openUrl };
  }

  const label = profile?.label ?? profileName;
  return {
    ok: false,
    appId: profileName,
    isGui: false,
    error: `${label} is a terminal CLI — launch it from your terminal.`,
  };
}

/**
 * Runs a full per-app restart lifecycle from the UI quick action button:
 * re-verifies proxy & config, then safely restarts GUI apps or preserves CLIs.
 */
export async function restartConnectedAppLifecycle(
  profileName: string,
  opts: RelaunchOrVerifyOptions = {},
): Promise<RelaunchOrVerifyResult> {
  const runtime = mergeRuntime(opts.runtime);
  const port = opts.port ?? DEFAULT_PORT;
  const emit = (stage: ConnectLifecycleStage, label: string, detail?: string) => {
    opts.onProgress?.(makeLifecycleProgress(profileName, stage, label, detail, runtime.now()));
  };

  try {
    emit('checking-proxy', 'Checking Torve proxy...');
    await runtime.startProxy(port);
    const relaunch = await relaunchOrVerifyApp(profileName, {
      ...opts,
      port,
      launchIfStopped: opts.launchIfStopped ?? true,
      forceAfterGrace: opts.forceAfterGrace ?? true,
      runtime,
    });
    if (!relaunch.ok) {
      emit('error', relaunch.error ?? relaunch.detail, relaunch.detail);
      return relaunch;
    }
    emit('verifying', 'Verifying connection...');
    const proxy = opts.skipProxyVerify ? { ok: true, reachable: true } : await runtime.probeProxyModels(port);
    const result: RelaunchOrVerifyResult = {
      ...relaunch,
      verified: proxy.ok,
    };
    emit('done', relaunch.isGui ? (relaunch.restarted ? 'App restarted' : 'App ready') : 'CLI verified', relaunch.detail);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit('error', 'Restart failed', message);
    return {
      ok: false,
      appId: profileName,
      isGui: isGuiAppProfile(profileName, opts.restartAppName),
      restarted: false,
      verified: false,
      detail: message,
      error: message,
    };
  }
}

/**
 * Re-syncs the app's Torve config patch (if connected) and verifies both its
 * on-disk config files and loopback proxy `/v1/models` health at `127.0.0.1:8378`.
 */
export async function verifyConnectedAppConfig(
  profileName: string,
  opts: {
    port?: number;
    resync?: boolean;
    onProgress?: (event: ConnectLifecycleProgress) => void;
    runtime?: Partial<AppLifecycleRuntime>;
  } = {},
): Promise<LifecycleVerifyResult> {
  const runtime = mergeRuntime(opts.runtime);
  const port = opts.port ?? DEFAULT_PORT;
  const emit = (stage: ConnectLifecycleStage, label: string, detail?: string) => {
    opts.onProgress?.(makeLifecycleProgress(profileName, stage, label, detail, runtime.now()));
  };

  try {
    emit('checking-proxy', 'Checking Torve proxy...');
    await runtime.startProxy(port);

    let configPaths: string[] = [];
    if (opts.resync !== false) {
      const active = await runtime.getActiveProfiles();
      if (active.includes(profileName)) {
        emit('patching', 'Re-syncing config patch...');
        const synced = await runtime.resyncProfileConfig(profileName, port);
        if (!synced.ok) {
          const error = synced.error ?? `Failed to re-sync ${profileName} config.`;
          emit('error', 'Config sync failed', error);
          return {
            ok: false,
            appId: profileName,
            verified: false,
            proxyReachable: false,
            configPresent: false,
            detail: error,
            error,
          };
        }
        configPaths = synced.configPaths;
      }
    }

    emit('verifying', 'Verifying connection...');
    let configPresent = configPaths.length === 0;
    if (configPaths.length > 0) {
      let existingCount = 0;
      for (const filePath of configPaths) {
        if (existsSync(filePath)) {
          await readFile(filePath, 'utf8');
          existingCount++;
        }
      }
      configPresent = existingCount > 0;
    }

    const proxy = await runtime.probeProxyModels(port);
    if (!proxy.reachable) {
      const error = proxy.error ?? `Torve proxy is not reachable on 127.0.0.1:${port}.`;
      emit('error', 'Proxy unreachable', error);
      return {
        ok: false,
        appId: profileName,
        verified: false,
        proxyReachable: false,
        configPresent,
        detail: error,
        error,
      };
    }

    const detail = configPresent
      ? `Verified config and proxy on 127.0.0.1:${port}.`
      : `Proxy reachable on 127.0.0.1:${port}, but target config file was not found yet.`;
    emit('done', configPresent ? 'Verified' : 'Proxy healthy', detail);
    return {
      ok: true,
      appId: profileName,
      verified: proxy.ok && configPresent,
      proxyReachable: proxy.reachable,
      configPresent,
      detail,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit('error', 'Verification failed', message);
    return {
      ok: false,
      appId: profileName,
      verified: false,
      proxyReachable: false,
      configPresent: false,
      detail: message,
      error: message,
    };
  }
}
