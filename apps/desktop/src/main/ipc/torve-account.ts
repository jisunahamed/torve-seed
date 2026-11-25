/** Torve Cloud credentials and PKCE state never leave the Electron main process. */
import { BrowserWindow, ipcMain, safeStorage, shell } from 'electron';
import { hostname } from 'node:os';
import {
  clearDirectCloudActivity,
  getDirectCloudActivity,
  setDirectCloudActivitySink,
  startTorveCloudProxy,
  torveCloudProxyStatus,
} from '../torve-cloud/proxy.js';
import { refreshTorveCloudModels, setTorveModelsUpdatedSink, torveCloudModelsStatus } from '../torve-cloud/models.js';
import { invalidateSystemProxyProfilesCache, prewarmSystemProxyProfiles } from './system-proxy.js';
import {
  refreshCatalogConfigsIfConnected,
  refreshCodexCatalogIfConnected,
  startTorveCloudProfiles,
  stopTorveCloudProfiles,
  torveCloudProfilesState,
} from '../torve-cloud/profiles.js';
import { getDirectCloudOverrides, setDirectCloudOverride } from '../torve-cloud/overrides.js';
import {
  antigravityStandaloneStatus,
  disableAntigravityStandalonePatch,
  enableAntigravityStandalonePatch,
} from '../torve-cloud/antigravity-standalone-patch.js';
import {
  discardDirectCloudBackup,
  listDirectCloudBackups,
  restoreDirectCloudBackup,
} from '../torve-cloud/backups.js';
import {
  clearStoredCredentials,
  DEFAULT_CREDENTIALS_PATHS,
  isSafeStorageAvailable,
  readStoredCredentials,
  toTorveAccountStatus,
  writeStoredCredentials,
  type StoredCredentials,
  type TorveAccountStatus,
} from '../torve-cloud/credentials-store.js';
import {
  buildDesktopAuthUrl,
  DesktopApiError,
  exchangeDesktopAuthCode,
  fetchDesktopMe,
  fetchDesktopUsage,
  generatePkcePair,
  revokeDesktopAuthKey,
  startLoopbackPkceServer,
  type DesktopAuthMode,
  type DesktopKeyMeta,
  type DesktopMeResponse,
  type DesktopUsageRange,
  type DesktopUsageResponse,
  type DesktopUsageScope,
  type DesktopUserMeta,
  type LoopbackPkceHandle,
} from '../torve-cloud/desktop-api.js';
import { getLocalUsageSummary } from '../torve-cloud/usage.js';

export type { TorveAccountStatus };

export type TorveAuthEvent = {
  status: 'pending' | 'connected' | 'cancelled' | 'error';
  error?: string;
  code?: string;
  statusCode?: number;
  accountStatus?: TorveAccountStatus;
  me?: DesktopMeResponse | null;
};

type PendingPkceSession = {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  deviceName: string;
  handle: LoopbackPkceHandle;
  errorReported: boolean;
};

// PKCE code_verifier and state stay strictly in main-process memory only.
let pendingPkce: PendingPkceSession | null = null;
let cachedMe: DesktopMeResponse | null = null;

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
}

function emitAuthEvent(event: TorveAuthEvent): void {
  broadcast('torve:auth-event', event);
}

function errorDetails(err: unknown): { message: string; code?: string; statusCode?: number } {
  if (err instanceof DesktopApiError) {
    return { message: err.message, code: err.code ?? undefined, statusCode: err.status };
  }
  return { message: err instanceof Error ? err.message : String(err) };
}

function cachedMeFromStored(stored: StoredCredentials): DesktopMeResponse | null {
  if (!stored.userMeta && !stored.email && !stored.keyMeta) return null;
  return {
    user: stored.userMeta ?? { id: null, email: stored.email, name: null, plan: null, status: null },
    key: stored.keyMeta ?? { id: null, name: null, prefix: null, createdAt: null },
    quota: {
      usedTokensToday: 0,
      usedRequestsToday: 0,
      dailyTokenLimit: null,
      dailyRequestLimit: null,
      rateLimitStatus: 'ok',
      resetsAt: null,
      monthlyUsedTokens: null,
      monthlyAllowanceTokens: null,
      monthlyUsedRequests: null,
      monthlyAllowanceRequests: null,
    },
  };
}

