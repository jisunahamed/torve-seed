import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
} from 'electron';
import { execFileSync } from 'node:child_process';
import {
  ProcessManager,
  type RuntimeMode,
  type RuntimeProcessState,
  type StartOptions,
} from './runtime/process-manager.js';
import { registerPiChatHandlers } from './chat/engine.js';
import { setClaudeDesktopGatewayModelSource } from './connected-apps/claude-desktop-gateway.js';
import { emitChatEvent } from './chat/event-bus.js';
import { createTelegramBridge } from './telegram/bridge.js';
import { ensureSecureIdentity, getSecureIdentity, hasStoredIdentity, secureIdentityEnv } from './identity.js';
import type { LogEvent, RuntimeActivityEvent } from './runtime/log-parser.js';
import { parseRuntimeActivityFromLog } from './runtime/log-parser.js';
import {
  setPluginAppendLog,
  ensureDefaultPlugin,
} from './runtime/plugins.js';
import {
  onPeersChanged,
} from './runtime/peer-cache.js';
import {
  createWindow,
  createApplicationMenu,
  getMainWindow,
} from './ui/window.js';
import { createDesktopTray } from './ui/tray.js';
import { ensureConfig } from './runtime/config-io.js';
import { registerAttachmentScheme, installAttachmentProtocol } from './chat/attachments/protocol.js';
import { disableSandboxIfAppImageCannotSandbox } from './linux-sandbox.js';
import {
  APP_ICON_PATH,
  APP_NAME,
  INTERNAL_APP_NAME,
  TRAY_ICON_PATH,
  errorDetails,
  errorMessage,
  isDesktopDebugEnabled,
  isDev,
  rendererUrl,
  type InstallUpdateResult,
} from './app-context.js';
import {
  checkForUpdates,
  downloadUpdate,
  getTorveUpdater,
  installDownloadedUpdate,
  onUpdaterStateChange,
  type TorveUpdaterState,
} from './torve-cloud/updater.js';
import {
  buildSystemProxyTrayMenu,
  clearSystemProxySettings,
  clearSystemProxyTransportSettings,
  getActiveSystemProxyState,
  initSystemProxyRuntime,
  loadPersistedSystemProxyState,
  refreshTrayMenu,
  restoreSystemProxyProfilesAtLaunch,
  startSystemProxyWatchdog,
  stopManagedRuntimes,
} from './system-proxy/runtime.js';
import { LOCALHOST_URL } from './constants.js';
import { registerAppIpc } from './ipc/app.js';
import { registerDesktopIpc } from './ipc/desktop.js';
import { registerFloatIpc } from './ipc/float.js';
import { registerStakingIpc } from './ipc/staking.js';
import { stakingSessions } from './staking/portal.js';
import { registerPaymentsIpc } from './ipc/payments.js';
import { registerRuntimeIpc } from './ipc/runtime.js';
import { registerSystemProxyIpc } from './ipc/system-proxy.js';
import { registerTelegramIpc } from './ipc/telegram.js';
import { registerPublicTunnelIpc } from './ipc/public-tunnel.js';
import { registerTorveAccountIpc, resumeTorveCloudProxy } from './ipc/torve-account.js';
import {
  effectiveLaunchTarget,
} from './connected-apps/profile-targets.js';
import {
  stopPaymentsPortal,
} from './payments/portal.js';
import { ACTIVE_CONFIG_PATH } from './runtime/active-config.js';
import {
  restoreOsSystemProxySync,
} from './system-proxy/os-settings.js';
import {
  DEFAULT_SYSTEM_PROXY_PORT,
} from './system-proxy/profiles.js';
import { resolveBuyerProxyPort } from './runtime/active-config.js';
import { createTelemetryService } from './telemetry/telemetry.js';
import { setTelemetryService } from './telemetry/runtime.js';
import { firstChatDepositSnapshot } from './telemetry/events.js';
import { refreshCreditsInfo } from './payments/credits.js';

// Re-export types that may be used by other main-process modules
export type { LogEvent, RuntimeActivityEvent } from './runtime/log-parser.js';
export type { DashboardNetworkPeer, DashboardNetworkStats, DashboardNetworkResult } from './runtime/peer-cache.js';
export type { InstalledPlugin } from './runtime/plugins.js';

