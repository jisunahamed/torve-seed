import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ANTIGRAVITY_STANDALONE_PATCH_INTERNALS, antigravityStandaloneStatus, disableAntigravityStandalonePatch, enableAntigravityStandalonePatch } from './antigravity-standalone-patch.js';

async function fixture(run: (ctx: { installDir: string; backupRoot: string; target: string; original: Buffer }) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'torve-antigravity-standalone-'));
  const installDir = path.join(dir, 'Antigravity'); const backupRoot = path.join(dir, 'backups');
  const target = path.join(installDir, 'resources', 'app.asar');
  const original = Buffer.from(`asar-header\nexports.LS_CLOUD_CODE_ENDPOINT='${ANTIGRAVITY_STANDALONE_PATCH_INTERNALS.ORIGINAL_ENDPOINT}';\nbody`);
  try { await mkdir(path.dirname(target), { recursive: true }); await writeFile(path.join(installDir, 'Antigravity.exe'), 'exe'); await writeFile(target, original); await run({ installDir, backupRoot, target, original }); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

test('standalone patch creates a verified manifest, patches atomically, and restores exact bytes', async () => fixture(async ({ installDir, backupRoot, target, original }) => {
  const options = { installDir, backupRoot, version: '2.34.0', isRunning: () => false };
  assert.equal((await antigravityStandaloneStatus(options)).state, 'inactive');
  assert.equal((await enableAntigravityStandalonePatch(options)).state, 'active');
  const patched = await readFile(target);
  assert.equal(patched.length, original.length);
  assert.ok(patched.includes(Buffer.from(ANTIGRAVITY_STANDALONE_PATCH_INTERNALS.PATCHED_ENDPOINT)));
  const manifest = JSON.parse(await readFile(path.join(backupRoot, '2.34.0', 'manifest.json'), 'utf8')) as { files: Array<{ originalSha256: string; patchedSha256: string }> };
  assert.equal(manifest.files[0]?.originalSha256, createHash('sha256').update(original).digest('hex'));
  assert.equal(manifest.files[0]?.patchedSha256, createHash('sha256').update(patched).digest('hex'));
  assert.equal((await disableAntigravityStandalonePatch(options)).state, 'inactive');
  assert.deepEqual(await readFile(target), original);
}));

test('standalone restore refuses hash mismatch and status reports an update', async () => fixture(async ({ installDir, backupRoot, target }) => {
  const options = { installDir, backupRoot, version: '2.34.0', isRunning: () => false };
  await enableAntigravityStandalonePatch(options);
  await writeFile(target, `updated build ${ANTIGRAVITY_STANDALONE_PATCH_INTERNALS.ORIGINAL_ENDPOINT}`);
  assert.equal((await antigravityStandaloneStatus({ ...options, version: '2.35.0' })).state, 'needs-reapply');
  await assert.rejects(disableAntigravityStandalonePatch(options), /changed after Torve patched/);
}));

test('standalone patch refuses while Antigravity is running', async () => fixture(async ({ installDir, backupRoot }) => {
  await assert.rejects(enableAntigravityStandalonePatch({ installDir, backupRoot, version: '2.34.0', isRunning: () => true }), /Close Antigravity/);
}));