async function finalizeAuthenticatedSession(params: {
  apiKey: string;
  authMode: DesktopAuthMode;
  email: string | null;
  keyMeta: DesktopKeyMeta | null;
  userMeta: DesktopUserMeta | null;
  preloadedMe?: DesktopMeResponse | null;
  preloadedModels?: Awaited<ReturnType<typeof refreshTorveCloudModels>> | null;
}): Promise<{ status: TorveAccountStatus; me: DesktopMeResponse | null }> {
  await writeStoredCredentials(safeStorage, {
    apiKey: params.apiKey,
    authMode: params.authMode,
    email: params.email,
    keyMeta: params.keyMeta,
    userMeta: params.userMeta,
  });

  const mePromise = params.preloadedMe
    ? Promise.resolve(params.preloadedMe)
    : fetchDesktopMe(params.apiKey).catch(() => null);
  const modelsPromise = params.preloadedModels
    ? Promise.resolve(params.preloadedModels)
    : refreshTorveCloudModels(params.apiKey, { force: true }).catch(() => null);

  const [me, models] = await Promise.all([mePromise, modelsPromise]);

  if (me) {
    cachedMe = me;
    await writeStoredCredentials(safeStorage, {
      apiKey: params.apiKey,
      authMode: params.authMode,
      email: me.user.email ?? params.email,
      keyMeta: me.key,
      userMeta: me.user,
    });
  } else {
    cachedMe = {
      user: params.userMeta ?? { id: null, email: params.email, name: null, plan: null, status: null },
      key: params.keyMeta ?? { id: null, name: null, prefix: null, createdAt: null },
      quota: {
        usedTokensToday: 0,
        usedRequestsToday: 0,
        dailyTokenLimit: null,
        dailyRequestLimit: null,
        rateLimitStatus: 'ok',
        resetsAt: null,
        monthlyUsedTokens: null,
        monthlyAllowanceTokens: null,
        monthlyUsedRequests: null,
        monthlyAllowanceRequests: null,
      },
    };
  }

  await startTorveCloudProxy();
  if (models) {
    await refreshCodexCatalogIfConnected(models);
    await refreshCatalogConfigsIfConnected(models);
  }

  return {
    status: await getTorveAccountStatus(),
    me: cachedMe,
  };
}

function cancelPendingPkce(silent = false): void {
  const active = pendingPkce;
  pendingPkce = null;
  if (!active) return;
  active.handle.cancel('Sign-in was cancelled.');
  if (!silent) {
    emitAuthEvent({ status: 'cancelled' });
  }
}

/** Used exclusively by the direct-cloud loopback proxy. */
export async function getTorveCloudApiKey(): Promise<string | null> {
  return (await readStoredCredentials(safeStorage, DEFAULT_CREDENTIALS_PATHS))?.apiKey ?? null;
}

export async function getTorveAccountStatus(): Promise<TorveAccountStatus> {
  const stored = await readStoredCredentials(safeStorage, DEFAULT_CREDENTIALS_PATHS);
  return toTorveAccountStatus(stored, isSafeStorageAvailable(safeStorage));
}

/** Start an existing secure account after Electron's safeStorage is ready. */
export async function resumeTorveCloudProxy(): Promise<void> {
  // Pre-warm app profile & Antigravity standalone status off the UI critical path
  // so opening the Apps tab renders immediately from cache.
  prewarmSystemProxyProfiles();
  void antigravityStandaloneStatus().catch(() => {});

  const apiKey = await getTorveCloudApiKey();
  if (!apiKey) return;
  await startTorveCloudProxy();
  // Pre-warm the model catalog on startup so Connected Apps and Models & Usage never show (0 models).
  void refreshTorveCloudModels(apiKey).then(async (models) => {
    await refreshCodexCatalogIfConnected(models);
    await refreshCatalogConfigsIfConnected(models);
  }).catch(() => {});
  const state = await torveCloudProfilesState();
  if (state.activeProfileNames.length > 0) await startTorveCloudProfiles(state.activeProfileNames);
}

