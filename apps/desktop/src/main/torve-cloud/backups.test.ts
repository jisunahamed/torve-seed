import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareDirectCloudBackup, restoreDirectCloudBackup, sealDirectCloudBackup } from './backups.js';

test('direct-cloud backup restores exact original bytes and removes created files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'torve-backup-test-'));
  const appId = `test-${process.pid}-${Date.now()}`;
  const existing = path.join(dir, 'existing.json');
  const created = path.join(dir, 'created.env');
  const original = Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('{\r\n  "keep": true\r\n}\r\n')]);
  try {
    await writeFile(existing, original);
    await prepareDirectCloudBackup(appId, [existing, created]);
    await writeFile(existing, '{"torve":true}\n');
    await writeFile(created, 'TOKEN=torve-local-proxy\n');
    await sealDirectCloudBackup(appId);
    assert.equal(await restoreDirectCloudBackup(appId), true);
    assert.deepEqual(await readFile(existing), original);
    await assert.rejects(readFile(created), /ENOENT/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
