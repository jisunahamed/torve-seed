/** Torve Cloud credentials never leave the Electron main process. */
import { BrowserWindow, ipcMain, safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { clearDirectCloudActivity, getDirectCloudActivity, setDirectCloudActivitySink, startTorveCloudProxy, torveCloudProxyStatus } from '../torve-cloud/proxy.js';
import { refreshTorveCloudModels, torveCloudModelsStatus } from '../torve-cloud/models.js';
import { startTorveCloudProfiles, stopTorveCloudProfiles, torveCloudProfilesState } from '../torve-cloud/profiles.js';
import { getDirectCloudOverrides, setDirectCloudOverride } from '../torve-cloud/overrides.js';

const CREDENTIALS_DIR = path.join(homedir(), '.torve');
const CREDENTIALS_PATH = path.join(CREDENTIALS_DIR, 'desktop-credentials.enc');
const LEGACY_CREDENTIALS_PATH = path.join(CREDENTIALS_DIR, 'desktop-credentials.json');
type StoredCredentials = { apiKey: string; email: string | null; updatedAt: number };
export type TorveAccountStatus = { connected: boolean; email: string | null; keyHint: string | null; updatedAt: number | null; secureStorage: boolean };

function safeStorageAvailable(): boolean { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } }
function keyHint(key: string): string { return key.length < 12 ? '••••••••' : `${key.slice(0, 8)}…${key.slice(-4)}`; }

async function readStored(): Promise<StoredCredentials | null> {
  if (!safeStorageAvailable()) return null;
  try {
    const parsed = JSON.parse(safeStorage.decryptString(await readFile(CREDENTIALS_PATH))) as Partial<StoredCredentials>;
    if (typeof parsed.apiKey !== 'string' || !parsed.apiKey.trim()) return null;
    return { apiKey: parsed.apiKey.trim(), email: typeof parsed.email === 'string' ? parsed.email.trim() || null : null, updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now() };
  } catch {
    // One-way migration from the short-lived v1 plaintext scaffold. Never
    // continue using that file after safeStorage is available.
    try {
      const legacy = JSON.parse(await readFile(LEGACY_CREDENTIALS_PATH, 'utf8')) as Partial<StoredCredentials>;
      if (typeof legacy.apiKey !== 'string' || !legacy.apiKey.trim()) return null;
      const migrated: StoredCredentials = { apiKey: legacy.apiKey.trim(), email: typeof legacy.email === 'string' ? legacy.email.trim() || null : null, updatedAt: typeof legacy.updatedAt === 'number' ? legacy.updatedAt : Date.now() };
      await writeStored(migrated.apiKey, migrated.email);
      await unlink(LEGACY_CREDENTIALS_PATH);
      return migrated;
    } catch { return null; }
  }
}

async function writeStored(apiKey: string, email: string | null): Promise<void> {
  if (!safeStorageAvailable()) throw new Error('Secure OS credential storage is unavailable. Torve will not save an API key unencrypted.');
  const key = apiKey.trim();
  if (!key || /\s/.test(key) || key.length < 16) throw new Error('The API key is invalid.');
  await mkdir(CREDENTIALS_DIR, { recursive: true });
  const temp = `${CREDENTIALS_PATH}.${randomUUID()}.tmp`;
  await writeFile(temp, safeStorage.encryptString(JSON.stringify({ apiKey: key, email: email?.trim() || null, updatedAt: Date.now() })), { mode: 0o600 });
  await rename(temp, CREDENTIALS_PATH);
}

/** Used exclusively by the direct-cloud loopback proxy. */
export async function getTorveCloudApiKey(): Promise<string | null> { return (await readStored())?.apiKey ?? null; }
export async function getTorveAccountStatus(): Promise<TorveAccountStatus> {
  const stored = await readStored();
  return { connected: Boolean(stored), email: stored?.email ?? null, keyHint: stored ? keyHint(stored.apiKey) : null, updatedAt: stored?.updatedAt ?? null, secureStorage: safeStorageAvailable() };
}

/** Start an existing secure account after Electron's safeStorage is ready. */
export async function resumeTorveCloudProxy(): Promise<void> {
  if (await getTorveCloudApiKey()) await startTorveCloudProxy();
}

export function registerTorveAccountIpc(): void {
  setDirectCloudActivitySink((activity) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('direct-cloud:activity', activity);
  });
  ipcMain.handle('torve:account-get', getTorveAccountStatus);

  ipcMain.handle(
    'torve:account-set',
    async (_event, payload: unknown): Promise<{ ok: boolean; error?: string; status?: TorveAccountStatus }> => {
      try {
        const raw = payload as Partial<{ apiKey: unknown; email: unknown }>;
        const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey : '';
        const email = typeof raw.email === 'string' ? raw.email : null;
        if (!apiKey.trim()) return { ok: false, error: 'Paste your Torve API key.' };
        // Do not overwrite a valid credential until the new one has been verified.
        await refreshTorveCloudModels(apiKey.trim(), { force: true });
        await writeStored(apiKey, email);
        await startTorveCloudProxy();
        return { ok: true, status: await getTorveAccountStatus() };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle('torve:account-clear', async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      await stopTorveCloudProfiles();
      if (existsSync(CREDENTIALS_PATH)) await unlink(CREDENTIALS_PATH);
      if (existsSync(LEGACY_CREDENTIALS_PATH)) await unlink(LEGACY_CREDENTIALS_PATH);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    return { ok: true };
  });

  ipcMain.handle('torve:models-get', torveCloudModelsStatus);
  ipcMain.handle('torve:models-refresh', async (): Promise<{ ok: boolean; error?: string }> => {
    try { const key = await getTorveCloudApiKey(); if (!key) throw new Error('Connect a Torve account first.'); await refreshTorveCloudModels(key, { force: true }); return { ok: true }; }
    catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
  });
  ipcMain.handle('torve:proxy-status', torveCloudProxyStatus);
  ipcMain.handle('torve:overrides-get', getDirectCloudOverrides);
  ipcMain.handle('torve:override-set', async (_event, appId: unknown, value: unknown) => {
    try {
      if (typeof appId !== 'string') throw new Error('Invalid connected app.');
      const record = value && typeof value === 'object' ? value as Record<string, unknown> : null;
      const override = record && typeof record['modelId'] === 'string'
        ? { modelId: record['modelId'], enabled: record['enabled'] !== false }
        : null;
      return { ok: true, overrides: await setDirectCloudOverride(appId, override) };
    } catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
  });
  ipcMain.handle('torve:activity-get', getDirectCloudActivity);
  ipcMain.handle('torve:activity-clear', () => { clearDirectCloudActivity(); return { ok: true }; });
  ipcMain.handle('torve:direct-state', torveCloudProfilesState);
  ipcMain.handle('torve:direct-start', async (_event, profiles: unknown): Promise<{ ok: boolean; state?: Awaited<ReturnType<typeof torveCloudProfilesState>>; error?: string }> => {
    try { return { ok: true, state: await startTorveCloudProfiles(Array.isArray(profiles) ? profiles.filter((name): name is string => typeof name === 'string') : []) }; }
    catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
  });
  ipcMain.handle('torve:direct-stop', async (): Promise<{ ok: boolean; state?: Awaited<ReturnType<typeof torveCloudProfilesState>>; error?: string }> => {
    try { return { ok: true, state: await stopTorveCloudProfiles() }; }
    catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
  });
}
