import {
  app,
  BrowserWindow,
  ipcMain,
} from 'electron';
import { ensureSecureIdentity, getSecureIdentity, hasStoredIdentity } from './identity.js';
import {
  createWindow,
  createApplicationMenu,
  getMainWindow,
} from './ui/window.js';
import { createDesktopTray, updateDesktopTray } from './ui/tray.js';
import { disableSandboxIfAppImageCannotSandbox } from './linux-sandbox.js';
import {
  APP_ICON_PATH,
  APP_NAME,
  INTERNAL_APP_NAME,
  TRAY_ICON_PATH,
  errorDetails,
  errorMessage,
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
import { registerAppIpc } from './ipc/app.js';
import { registerDesktopIpc } from './ipc/desktop.js';
import { registerFloatIpc } from './ipc/float.js';
import { registerSystemProxyIpc } from './ipc/system-proxy.js';
import { registerTorveAccountIpc, resumeTorveCloudProxy } from './ipc/torve-account.js';
import { stopClaudeDesktopGateway } from './connected-apps/claude-desktop-gateway.js';
import { createTelemetryService } from './telemetry/telemetry.js';
import { setTelemetryService } from './telemetry/runtime.js';

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

async function stopDesktopServices(): Promise<void> {
  const { stopTorveCloudProxy } = await import('./torve-cloud/proxy.js');
  await Promise.allSettled([stopTorveCloudProxy(), stopClaudeDesktopGateway()]);
}

disableSandboxIfAppImageCannotSandbox();

registerDesktopIpc();
registerAppIpc();
registerFloatIpc();
registerTorveAccountIpc();
registerSystemProxyIpc();

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const existingWindow = getMainWindow();
    if (!existingWindow || existingWindow.isDestroyed()) return;
    if (existingWindow.isMinimized()) existingWindow.restore();
    existingWindow.show();
    existingWindow.focus();
  });
}

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;
  // Internal runtime name — NEVER change this value. On macOS the safeStorage
  // encryption key lives in "<INTERNAL_APP_NAME> Safe Storage" and userData derives from it.
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

  const showMainWindow = () => {
    const existingWindow = getMainWindow();
    if (existingWindow) {
      existingWindow.show();
      existingWindow.focus();
      return;
    }
    createWindow({ appName: APP_NAME, appIconPath: APP_ICON_PATH, isDev, rendererUrl });
  };

  showMainWindow();

  createDesktopTray({
    appName: APP_NAME,
    iconPath: TRAY_ICON_PATH,
    onShow: showMainWindow,
  });
  updateDesktopTray();

  void resumeTorveCloudProxy().catch((err) => {
    console.error(`[desktop] Torve Cloud proxy could not resume: ${err instanceof Error ? err.message : String(err)}`);
  });

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
        const message = state.error ?? 'Unable to check for updates right now. Please try again later.';
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
  const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

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
      console.error(`[desktop] Auto-update error: ${state.error}`);
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
      console.error(`[desktop] Auto-update download failed: ${msg}`);
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
  isQuitting = true;

  const telemetryShutdown = recordTelemetryCleanShutdown();
  void Promise.allSettled([stopDesktopServices(), telemetryShutdown]).finally(() => {
    app.exit(0);
  });
});

process.on('SIGINT', () => {
  const telemetryShutdown = recordTelemetryCleanShutdown();
  void Promise.allSettled([stopDesktopServices(), telemetryShutdown]).finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
  const telemetryShutdown = recordTelemetryCleanShutdown();
  void Promise.allSettled([stopDesktopServices(), telemetryShutdown]).finally(() => process.exit(0));
});

process.stdout?.on('error', () => {});
process.stderr?.on('error', () => {});
