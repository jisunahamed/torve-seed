/**
 * IPC surface for the 6 connected apps: profile discovery (`installed` status,
 * icons, launch targets), per-app launch overrides, and app restarts.
 */
import { ipcMain, shell } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { desktopSystemProxyCliDataDir } from '../dev-instance.js';
import { resolveConnectDataDir } from '../paths.js';
import {
  invalidateInstalledAppsCache,
} from '../connected-apps/installed.js';
import {
  type AppLaunchTarget,
  normalizeToolSlugs,
  setAppIdentitySetting,
  setAppLaunchSetting,
} from '../connected-apps/launch-settings.js';
import {
  appTargetNeedsRestart,
  restartAppTarget,
} from '../connected-apps/launcher.js';
import {
  effectiveLaunchTargetAsync,
  effectiveToolSlugs,
  launchTargetIcon,
  readInstalledAppTarget,
  syncCustomAppDisplay,
} from '../connected-apps/profile-targets.js';
import { isConfigPatchProfileInstalled } from '../system-proxy/config-patch.js';
import { systemProxyCaPath } from '../system-proxy/paths.js';
import {
  SYSTEM_PROXY_PROFILES,
} from '../system-proxy/profiles.js';
import { antigravityStandaloneStatus } from '../torve-cloud/antigravity-standalone-patch.js';
import { updateDesktopTray } from '../ui/tray.js';

const PROFILES_CACHE_TTL_MS = 30_000;
const PROFILE_PROBE_TIMEOUT_MS = 1_500;

type ProfileRow = Record<string, unknown>;
let cachedProfiles: { at: number; data: ProfileRow[] } | null = null;
let profilesInFlight: Promise<ProfileRow[]> | null = null;

export function invalidateSystemProxyProfilesCache(): void {
  cachedProfiles = null;
}