export function registerTorveAccountIpc(): void {
  setDirectCloudActivitySink((activity) => {
    broadcast('direct-cloud:activity', activity);
  });
  setTorveModelsUpdatedSink((status) => {
    broadcast('torve:models-updated', status);
  });

  ipcMain.handle('torve:account-get', getTorveAccountStatus);

  ipcMain.handle('torve:account-pkce-start', async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      cancelPendingPkce(true);
      const pkce = generatePkcePair();
      const deviceName = hostname() || 'Torve Desktop';
      let session!: PendingPkceSession;

      const handle = await startLoopbackPkceServer({
        expectedState: pkce.state,
        onCode: async (code, redirectUri) => {
          if (pendingPkce !== session || session.state !== pkce.state) {
            throw new Error('This login session is no longer active.');
          }
          try {
            const exchanged = await exchangeDesktopAuthCode({
              code,
              codeVerifier: session.codeVerifier,
              redirectUri,
              deviceName: session.deviceName,
            });
            pendingPkce = null;
            const finalized = await finalizeAuthenticatedSession({
              apiKey: exchanged.apiKey,
              authMode: 'oauth',
              email: exchanged.user.email,
              keyMeta: exchanged.key,
              userMeta: exchanged.user,
            });
            emitAuthEvent({
              status: 'connected',
              accountStatus: finalized.status,
              me: finalized.me,
            });
            const win = BrowserWindow.getAllWindows()[0];
            if (win) {
              if (win.isMinimized()) win.restore();
              win.focus();
            }
          } catch (err) {
            session.errorReported = true;
            if (pendingPkce === session) pendingPkce = null;
            const details = errorDetails(err);
            emitAuthEvent({
              status: 'error',
              error: details.message,
              code: details.code,
              statusCode: details.statusCode,
            });
            throw err;
          }
        },
        onError: (message) => {
          if (pendingPkce === session) pendingPkce = null;
          if (session.errorReported) return;
          emitAuthEvent({ status: 'error', error: message });
        },
      });

      session = {
        state: pkce.state,
        codeVerifier: pkce.codeVerifier,
        redirectUri: handle.redirectUri,
        deviceName,
        handle,
        errorReported: false,
      };
      pendingPkce = session;

      const authUrl = buildDesktopAuthUrl({
        redirectUri: handle.redirectUri,
        state: pkce.state,
        codeChallenge: pkce.codeChallenge,
        deviceName,
      });
      emitAuthEvent({ status: 'pending' });
      await shell.openExternal(authUrl);
      return { ok: true };
    } catch (err) {
      cancelPendingPkce(true);
      const details = errorDetails(err);
      emitAuthEvent({
        status: 'error',
        error: details.message,
        code: details.code,
        statusCode: details.statusCode,
      });
      return { ok: false, error: details.message };
    }
  });

  ipcMain.handle('torve:account-pkce-cancel', (): { ok: boolean } => {
    cancelPendingPkce(false);
    return { ok: true };
  });

  ipcMain.handle(
    'torve:account-set',
    async (_event, payload: unknown): Promise<{
      ok: boolean;
      error?: string;
      statusCode?: number;
      status?: TorveAccountStatus;
      me?: DesktopMeResponse | null;
    }> => {
      try {
        const raw = payload as Partial<{ apiKey: unknown; email: unknown }>;
        const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '';
        const email = typeof raw.email === 'string' ? raw.email.trim() || null : null;
        if (!apiKey) return { ok: false, error: 'Paste your Torve API key.' };

        // Validate manual key via both GET /api/desktop/me and GET /v1/models before persisting.
        const [me, models] = await Promise.all([
          fetchDesktopMe(apiKey),
          refreshTorveCloudModels(apiKey, { force: true }),
        ]);

        const finalized = await finalizeAuthenticatedSession({
          apiKey,
          authMode: 'manual',
          email: me.user.email ?? email,
          keyMeta: me.key,
          userMeta: me.user,
          preloadedMe: me,
          preloadedModels: models,
        });
        return { ok: true, status: finalized.status, me: finalized.me };
      } catch (err) {
        const details = errorDetails(err);
        return { ok: false, error: details.message, statusCode: details.statusCode };
      }
    },
  );

  ipcMain.handle('torve:account-clear', async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      cancelPendingPkce(true);
      const existing = await readStoredCredentials(safeStorage, DEFAULT_CREDENTIALS_PATHS);
      if (existing?.apiKey && existing.authMode === 'oauth') {
        await revokeDesktopAuthKey(existing.apiKey).catch(() => ({ revoked: false }));
      }
      cachedMe = null;
      await stopTorveCloudProfiles();
      await clearStoredCredentials(DEFAULT_CREDENTIALS_PATHS);
      emitAuthEvent({ status: 'cancelled' });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('torve:me-get', async (): Promise<{
    ok: boolean;
    connected: boolean;
    cached?: boolean;
    error?: string;
    me: DesktopMeResponse | null;
  }> => {
    const stored = await readStoredCredentials(safeStorage, DEFAULT_CREDENTIALS_PATHS);
    if (!stored) {
      cachedMe = null;
      return { ok: true, connected: false, me: null };
    }
    try {
      const me = await fetchDesktopMe(stored.apiKey);
      cachedMe = me;
      await writeStoredCredentials(safeStorage, {
        apiKey: stored.apiKey,
        authMode: stored.authMode,
        email: me.user.email ?? stored.email,
        keyMeta: me.key,
        userMeta: me.user,
      }).catch(() => {});
      return { ok: true, connected: true, me };
    } catch (err) {
      const fallbackMe = cachedMe ?? cachedMeFromStored(stored);
      return {
        ok: false,
        connected: true,
        cached: Boolean(fallbackMe),
        error: err instanceof Error ? err.message : String(err),
        me: fallbackMe,
      };
    }
  });

  ipcMain.handle(
    'torve:usage-get',
    async (
      _event,
      params?: { range?: unknown; scope?: unknown },
    ): Promise<{ ok: boolean; usage: DesktopUsageResponse; fallback?: boolean; error?: string }> => {
      const range: DesktopUsageRange = params?.range === '24h' || params?.range === '30d' ? params.range : '7d';
      const scope: DesktopUsageScope | 'local' = params?.scope === 'key' || params?.scope === 'local' ? params.scope : 'account';

      if (scope === 'local') {
        return { ok: true, usage: await getLocalUsageSummary(range) };
      }
      const apiKey = await getTorveCloudApiKey();
      if (!apiKey) {
        return {
          ok: true,
          usage: await getLocalUsageSummary(range),
          fallback: true,
          error: 'Sign in to fetch cloud usage.',
        };
      }
      try {
        const usage = await fetchDesktopUsage(apiKey, { range, scope });
        return { ok: true, usage };
      } catch (err) {
        return {
          ok: true,
          usage: await getLocalUsageSummary(range),
          fallback: true,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  ipcMain.handle('torve:models-get', async () => {
    const current = await torveCloudModelsStatus();
    if (current.models.length === 0) {
      const key = await getTorveCloudApiKey();
      if (key) {
        try {
          await refreshTorveCloudModels(key);
        } catch {
          // Keep empty cached payload if upstream is unreachable.
        }
        return torveCloudModelsStatus();
      }
    }
    return current;
  });
  ipcMain.handle('torve:models-refresh', async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const key = await getTorveCloudApiKey();
      if (!key) throw new Error('Connect a Torve account first.');
      const models = await refreshTorveCloudModels(key, { force: true });
      await refreshCodexCatalogIfConnected(models);
      await refreshCatalogConfigsIfConnected(models);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('torve:proxy-status', torveCloudProxyStatus);
  ipcMain.handle('torve:antigravity-standalone-status', (_event, opts?: { bypassCache?: boolean }) => (
    antigravityStandaloneStatus({ bypassCache: opts?.bypassCache === true })
  ));
  ipcMain.handle('torve:antigravity-standalone-set', async (_event, enabled: unknown) => {
    try {
      if (enabled === true) {
        if (!await getTorveCloudApiKey()) {
          throw new Error('Connect a Torve account before enabling the Antigravity native picker.');
        }
        await startTorveCloudProxy();
        const status = await enableAntigravityStandalonePatch();
        invalidateSystemProxyProfilesCache();
        return { ok: true, status };
      }
      if (enabled === false) {
        const status = await disableAntigravityStandalonePatch();
        invalidateSystemProxyProfilesCache();
        return { ok: true, status };
      }
      throw new Error('Invalid Antigravity patch state.');
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        status: await antigravityStandaloneStatus(),
      };
    }
  });

  ipcMain.handle('torve:overrides-get', getDirectCloudOverrides);
  ipcMain.handle('torve:override-set', async (_event, appId: unknown, value: unknown) => {
    try {
      if (typeof appId !== 'string') throw new Error('Invalid connected app.');
      const record = value && typeof value === 'object' ? value as Record<string, unknown> : null;
      const override = record && typeof record['modelId'] === 'string'
        ? { modelId: record['modelId'], enabled: record['enabled'] !== false }
        : null;
      return { ok: true, overrides: await setDirectCloudOverride(appId, override) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('torve:activity-get', getDirectCloudActivity);
  ipcMain.handle('torve:activity-clear', () => {
    clearDirectCloudActivity();
    return { ok: true };
  });

  ipcMain.handle('torve:direct-state', torveCloudProfilesState);
  ipcMain.handle(
    'torve:direct-start',
    async (
      _event,
      profiles: unknown,
    ): Promise<{ ok: boolean; state?: Awaited<ReturnType<typeof torveCloudProfilesState>>; error?: string }> => {
      try {
        const state = await startTorveCloudProfiles(
          Array.isArray(profiles) ? profiles.filter((name): name is string => typeof name === 'string') : [],
        );
        invalidateSystemProxyProfilesCache();
        return { ok: true, state };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );
  ipcMain.handle(
    'torve:direct-stop',
    async (): Promise<{ ok: boolean; state?: Awaited<ReturnType<typeof torveCloudProfilesState>>; error?: string }> => {
      try {
        const state = await stopTorveCloudProfiles();
        invalidateSystemProxyProfilesCache();
        return { ok: true, state };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle('torve:backups-list', () => listDirectCloudBackups());
  ipcMain.handle('torve:backups-restore', async (_event, appId: unknown): Promise<{ ok: boolean; restored: boolean; error?: string }> => {
    try {
      if (typeof appId !== 'string' || !appId.trim()) throw new Error('Invalid app identifier.');
      const current = await torveCloudProfilesState();
      if (current.activeProfileNames.includes(appId)) {
        const remaining = current.activeProfileNames.filter((name) => name !== appId);
        if (remaining.length > 0) {
          await startTorveCloudProfiles(remaining);
        } else {
          await stopTorveCloudProfiles();
        }
      }
      const restored = await restoreDirectCloudBackup(appId, { forceExact: true });
      return { ok: true, restored };
    } catch (err) {
      return { ok: false, restored: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('torve:backups-discard', async (_event, appId: unknown): Promise<{ ok: boolean; error?: string }> => {
    try {
      if (typeof appId !== 'string' || !appId.trim()) throw new Error('Invalid app identifier.');
      await discardDirectCloudBackup(appId);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
