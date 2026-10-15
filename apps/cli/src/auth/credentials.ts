import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface StoredCredentials {
  apiKey: string;
  email?: string;
  userId?: string;
  savedAt: string;
}

export function getCredentialsPath(dataDir: string): string {
  return join(dataDir, 'credentials.json');
}

export async function loadCredentials(dataDir: string): Promise<StoredCredentials | null> {
  const p = getCredentialsPath(dataDir);
  try {
    const raw = await readFile(p, 'utf-8');
    const parsed = JSON.parse(raw) as StoredCredentials;
    if (!parsed || typeof parsed.apiKey !== 'string' || parsed.apiKey.trim().length === 0) {
      return null;
    }
    return {
      apiKey: parsed.apiKey.trim(),
      ...(typeof parsed.email === 'string' && parsed.email.trim().length > 0 ? { email: parsed.email.trim() } : {}),
      ...(typeof parsed.userId === 'string' && parsed.userId.trim().length > 0 ? { userId: parsed.userId.trim() } : {}),
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
    };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    // Corrupt file — treat as not logged in but don't throw loudly
    return null;
  }
}

export async function saveCredentials(dataDir: string, creds: StoredCredentials): Promise<void> {
  const p = getCredentialsPath(dataDir);
  await mkdir(dirname(p), { recursive: true });
  // Restrict file to owner-only on POSIX (0600). On Windows this is a no-op.
  await writeFile(p, JSON.stringify(creds, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
  // Ensure mode even if file existed (chmod after write)
  try {
    const { chmod } = await import('node:fs/promises');
    await chmod(p, 0o600);
  } catch {
    // Windows — chmod may not be meaningful
  }
}

export async function clearCredentials(dataDir: string): Promise<boolean> {
  const p = getCredentialsPath(dataDir);
  try {
    await unlink(p);
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

export async function hasCredentials(dataDir: string): Promise<boolean> {
  const c = await loadCredentials(dataDir);
  return c !== null;
}
