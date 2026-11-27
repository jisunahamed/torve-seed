/**
 * IPC surface for app-level queries: version and locale, first-run setup
 * state, telemetry controls, and the local signing identity.
 */
import { app, dialog, ipcMain } from 'electron';
import { writeFile } from 'node:fs/promises';
import { getAppSetupStatus } from '../app-context.js';
import {
  ensureSecureIdentity,
  exportIdentityPrivateKeyHex,
  getSecureIdentity,
  importIdentityPrivateKeyHex,
} from '../identity.js';
import { getTelemetryService } from '../telemetry/runtime.js';
import { getMainWindow } from '../ui/window.js';
import {
  TELEMETRY_ACTION_SURFACES,
  TELEMETRY_APP_NAMES,
  TELEMETRY_USER_ACTIONS,
  type TelemetryStatusUpdateResult,
  type UserActionSignal,
} from '../../shared/telemetry.js';

export function registerAppIpc(): void {
  ipcMain.handle('app:get-setup-status', () => ({
    ...getAppSetupStatus(),
  }));

  ipcMain.handle('app:get-system-locale', () => app.getLocale());

  ipcMain.handle('app:get-version', () => app.getVersion());

  ipcMain.handle('telemetry:get-status', () => {
    const telemetry = getTelemetryService();
    return {
      available: telemetry?.available ?? false,
      enabled: telemetry?.enabled ?? false,
      userDisabled: telemetry?.isUserOptedOut() ?? false,
    };
  });

  ipcMain.handle('telemetry:set-enabled', async (_event, enabled: unknown): Promise<TelemetryStatusUpdateResult> => {
    const telemetry = getTelemetryService();
    if (!telemetry) {
      return { ok: false, error: 'Telemetry service not initialized' };
    }
    await telemetry.setUserOptedOut(!enabled);
    return {
      ok: true,
      available: telemetry.available,
      enabled: telemetry.enabled,
      userDisabled: telemetry.isUserOptedOut(),
    };
  });

  ipcMain.handle('telemetry:record-user-action', (_event, payload: unknown) => {
    const candidate = payload as Partial<UserActionSignal> | null;
    if (!candidate
      || !TELEMETRY_USER_ACTIONS.includes(candidate.action as never)
      || !TELEMETRY_ACTION_SURFACES.includes(candidate.surface as never)
      || (candidate.app !== undefined && !TELEMETRY_APP_NAMES.includes(candidate.app as never))) {
      return { ok: false };
    }
    const telemetry = getTelemetryService();
    if (!telemetry) return { ok: false };
    void telemetry.recordUserAction({
      action: candidate.action as UserActionSignal['action'],
      surface: candidate.surface as UserActionSignal['surface'],
      ...(candidate.app !== undefined ? { app: candidate.app as UserActionSignal['app'] } : {}),
    });
    return { ok: true };
  });

  ipcMain.handle('openrouter:reference-prices', () => ({}));

  ipcMain.handle('identity:get', async () => {
    try {
      await ensureSecureIdentity();
      const identity = getSecureIdentity();
      if (!identity) {
        return { ok: false, data: null, error: 'Identity not available (safeStorage may not be ready)' };
      }
      return {
        ok: true,
        data: { peerId: identity.peerId },
        error: null,
      };
    } catch (err) {
      return { ok: false, data: null, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('identity:export-key', async () => {
    try {
      await ensureSecureIdentity();
      const hex = exportIdentityPrivateKeyHex();
      if (!hex) {
        return { ok: false, canceled: false, error: 'Identity not available (safeStorage may not be ready)' };
      }
      const saveOptions = {
        title: 'Save signer private key',
        defaultPath: 'torve-signer.key',
        filters: [{ name: 'Key file', extensions: ['key', 'txt'] }],
      };
      const win = getMainWindow();
      const result = win
        ? await dialog.showSaveDialog(win, saveOptions)
        : await dialog.showSaveDialog(saveOptions);
      if (result.canceled || !result.filePath) {
        return { ok: false, canceled: true, error: null };
      }
      await writeFile(result.filePath, `${hex}\n`, { mode: 0o600 });
      return { ok: true, canceled: false, path: result.filePath, error: null };
    } catch (err) {
      return { ok: false, canceled: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('identity:import-key', async (_event, rawKey: unknown) => {
    try {
      if (typeof rawKey !== 'string') {
        return { ok: false, error: 'Private key must be a string' };
      }
      await ensureSecureIdentity();
      return await importIdentityPrivateKeyHex(rawKey);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
