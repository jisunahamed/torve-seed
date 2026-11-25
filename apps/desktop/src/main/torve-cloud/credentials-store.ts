/**
 * Encrypted Torve Desktop credential store backed by Electron safeStorage.
 * Credentials are encrypted at rest and never exposed in plaintext to renderer code.
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { DesktopAuthMode, DesktopKeyMeta, DesktopUserMeta } from './desktop-api.js';

export type SafeStorageAdapter = {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
};

export type StoredCredentials = {
  apiKey: string;
  authMode: DesktopAuthMode;
  email: string | null;
  keyMeta: DesktopKeyMeta | null;
  userMeta: DesktopUserMeta | null;
  updatedAt: number;
};

export type TorveAccountStatus = {
  connected: boolean;
  authMode: DesktopAuthMode | null;
  email: string | null;
  keyHint: string | null;
  keyMeta: DesktopKeyMeta | null;
  userMeta: DesktopUserMeta | null;
  updatedAt: number | null;
  secureStorage: boolean;
};

export type CredentialsStorePaths = {
  credentialsPath: string;
  legacyCredentialsPath: string;
};

const CREDENTIALS_DIR = path.join(homedir(), '.torve');
export const DEFAULT_CREDENTIALS_PATHS: CredentialsStorePaths = {
  credentialsPath: path.join(CREDENTIALS_DIR, 'desktop-credentials.enc'),
  legacyCredentialsPath: path.join(CREDENTIALS_DIR, 'desktop-credentials.json'),
};

export function maskApiKey(key: string): string {
  return key.length < 12 ? '••••••••' : `${key.slice(0, 8)}…${key.slice(-4)}`;
}

export function isSafeStorageAvailable(safe: SafeStorageAdapter): boolean {
  try {
    return safe.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function normalizeEmail(email: unknown, userMeta: DesktopUserMeta | null): string | null {
  if (typeof email === 'string' && email.trim()) return email.trim();
  if (typeof userMeta?.email === 'string' && userMeta.email.trim()) return userMeta.email.trim();
  return null;
}

function normalizeRecord(raw: unknown): StoredCredentials | null {
  if (!raw || typeof raw !== 'object') return null;
  const parsed = raw as Partial<StoredCredentials>;
  if (typeof parsed.apiKey !== 'string' || !parsed.apiKey.trim()) return null;
  const userMeta = parsed.userMeta && typeof parsed.userMeta === 'object' ? parsed.userMeta : null;
  const keyMeta = parsed.keyMeta && typeof parsed.keyMeta === 'object' ? parsed.keyMeta : null;
  return {
    apiKey: parsed.apiKey.trim(),
    authMode: parsed.authMode === 'oauth' ? 'oauth' : 'manual',
    email: normalizeEmail(parsed.email, userMeta),
    keyMeta,
    userMeta,
    updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
  };
}

export async function readStoredCredentials(
  safe: SafeStorageAdapter,
  paths: CredentialsStorePaths = DEFAULT_CREDENTIALS_PATHS,
): Promise<StoredCredentials | null> {
  if (!isSafeStorageAvailable(safe)) return null;
  try {
    const encrypted = await readFile(paths.credentialsPath);
    return normalizeRecord(JSON.parse(safe.decryptString(encrypted)));
  } catch {
    // One-way migration from legacy plaintext scaffold.
    try {
      const legacy = normalizeRecord(JSON.parse(await readFile(paths.legacyCredentialsPath, 'utf8')));
      if (!legacy) return null;
      await writeStoredCredentials(safe, legacy, paths);
      await unlink(paths.legacyCredentialsPath);
      return legacy;
    } catch {
      return null;
    }
  }
}

export async function writeStoredCredentials(
  safe: SafeStorageAdapter,
  input: {
    apiKey: string;
    authMode: DesktopAuthMode;
    email?: string | null;
    keyMeta?: DesktopKeyMeta | null;
    userMeta?: DesktopUserMeta | null;
  },
  paths: CredentialsStorePaths = DEFAULT_CREDENTIALS_PATHS,
): Promise<StoredCredentials> {
  if (!isSafeStorageAvailable(safe)) {
    throw new Error('Secure OS credential storage is unavailable. Torve will not save an API key unencrypted.');
  }
  const key = input.apiKey.trim();
  if (!key || /\s/.test(key) || key.length < 16) {
    throw new Error('The API key is invalid.');
  }
  const userMeta = input.userMeta ?? null;
  const record: StoredCredentials = {
    apiKey: key,
    authMode: input.authMode === 'oauth' ? 'oauth' : 'manual',
    email: normalizeEmail(input.email ?? null, userMeta),
    keyMeta: input.keyMeta ?? null,
    userMeta,
    updatedAt: Date.now(),
  };
  await mkdir(path.dirname(paths.credentialsPath), { recursive: true });
  const temp = `${paths.credentialsPath}.${randomUUID()}.tmp`;
  await writeFile(temp, safe.encryptString(JSON.stringify(record)), { mode: 0o600 });
  await rename(temp, paths.credentialsPath);
  return record;
}

export async function clearStoredCredentials(
  paths: CredentialsStorePaths = DEFAULT_CREDENTIALS_PATHS,
): Promise<void> {
  for (const filePath of [paths.credentialsPath, paths.legacyCredentialsPath]) {
    if (!existsSync(filePath)) continue;
    try {
      await unlink(filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
    }
  }
}

export function toTorveAccountStatus(
  stored: StoredCredentials | null,
  secureStorage: boolean,
): TorveAccountStatus {
  return {
    connected: Boolean(stored),
    authMode: stored?.authMode ?? null,
    email: stored?.email ?? null,
    keyHint: stored ? maskApiKey(stored.apiKey) : null,
    keyMeta: stored?.keyMeta ?? null,
    userMeta: stored?.userMeta ?? null,
    updatedAt: stored?.updatedAt ?? null,
    secureStorage,
  };
}