// Internal runtime name — NEVER change this value. On macOS the safeStorage
// encryption key lives in the "<app.setName value> Safe Storage" keychain
// entry, and the default userData path derives from it too. Renaming it
// rotates the key and orphans every existing identity.enc. User-visible
// surfaces use APP_NAME below instead.

let isQuitting = false;
let isInstallingUpdate = false;

let telemetryReady = Promise.resolve<Awaited<ReturnType<typeof createTelemetryService>> | null>(null);

function initializeTelemetry(hadExistingIdentity: boolean): Promise<Awaited<ReturnType<typeof createTelemetryService>> | null> {
  return createTelemetryService({
    userDataDir: app.getPath('userData'),
    isDev,
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    getDistinctId: () => getSecureIdentity()?.wallet.address ?? null,
    hadExistingIdentity,
  }).then(async (service) => {
    setTelemetryService(service);
    await service.recordAppStarted();
    return service;
  }).catch(() => null);
}

async function recordTelemetryCleanShutdown(): Promise<void> {
  const telemetry = await telemetryReady;
  await telemetry?.recordCleanShutdown();
}

// The `torve-attachment://` scheme must be registered as privileged
// *before* `app.whenReady()` fires. The actual request handler is wired
// inside whenReady() once Electron's protocol module is usable.
registerAttachmentScheme();

disableSandboxIfAppImageCannotSandbox();

const logBuffer: LogEvent[] = [];
let lastRuntimeActivityHash = '';

/**
 * Kill any leftover process still listening on the buyer proxy port after the
 * desktop's own runtime child was stopped. The CLI reuses a compatible
 * listener instead of failing on EADDRINUSE, so an orphaned runtime from an
 * earlier session can keep the proxy alive — chats keep working and the UI
 * reads as connected even though Stop was pressed. Only processes from our
 * own runtime family (node/torve/electron) are reaped.
 */
async function killOrphanBuyerProxy(): Promise<void> {
  if (process.platform === 'win32') return;
  try {
    const port = await resolveBuyerProxyPort();
    const out = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const pids = out
      .split(/\s+/)
      .map((raw) => Number(raw))
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
    for (const pid of pids) {
      let command = '';
      try {
        command = execFileSync('ps', ['-o', 'comm=', '-p', String(pid)], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
      } catch {
        continue; // Already gone.
      }
      if (!/node|torve|electron/i.test(command)) continue;
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // Already gone.
      }
    }
  } catch {
    // lsof unavailable or nothing listening — nothing to reap.
  }
}