export function prewarmSystemProxyProfiles(): void {
  if (cachedProfiles || profilesInFlight) return;
  const run = buildProfilesSnapshot(false).catch(() => []).finally(() => {
    if (profilesInFlight === run) profilesInFlight = null;
  });
  profilesInFlight = run;
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

async function buildProfilesSnapshot(refresh: boolean): Promise<ProfileRow[]> {
  if (refresh) invalidateInstalledAppsCache();

  const settled = await Promise.allSettled(SYSTEM_PROXY_PROFILES.map(async (profile) => {
    const launchTarget = await withTimeout(
      effectiveLaunchTargetAsync(profile.name, { refresh }),
      PROFILE_PROBE_TIMEOUT_MS,
      null,
    );
    const [iconDataUri, needsRestart, antigravityInstalled] = await Promise.all([
      launchTarget ? withTimeout(launchTargetIcon(launchTarget.path), PROFILE_PROBE_TIMEOUT_MS, null) : Promise.resolve(null),
      launchTarget ? withTimeout(appTargetNeedsRestart(launchTarget, null), PROFILE_PROBE_TIMEOUT_MS, false) : Promise.resolve(false),
      profile.name === 'antigravity'
        ? withTimeout(antigravityStandaloneStatus().then((s) => s.installed), PROFILE_PROBE_TIMEOUT_MS, false)
        : Promise.resolve(false),
    ]);
    const installed = Boolean(launchTarget)
      || antigravityInstalled
      || (profile.configPatch ? isConfigPatchProfileInstalled(profile.configPatch, Boolean(launchTarget)) : false);
    return {
      name: profile.name,
      displayName: profile.label,
      kind: profile.kind,
      method: profile.method,
      domains: profile.domains,
      appAction: profile.appAction,
      openUrl: profile.openUrl,
      toolName: profile.toolName,
      canRestart: Boolean(launchTarget),
      needsRestart,
      installed,
      toolSlugs: effectiveToolSlugs(profile.name, profile.toolSlugs, profile.label),
      ...(iconDataUri ? { iconDataUri } : {}),
      ...(launchTarget ? { launchAppName: launchTarget.name } : {}),
    };
  }));

  const rows: ProfileRow[] = [];
  for (const res of settled) {
    if (res.status === 'fulfilled') rows.push(res.value);
  }
  cachedProfiles = { at: Date.now(), data: rows };
  return rows;
}

export function registerSystemProxyIpc(): void {
  ipcMain.handle('system-proxy:list-profiles', async (_event, opts?: { refresh?: boolean }) => {
    const forceRefresh = opts?.refresh === true;
    if (!forceRefresh && cachedProfiles && Date.now() - cachedProfiles.at < PROFILES_CACHE_TTL_MS) {
      return cachedProfiles.data;
    }
    if (!forceRefresh && profilesInFlight) {
      return profilesInFlight;
    }
    const run = buildProfilesSnapshot(forceRefresh).finally(() => {
      if (profilesInFlight === run) profilesInFlight = null;
    });
    profilesInFlight = run;
    return run;
  });

  ipcMain.handle('system-proxy:set-app-launch', async (_event, opts: { name?: string; app?: { name?: string; path?: string } | null }) => {
    const name = typeof opts?.name === 'string' ? opts.name : '';
    if (!SYSTEM_PROXY_PROFILES.some((profile) => profile.name === name)) {
      return { ok: false, error: 'Unknown app.' };
    }
    const picked = opts?.app;
    let target: AppLaunchTarget | null = null;
    if (picked !== null && picked !== undefined) {
      target = readInstalledAppTarget(picked);
      if (!target) return { ok: false, error: 'That application could not be found.' };
    }
    setAppLaunchSetting(resolveConnectDataDir(), name, target);
    await syncCustomAppDisplay(name, target);
    invalidateSystemProxyProfilesCache();
    updateDesktopTray();
    return { ok: true };
  });

  ipcMain.handle('system-proxy:set-app-identity', (_event, opts: { name?: string; toolSlugs?: unknown }) => {
    const name = typeof opts?.name === 'string' ? opts.name : '';
    if (!SYSTEM_PROXY_PROFILES.some((profile) => profile.name === name)) {
      return { ok: false, error: 'Unknown app.' };
    }
    const raw = opts?.toolSlugs;
    if (raw !== null && raw !== undefined && !Array.isArray(raw)) {
      return { ok: false, error: 'Client names must be a list.' };
    }
    const slugs = Array.isArray(raw)
      ? normalizeToolSlugs(raw.filter((entry): entry is string => typeof entry === 'string'))
      : null;
    setAppIdentitySetting(resolveConnectDataDir(), name, slugs && slugs.length > 0 ? slugs : null);
    return { ok: true };
  });

  ipcMain.handle('system-proxy:restart-app', async (_event, opts: { app: string }) => {
    const profileName = typeof opts?.app === 'string' ? opts.app : '';
    const profile = SYSTEM_PROXY_PROFILES.find((item) => item.name === profileName);
    const target = await effectiveLaunchTargetAsync(profileName);
    if (!profile || !target) {
      return { ok: false, error: `No restart target configured for ${profileName || 'this profile'}.` };
    }
    const result = await restartAppTarget(target, {
      force: true,
      launchIfStopped: true,
    });
    return { ok: result.ok, ...(result.error ? { error: result.error } : {}) };
  });

  ipcMain.handle('system-proxy:ca-exists', () => {
    const dataDir = desktopSystemProxyCliDataDir() ?? resolveConnectDataDir();
    return existsSync(path.join(dataDir, 'system-proxy', 'ca.crt'))
      && existsSync(path.join(dataDir, 'system-proxy', 'ca.key'));
  });

  ipcMain.handle('system-proxy:ca-info', (): { path: string; exists: boolean } => {
    const caPath = systemProxyCaPath();
    return { path: caPath, exists: existsSync(caPath) };
  });

  ipcMain.handle('system-proxy:reveal-ca', (): { ok: boolean; error?: string } => {
    const caPath = systemProxyCaPath();
    if (!existsSync(caPath)) {
      return { ok: false, error: 'No certificate has been created yet.' };
    }
    shell.showItemInFolder(caPath);
    return { ok: true };
  });

  ipcMain.handle('system-proxy:get-state', () => null);
  ipcMain.handle('system-proxy:start', () => ({ ok: false, error: 'Custom MITM proxy is disabled in Direct Torve Cloud mode.' }));
  ipcMain.handle('system-proxy:stop', () => ({ ok: true, state: null }));
  ipcMain.handle('system-proxy:install-ca', () => ({ ok: false, error: 'Custom MITM proxy is disabled in Direct Torve Cloud mode.' }));
  ipcMain.handle('system-proxy:ca-trust-state', () => ({ ok: true, exists: false, trust: 'absent' as const }));
  ipcMain.handle('system-proxy:add-custom-app', () => ({ ok: false, error: 'Custom MITM proxy apps are disabled in Direct Torve Cloud mode.' }));
  ipcMain.handle('system-proxy:remove-custom-app', () => ({ ok: false, error: 'Custom MITM proxy apps are disabled in Direct Torve Cloud mode.' }));
}
