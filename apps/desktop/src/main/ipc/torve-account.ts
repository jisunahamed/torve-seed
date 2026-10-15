/**
 * Torve Account — desktop-local credential store for the "Connect Torve Account"
 * flow. Keeps the Torve API key on this device only (never leaves the machine
 * except as the Authorization header to the local buyer proxy at 8377).
 *
 * Storage: ~/.torve/desktop-credentials.json (0600). This is intentionally
 * separate from identity.enc (the chain signer) so rotating one never touches
 * the other. When safeStorage is available the file is still plain JSON for
 * v1 — the key is already scoped to Torve-routed requests; a follow-up can
 * wrap it with safeStorage without changing the IPC surface.
 *
 * Also owns the "Launch Codex with Torve" helper which spawns a terminal
 * running `codex` against the buyer proxy with OPENAI_* env pointing at
 * localhost:8377.
 */
import { ipcMain } from 'electron';
import { execFileSync, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { mkdir, readFile, writeFile, unlink, rename } from 'node:fs/promises';
import { resolveBuyerProxyPort } from '../runtime/active-config.js';

const CREDENTIALS_DIR = path.join(homedir(), '.torve');
const CREDENTIALS_PATH = path.join(CREDENTIALS_DIR, 'desktop-credentials.json');

type TorveAccountPayload = {
  apiKey: string | null;
  email: string | null;
};

type StoredCredentials = {
  apiKey: string;
  email?: string | null;
  updatedAt: number;
};

async function readStored(): Promise<StoredCredentials | null> {
  try {
    const raw = await readFile(CREDENTIALS_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<StoredCredentials>;
    if (typeof parsed.apiKey !== 'string' || !parsed.apiKey.trim()) return null;
    return {
      apiKey: parsed.apiKey.trim(),
      email: typeof parsed.email === 'string' ? parsed.email.trim() || null : null,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

async function writeStored(apiKey: string, email: string | null): Promise<void> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) throw new Error('API key is required.');
  if (/\s/.test(trimmedKey)) throw new Error('API key must not contain whitespace.');
  if (trimmedKey.length < 16) throw new Error('API key looks too short.');
  const payload: StoredCredentials = {
    apiKey: trimmedKey,
    email: email?.trim() ? email.trim() : null,
    updatedAt: Date.now(),
  };
  await mkdir(CREDENTIALS_DIR, { recursive: true });
  const tmp = `${CREDENTIALS_PATH}.tmp`;
  await writeFile(tmp, JSON.stringify(payload, null, 2) + '\n', { mode: 0o600 });
  await rename(tmp, CREDENTIALS_PATH);
  // Ensure restrictive perms even when rename preserved the tmp mode differently on some FS.
  try {
    const { chmod } = await import('node:fs/promises');
    await chmod(CREDENTIALS_PATH, 0o600);
  } catch {
    // best-effort on Windows where chmod is a no-op
  }
}

function buildCodexCommand(apiKey: string, port: number): string {
  const baseUrl = `http://localhost:${port}/v1`;
  // Quote lightly: keys are expected to be single tokens (no spaces/quotes).
  // If a key somehow contains a double quote, fall back to single-quote wrapping
  // on POSIX and leave Windows quoting to cmd.exe.
  const safeKey = apiKey.replace(/"/g, '');
  if (process.platform === 'win32') {
    return `set OPENAI_BASE_URL=${baseUrl} && set OPENAI_API_KEY=${safeKey} && codex`;
  }
  return `OPENAI_BASE_URL=${baseUrl} OPENAI_API_KEY=${safeKey} codex`;
}

export function registerTorveAccountIpc(): void {
  ipcMain.handle('torve:account-get', async (): Promise<TorveAccountPayload> => {
    const stored = await readStored();
    if (!stored) return { apiKey: null, email: null };
    return { apiKey: stored.apiKey, email: stored.email ?? null };
  });

  ipcMain.handle(
    'torve:account-set',
    async (_event, payload: unknown): Promise<{ ok: boolean; error?: string }> => {
      try {
        const raw = payload as Partial<{ apiKey: unknown; email: unknown }>;
        const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey : '';
        const email = typeof raw.email === 'string' ? raw.email : null;
        if (!apiKey.trim()) return { ok: false, error: 'Paste your Torve API key.' };
        await writeStored(apiKey, email);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle('torve:account-clear', async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      await unlink(CREDENTIALS_PATH);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    return { ok: true };
  });

  ipcMain.handle(
    'torve:launch-codex',
    async (): Promise<{ ok: boolean; error?: string; command?: string }> => {
      const stored = await readStored();
      if (!stored) {
        return { ok: false, error: 'No Torve API key saved — connect your account first.' };
      }
      let port = 8377;
      try {
        port = await resolveBuyerProxyPort();
      } catch {
        // fallback to default
      }
      const command = buildCodexCommand(stored.apiKey, port);
      try {
        if (process.platform === 'darwin') {
          execFileSync(
            'osascript',
            [
              '-e',
              `tell application "Terminal" to do script ${JSON.stringify(command)}`,
              '-e',
              'tell application "Terminal" to activate',
            ],
            { stdio: 'pipe' },
          );
          return { ok: true, command };
        }
        if (process.platform === 'win32') {
          const child = spawn('cmd.exe', ['/c', 'start', '', 'cmd.exe', '/k', command], {
            detached: true,
            stdio: 'ignore',
          });
          child.unref();
          return { ok: true, command };
        }
        // Linux / other: no single terminal launcher; return the command for the renderer to copy.
        return {
          ok: false,
          error: `Run it yourself: ${command}`,
          command,
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          command,
        };
      }
    },
  );
}