async function requestBuyerPeerRefresh(): Promise<void> {
  const port = await resolveBuyerProxyPort();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(`${LOCALHOST_URL}:${port}/_torve/peers/refresh`, {
      method: 'POST',
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: Record<string, unknown> = {};
    try {
      payload = text ? JSON.parse(text) as Record<string, unknown> : {};
    } catch {
      payload = {};
    }

    if (!response.ok || payload['ok'] !== true) {
      const error = typeof payload['error'] === 'string' && payload['error'].trim().length > 0
        ? payload['error']
        : `Buyer proxy returned HTTP ${response.status}`;
      throw new Error(error);
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Timed out refreshing peers via buyer proxy on port ${port}`);
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Unable to refresh peers via buyer proxy on port ${port}: ${message}`);
  } finally {
    clearTimeout(timer);
  }
}

// ── Runtime Activity & Log Wiring ──

function emitRuntimeActivity(activity: RuntimeActivityEvent): void {
  const hash = [
    activity.mode,
    activity.stage,
    activity.tone,
    activity.message,
    activity.requestId ?? '',
    activity.peerId ?? '',
  ].join('|');

  if (hash === lastRuntimeActivityHash) {
    return;
  }
  lastRuntimeActivityHash = hash;
  getMainWindow()?.webContents.send('runtime:activity', activity);
}

function emitRuntimeState(): void {
  getMainWindow()?.webContents.send('runtime:state', getCombinedProcessState());
  refreshTrayMenu();
}

function appendLog(mode: RuntimeMode, stream: 'stdout' | 'stderr' | 'system', line: string): void {
  const event: LogEvent = { mode, stream, line, timestamp: Date.now() };
  logBuffer.push(event);
  if (logBuffer.length > 1200) {
    logBuffer.splice(0, logBuffer.length - 1200);
  }

  getMainWindow()?.webContents.send('runtime:log', event);
  const activity = parseRuntimeActivityFromLog(event);
  if (activity) {
    emitRuntimeActivity(activity);
  }
  emitRuntimeState();
  if (mode === 'system-proxy' && stream === 'system' && /^Process exited|^Started system-proxy/.test(line)) {
    refreshTrayMenu();
  }
}

let p2pRouterPluginInstall: Promise<void> | null = null;

/** P2P is optional. Keep its plugin bootstrap out of the Direct Cloud launch
 * path, while still repairing/installing it before an explicit P2P start. */
function ensureP2PRouterPlugin(): Promise<void> {
  if (p2pRouterPluginInstall) return p2pRouterPluginInstall;

  p2pRouterPluginInstall = ensureDefaultPlugin('@torveai/router-local', {
    getAppSetupNeeded: () => false,
    setAppSetupNeeded: () => {},
    getAppSetupComplete: () => false,
    setAppSetupComplete: () => {},
    // P2P setup errors belong to the action that requested P2P; they must not
    // replace the already-open Direct Cloud UI with the first-run splash.
    getMainWindow: () => null,
    appendLog,
  }).finally(() => {
    p2pRouterPluginInstall = null;
  });

  return p2pRouterPluginInstall;
}

// Wire up callbacks for extracted modules
setPluginAppendLog(appendLog);

// When the peer set changes, tell the renderer to refresh the service catalog.
onPeersChanged(() => {
  getMainWindow()?.webContents.send('peers:changed');
  refreshTrayMenu();
});
const processManager = new ProcessManager((mode, stream, line) => {
  appendLog(mode, stream, line);
});

initSystemProxyRuntime({
  appName: APP_NAME,
  appendLog,
  processManager,
  effectiveLaunchTarget: (profileName) => effectiveLaunchTarget(profileName),
});

// ── Payments Portal ──

async function stopDesktopServices(): Promise<void> {
  const { stopTorveCloudProxy } = await import('./torve-cloud/proxy.js');
  await Promise.all([telegramBridge.stop(), stopManagedRuntimes(), stopPaymentsPortal(), stakingSessions.stop(), stopTorveCloudProxy()]);
}

function getCombinedProcessState(): RuntimeProcessState[] {
  return processManager.getState();
}

// ── IPC handlers ──
// Each group lives in ipc/<domain>.ts; anything they need from this file is
// passed in rather than reached for.
registerPaymentsIpc();
registerStakingIpc();
registerDesktopIpc();
registerAppIpc();
registerFloatIpc();
registerTorveAccountIpc();
registerSystemProxyIpc({ processManager });
const publicTunnelRuntime = registerPublicTunnelIpc({ processManager });
registerRuntimeIpc({
  processManager,
  logBuffer,
  appendLog,
  getCombinedProcessState,
  killOrphanBuyerProxy,
  requestBuyerPeerRefresh,
  ensureP2PRouterPlugin,
});

// Allowlisted top-level keys that the renderer is permitted to update via IPC.
// Any key not in this set is stripped before the request is forwarded to the
// dashboard API, preventing a compromised renderer from overwriting arbitrary
// config fields.

// ── Credits / Deposits Balance ──

// ── Incoming USDC watcher + P2P relay sweep ──
//
// The buyer daemon owns the hot-wallet watcher: it polls the USDC balance,
// treats any increase as an incoming deposit (QR transfer or Coinbase Onramp
// delivery), signs an EIP-3009 authorization addressed to the
// TorveDepositRelay contract, and offers it to connected peers; a
// permissionless relayer submits it on-chain and earns the contract's fixed
// USDC fee (docs/protocol/spec/09-deposit-sweep.md). The hot wallet never
// needs ETH. While the in-app deposit panel is open, the renderer promotes
// the daemon's watcher to a fast cadence and mirrors its progress events
// (payments/deposit-sweep.ts).

// ── AI Chat IPC Handlers ──
const piChatEngine = registerPiChatHandlers({
  ipcMain,
  sendToRenderer: (channel, payload) => {
    getMainWindow()?.webContents.send(channel, payload);
    // Tee every chat event into the bus so the Telegram bridge can follow
    // stream deltas, completions, and tool-approval requests.
    emitChatEvent(channel, payload);
  },
  configPath: ACTIVE_CONFIG_PATH,
  isBuyerRuntimeRunning: () => getCombinedProcessState().some((state) => state.mode === "connect" && state.running),
  ensureBuyerRuntimeStarted: async () => {
    const connectState = getCombinedProcessState().find((state) => state.mode === 'connect');
    if (connectState?.running) {
      return true;
    }

    try {
      await ensureP2PRouterPlugin();
    } catch (error) {
      appendLog('connect', 'system', `P2P router plugin is unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }

    await ensureSecureIdentity();

    const startOptions: StartOptions = {
      mode: 'connect',
      router: 'local',
      ...(isDesktopDebugEnabled() ? { verbose: true } : {}),
      env: {
        ...(isDesktopDebugEnabled() ? { TORVE_DEBUG: '1' } : {}),
        ...secureIdentityEnv(),
      },
    };

    try {
      await processManager.start(startOptions);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.toLowerCase().includes('already running')) {
        return true;
      }
      appendLog('connect', 'system', `Chat-triggered buyer runtime start failed: ${message}`);
      return false;
    }
  },
  appendSystemLog: (line) => {
    appendLog("connect", "system", line);
  },
  recordFirstChatStarted: async (input) => {
    const telemetry = await telemetryReady;
    await telemetry?.recordFirstChatStarted(input, async () => {
      const credits = await refreshCreditsInfo();
      return firstChatDepositSnapshot(credits.balanceUsdc);
    });
  },
  recordFirstModelShown: async (input) => {
    const telemetry = await telemetryReady;
    await telemetry?.recordFirstModelShown(input);
  },
  recordModelSelected: async (input, selectionKey) => {
    const telemetry = await telemetryReady;
    await telemetry?.recordModelSelected(input, selectionKey);
  },
  recordChatRequestStarted: async (input) => {
    const telemetry = await telemetryReady;
    await telemetry?.recordChatRequestStarted(input);
  },
  recordChatRequestFinished: async (input) => {
    const telemetry = await telemetryReady;
    await telemetry?.recordChatRequestFinished(input);
  },
  recordDiscoveryFailed: async (input) => {
    const telemetry = await telemetryReady;
    await telemetry?.recordDiscoveryFailed(input);
  },
});

// The Claude Desktop gateway advertises the same curated picker rows the
// in-app dropdown (and Telegram bridge) offer, behind Claude's model ids.
setClaudeDesktopGatewayModelSource(() => (
  (piChatEngine.getModelPicker()?.models ?? []).map((model) => ({
    label: model.label,
    model: model.serviceId,
  }))
));

// ── Telegram bridge ──
const telegramBridge = createTelegramBridge({
  engine: piChatEngine,
  appendLog: (line) => { appendLog('connect', 'system', line); },
  onStatusChanged: (status) => {
    getMainWindow()?.webContents.send('telegram:status-changed', status);
  },
});

registerTelegramIpc({ telegramBridge });

/* ------------------------------------------------------------------ */
/*  Floating always-on-top pill window                                  */
/* ------------------------------------------------------------------ */

// Cache the latest display payload so a freshly opened float window can be
// primed before the main window's next periodic update.

app.whenReady().then(async () => {
  installAttachmentProtocol();
  app.setName(INTERNAL_APP_NAME);
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    iconPath: APP_ICON_PATH,
  });
  if (process.platform === 'darwin' && APP_ICON_PATH && app.dock) {
    app.dock.setIcon(APP_ICON_PATH);
  }
  const hadExistingIdentity = hasStoredIdentity();
  await ensureSecureIdentity();
  telemetryReady = initializeTelemetry(hadExistingIdentity);
  await telemetryReady;
  createApplicationMenu(APP_NAME, APP_ICON_PATH);

  // Ensure config.json exists before anything else (first launch).
  // Must complete before creating the window — the renderer auto-starts the
  // buyer runtime which needs config.json to find the router plugin.
  await ensureConfig(ACTIVE_CONFIG_PATH).catch(() => {});
  loadPersistedSystemProxyState();

  const showMainWindow = () => {
    const existingWindow = getMainWindow();
    if (existingWindow) {
      existingWindow.show();
      existingWindow.focus();
      return;
    }
    createWindow({ appName: APP_NAME, appIconPath: APP_ICON_PATH, isDev, rendererUrl });
    // Windows only, and the reason this is here rather than on `app`:
    // 'before-quit' is NOT emitted when the app goes down with an OS shutdown,
    // restart or logout, so this is the last chance to hand the proxy setting
    // back — and there is only time for the synchronous restore. Without it
    // the machine reboots into a system proxy pointing at nothing.
    getMainWindow()?.on('session-end', () => {
      restoreOsSystemProxySync();
    });
  };

  showMainWindow();

  void publicTunnelRuntime.restoreAtLaunch().then((result) => {
    if (result && !result.ok) {
      appendLog('tunnel', 'system', `Public tunnel auto-start failed: ${result.error ?? 'Unknown error'}`);
    }
  }).catch((err) => {
    appendLog('tunnel', 'system', `Public tunnel auto-start failed: ${err instanceof Error ? err.message : String(err)}`);
  });

  // Fail open before anything else. Whatever the OS proxy is set to right now
  // was left behind by the previous run — and if that run ended in a crash,
  // a force-quit or an OS shutdown, it still points at a proxy that is not
  // running, which is the whole machine offline. Restore it unconditionally
  // and let the reconnect below re-arm it only once a proxy really listens.
  // Fire-and-forget so clean launches don't block window creation on
  // networksetup/reg calls; only the state files differ between the two cases
  // (persisted state is the reconnect memory and must survive).
  const systemProxyFailOpen = (getActiveSystemProxyState()
    ? clearSystemProxyTransportSettings()
    : clearSystemProxySettings()
  ).catch((err) => {
    appendLog('system-proxy', 'system', `System Proxy cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
  });
  startSystemProxyWatchdog();

  const showFloatingWindow = () => {
    const win = getMainWindow();
    if (win) {
      win.webContents.send('desktop:open-floating-window');
      return;
    }
    showMainWindow();
    getMainWindow()?.webContents.once('did-finish-load', () => {
      getMainWindow()?.webContents.send('desktop:open-floating-window');
    });
  };

  const toggleMainConnection = () => {
    const running = getCombinedProcessState().some((state) => state.mode === 'connect' && state.running);
    getMainWindow()?.webContents.send(running ? 'desktop:disconnect-main' : 'desktop:connect-main');
  };

  createDesktopTray({
    appName: APP_NAME,
    iconPath: TRAY_ICON_PATH,
    onShow: showMainWindow,
    buildMenu: () => buildSystemProxyTrayMenu(showMainWindow, showFloatingWindow, toggleMainConnection),
  });
  refreshTrayMenu();

  const restoredState = getActiveSystemProxyState();
  const restoredProfiles = Array.isArray(restoredState?.['activeProfileNames'])
    ? restoredState['activeProfileNames'].filter((name: unknown): name is string => typeof name === 'string')
    : [];
  if (restoredProfiles.length > 0 && typeof restoredState?.['peerId'] === 'string') {
    const restorePeerId = restoredState['peerId'];
    const restoreDefaultModel = typeof restoredState['defaultModel'] === 'string'
      ? restoredState['defaultModel'] as string
      : undefined;
    // Sequenced after the fail-open above, or the clear could land after the
    // child has already re-armed the setting and silently disconnect it.
    void systemProxyFailOpen.then(() => restoreSystemProxyProfilesAtLaunch({
      peerId: restorePeerId,
      port: DEFAULT_SYSTEM_PROXY_PORT,
      profiles: restoredProfiles,
      defaultModel: restoreDefaultModel,
      servedModels: [],
      profileSwitch: true,
    })).catch((err) => {
      appendLog('system-proxy', 'system', `System Proxy auto-start failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  // Resume the Telegram bridge if a bot was connected in a previous session.
  // Needs app-ready because the token store decrypts via safeStorage.
  void telegramBridge.start().catch((err) => {
    appendLog('connect', 'system', `[telegram] Bridge resume failed: ${err instanceof Error ? err.message : String(err)}`);
  });
  void resumeTorveCloudProxy().catch((err) => {
    appendLog('connect', 'system', `Torve Cloud proxy could not resume: ${err instanceof Error ? err.message : String(err)}`);
  });

  // Payments portal starts lazily on first open (via payments:open-portal IPC)

  // Auto-update: check GitHub Releases via TorveUpdater 5 seconds after launch
  // and every 30 minutes thereafter. Downloads are opt-in: detection surfaces an
  // "Update available" banner and Settings action; the installer is verified via
  // PE (MZ) header + optional SHA-256 before spawning detached.
  type RendererUpdateStatusMeta = {
    phase?: TorveUpdaterState['phase'];
    currentVersion?: string;
    latestVersion?: string | null;
    lastCheckedAt?: number | null;
    releaseUrl?: string | null;
    assetName?: string | null;
    downloadPercent?: number;
    downloadedBytes?: number;
    totalBytes?: number;
    error?: string | null;
  };

  type RendererUpdateStatus = RendererUpdateStatusMeta & (
    | { status: 'idle'; version: string | null }
    | { status: 'checking'; version: string | null }
    | { status: 'up-to-date'; version: string | null }
    | { status: 'available'; version: string }
    | { status: 'downloading'; version: string; percent: number }
    | { status: 'ready'; version: string }
    | { status: 'installing'; version: string | null }
    | { status: 'error'; version: string | null; message: string; details: string; hint?: string }
  );

  const mapUpdaterState = (state: TorveUpdaterState): RendererUpdateStatus => {
    const meta: RendererUpdateStatusMeta = {
      phase: state.phase,
      currentVersion: state.currentVersion,
      latestVersion: state.latestVersion,
      lastCheckedAt: state.lastCheckedAt,
      releaseUrl: state.releaseUrl,
      assetName: state.assetName,
      downloadPercent: state.downloadPercent,
      downloadedBytes: state.downloadedBytes,
      totalBytes: state.totalBytes,
      error: state.error,
    };

    switch (state.phase) {
      case 'available':
        return { ...meta, status: 'available', version: state.latestVersion ?? state.currentVersion };
      case 'downloading':
        return {
          ...meta,
          status: 'downloading',
          version: state.latestVersion ?? state.currentVersion,
          percent: state.downloadPercent,
        };
      case 'ready':
        return { ...meta, status: 'ready', version: state.latestVersion ?? state.currentVersion };
      case 'installing':
        return { ...meta, status: 'installing', version: state.latestVersion };
      case 'error': {
        const message = state.error ?? 'Update failed.';
        return { ...meta, status: 'error', version: state.latestVersion, message, details: message };
      }
      case 'checking':
        return { ...meta, status: 'checking', version: state.latestVersion ?? state.currentVersion };
      case 'up-to-date':
        return { ...meta, status: 'up-to-date', version: state.latestVersion ?? state.currentVersion };
      case 'idle':
      default:
        return { ...meta, status: 'idle', version: state.latestVersion ?? state.currentVersion };
    }
  };

  const UPDATE_CHECK_INITIAL_DELAY_MS = 5_000;
  const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

  const torveUpdater = getTorveUpdater({
    currentVersion: app.getVersion(),
    onQuit: () => {
      isInstallingUpdate = true;
      isQuitting = true;
      app.quit();
    },
  });

  let updateCheckInterval: ReturnType<typeof setInterval> | null = null;

  onUpdaterStateChange((state) => {
    const mapped = mapUpdaterState(state);
    if (state.phase === 'error' && state.error) {
      appendLog('connect', 'system', `Auto-update error: ${state.error}`);
    } else if (state.phase === 'ready' && updateCheckInterval) {
      clearInterval(updateCheckInterval);
      updateCheckInterval = null;
    }
    getMainWindow()?.webContents.send('app:update-status', mapped);
  });

  ipcMain.handle('app:get-update-status', () => mapUpdaterState(torveUpdater.getState()));

  ipcMain.handle('app:check-for-updates', async (): Promise<RendererUpdateStatus> => {
    const state = await checkForUpdates({ silent: false });
    return mapUpdaterState(state);
  });

  ipcMain.handle('app:download-update', async (): Promise<InstallUpdateResult> => {
    const current = torveUpdater.getState();
    if (current.phase === 'downloading' || current.phase === 'ready') {
      return { ok: true };
    }
    const result = await downloadUpdate();
    if (!result.ok) {
      const msg = result.error ?? 'Failed to download update.';
      appendLog('connect', 'system', `Auto-update download failed: ${msg}`);
      return { ok: false, error: msg, details: msg };
    }
    return { ok: true };
  });

  ipcMain.handle('app:install-update', async (): Promise<InstallUpdateResult> => {
    if (isInstallingUpdate) {
      return { ok: true };
    }
    isInstallingUpdate = true;
    try {
      await Promise.allSettled([stopDesktopServices(), recordTelemetryCleanShutdown()]);
      restoreOsSystemProxySync();
      isQuitting = true;
      const result = await installDownloadedUpdate();
      if (!result.ok) {
        isInstallingUpdate = false;
        isQuitting = false;
        const msg = result.error ?? 'Failed to install downloaded update.';
        return { ok: false, error: msg, details: msg };
      }
      return { ok: true };
    } catch (err) {
      isInstallingUpdate = false;
      isQuitting = false;
      const msg = errorMessage(err);
      return { ok: false, error: msg, details: errorDetails(err) };
    }
  });

  const initialUpdateCheckTimer = setTimeout(() => {
    void checkForUpdates({ silent: true }).catch(() => {});
  }, UPDATE_CHECK_INITIAL_DELAY_MS);
  initialUpdateCheckTimer.unref?.();

  updateCheckInterval = setInterval(() => {
    const phase = torveUpdater.getState().phase;
    if (phase === 'ready' || phase === 'downloading' || phase === 'installing') {
      return;
    }
    void checkForUpdates({ silent: true }).catch(() => {});
  }, UPDATE_CHECK_INTERVAL_MS);
  updateCheckInterval.unref?.();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      showMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (isQuitting) {
    return;
  }

  event.preventDefault();
  try {
    stakingSessions.pauseWrites();
  } catch {
    dialog.showMessageBoxSync({
      type: 'info', title: 'Action in progress',
      message: 'Wait for the active background task to finish before quitting Torve Desktop.',
      detail: 'Torve Desktop will exit cleanly as soon as it finishes.',
    });
    return;
  }
  isQuitting = true;

  // First, and synchronously: the async teardown below waits on child
  // processes and can be cut short (Windows gives an app only a few seconds
  // to quit at logout/shutdown before killing it). An OS proxy left pointing
  // at the dead port breaks networking machine-wide, so it must not be
  // downstream of anything that can block.
  restoreOsSystemProxySync();

  // Briefly flush the final close event and clear the local crash marker before
  // exit, otherwise delivery is lost or the next launch reports a false crash.
  const telemetryShutdown = recordTelemetryCleanShutdown();
  void Promise.allSettled([stopDesktopServices(), telemetryShutdown]).finally(() => {
    app.exit(0);
  });
});

// Ensure child processes are cleaned up if the main process receives a terminal
// stop signal before before-quit fires.
process.on('SIGINT', () => {
  restoreOsSystemProxySync();
  const telemetryShutdown = recordTelemetryCleanShutdown();
  void Promise.allSettled([stopDesktopServices(), telemetryShutdown]).finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
  restoreOsSystemProxySync();
  const telemetryShutdown = recordTelemetryCleanShutdown();
  void Promise.allSettled([stopDesktopServices(), telemetryShutdown]).finally(() => process.exit(0));
});

// Suppress EPIPE errors from console.error/console.warn when the dev terminal
// pipe is closed (e.g. Ctrl+C in the terminal while Electron is still running).
process.stdout?.on('error', () => {});
process.stderr?.on('error', () => {});
