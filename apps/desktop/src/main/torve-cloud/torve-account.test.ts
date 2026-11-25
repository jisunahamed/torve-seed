import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  clearStoredCredentials,
  readStoredCredentials,
  toTorveAccountStatus,
  writeStoredCredentials,
  type SafeStorageAdapter,
} from './credentials-store.js';

function fakeSafeStorage(): SafeStorageAdapter {
  const prefix = 'ENC:';
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(`${prefix}${Buffer.from(plain, 'utf8').toString('base64')}`, 'utf8'),
    decryptString: (encrypted) => {
      const text = encrypted.toString('utf8');
      assert.ok(text.startsWith(prefix));
      return Buffer.from(text.slice(prefix.length), 'base64').toString('utf8');
    },
  };
}

test('credentials-store persists encrypted OAuth credentials without plaintext on disk or status leakage', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'torve-creds-'));
  const paths = {
    credentialsPath: path.join(dir, 'desktop-credentials.enc'),
    legacyCredentialsPath: path.join(dir, 'desktop-credentials.json'),
  };
  const safe = fakeSafeStorage();
  try {
    const secret = 'sk-trv-super-secret-oauth-key-123456';
    const saved = await writeStoredCredentials(safe, {
      apiKey: secret,
      authMode: 'oauth',
      email: 'alice@torveai.com',
      keyMeta: { id: 'key-1', name: 'DESKTOP-MAIN', prefix: 'sk-trv-supe', createdAt: '2026-11-25T00:00:00Z' },
      userMeta: { id: 'usr-1', email: 'alice@torveai.com', name: 'Alice', plan: 'pro', status: 'active' },
    }, paths);
    assert.equal(saved.authMode, 'oauth');

    const rawOnDisk = await readFile(paths.credentialsPath, 'utf8');
    assert.equal(rawOnDisk.includes(secret), false);

    const loaded = await readStoredCredentials(safe, paths);
    assert.equal(loaded?.apiKey, secret);
    assert.equal(loaded?.authMode, 'oauth');
    assert.equal(loaded?.userMeta?.plan, 'pro');

    const status = toTorveAccountStatus(loaded, true);
    assert.equal(status.connected, true);
    assert.equal(status.authMode, 'oauth');
    assert.equal(status.keyHint, 'sk-trv-s…3456');
    assert.equal(JSON.stringify(status).includes(secret), false);

    await clearStoredCredentials(paths);
    assert.equal(await readStoredCredentials(safe, paths), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('credentials-store preserves backward compatibility and refuses plaintext when safeStorage is unavailable', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'torve-creds-compat-'));
  const paths = {
    credentialsPath: path.join(dir, 'desktop-credentials.enc'),
    legacyCredentialsPath: path.join(dir, 'desktop-credentials.json'),
  };
  const safe = fakeSafeStorage();
  const unavailableSafe: SafeStorageAdapter = { ...safe, isEncryptionAvailable: () => false };

  try {
    await assert.rejects(
      () => writeStoredCredentials(unavailableSafe, { apiKey: 'sk-trv-secret-key-999999', authMode: 'manual' }, paths),
      /unavailable/i,
    );

    await writeFile(paths.legacyCredentialsPath, JSON.stringify({
      apiKey: 'sk-trv-legacy-secret-1234',
      email: 'legacy@torveai.com',
      updatedAt: 1700000000000,
    }), 'utf8');

    const migrated = await readStoredCredentials(safe, paths);
    assert.equal(migrated?.apiKey, 'sk-trv-legacy-secret-1234');
    assert.equal(migrated?.authMode, 'manual');
    assert.equal(migrated?.email, 'legacy@torveai.com');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
