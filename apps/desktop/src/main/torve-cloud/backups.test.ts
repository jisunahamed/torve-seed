import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { directCloudBackupMatchesPatched, extendDirectCloudBackup, prepareDirectCloudBackup, restoreDirectCloudBackup, sealDirectCloudBackup } from './backups.js';
import { applyConfigPatch, type AntigravityConfigPatchDef, type CodexConfigPatchDef, type OpencodeConfigPatchDef } from '../system-proxy/config-patch.js';

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

test('backup extension preserves old originals and captures newly managed files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'torve-backup-extend-'));
  const appId = `extend-${process.pid}-${Date.now()}`;
  const desktopConfig = path.join(dir, 'desktop.json');
  const codeSettings = path.join(dir, 'settings.json');
  const desktopOriginal = Buffer.from('{"desktop":"original"}\r\n');
  const codeOriginal = Buffer.from('{"code":"original"}\r\n');
  try {
    await writeFile(desktopConfig, desktopOriginal);
    await prepareDirectCloudBackup(appId, [desktopConfig]);
    await writeFile(desktopConfig, '{"desktop":"patched"}\n');
    await sealDirectCloudBackup(appId);
    await writeFile(codeSettings, codeOriginal);
    await extendDirectCloudBackup(appId, [desktopConfig, codeSettings]);
    await writeFile(codeSettings, '{"code":"patched"}\n');
    assert.equal(await restoreDirectCloudBackup(appId, { forceExact: true }), true);
    assert.deepEqual(await readFile(desktopConfig), desktopOriginal);
    assert.deepEqual(await readFile(codeSettings), codeOriginal);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('OpenCode catalog refresh reseals managed bytes and still restores the exact original', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'torve-opencode-refresh-'));
  const appId = `opencode-test-${process.pid}-${Date.now()}`;
  const configPath = path.join(dir, 'opencode.jsonc');
  const original = Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('{\r\n  // user comment\r\n  "theme": "dark",\r\n}\r\n')]);
  const basePatch: OpencodeConfigPatchDef = {
    format: 'opencode', configPath, providerKey: 'torve', providerName: 'Torve',
    npm: '@ai-sdk/openai-compatible', baseURL: 'http://127.0.0.1:{buyerPort}/app/opencode/v1',
    apiKey: 'torve-local-proxy', modelAlias: 'auto',
  };
  try {
    await writeFile(configPath, original);
    await prepareDirectCloudBackup(appId, [configPath]);
    applyConfigPatch({ ...basePatch, models: [{ id: 'model-one', name: 'Model One' }] }, 'direct', 8378);
    await sealDirectCloudBackup(appId);
    applyConfigPatch({ ...basePatch, models: [{ id: 'model-one', name: 'Model One' }, { id: 'model-two', name: 'Model Two' }] }, 'direct', 8378);
    await sealDirectCloudBackup(appId);
    const patched = JSON.parse(await readFile(configPath, 'utf8')) as { provider: { torve: { models: Record<string, unknown> } } };
    assert.deepEqual(Object.keys(patched.provider.torve.models), ['auto', 'model-one', 'model-two']);
    assert.equal(await restoreDirectCloudBackup(appId), true);
    assert.deepEqual(await readFile(configPath), original);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('OpenCode refresh detects user edits and keeps exact restore guarded', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'torve-opencode-edit-'));
  const appId = `opencode-edit-test-${process.pid}-${Date.now()}`;
  const configPath = path.join(dir, 'opencode.jsonc');
  try {
    await writeFile(configPath, '{"user":true}\n');
    await prepareDirectCloudBackup(appId, [configPath]);
    await writeFile(configPath, '{"user":true,"provider":{"torve":{}}}\n');
    await sealDirectCloudBackup(appId);
    assert.equal(await directCloudBackupMatchesPatched(appId), true);
    await writeFile(configPath, '{"user":true,"editedWhileConnected":true,"provider":{"torve":{}}}\n');
    assert.equal(await directCloudBackupMatchesPatched(appId), false);
    assert.equal(await restoreDirectCloudBackup(appId), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Antigravity settings patch restores the byte-perfect original file', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'torve-antigravity-settings-'));
  const appId = `antigravity-ide-test-${process.pid}-${Date.now()}`;
  const settings = path.join(dir, 'User', 'settings.json');
  const original = Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('{\r\n  // keep this comment\r\n  "editor.fontSize": 15,\r\n}\r\n')]);
  const patch: AntigravityConfigPatchDef = { format: 'antigravity-ide', configPath: settings, baseURL: 'http://127.0.0.1:{buyerPort}/app/antigravity' };
  try {
    await import('node:fs/promises').then(({ mkdir }) => mkdir(path.dirname(settings), { recursive: true }));
    await writeFile(settings, original);
    await prepareDirectCloudBackup(appId, [settings]);
    applyConfigPatch(patch, 'direct', 8378);
    assert.equal((JSON.parse((await readFile(settings, 'utf8')).replace(/^\uFEFF/, '')) as Record<string, unknown>)['jetski.cloudCodeUrl'], 'http://127.0.0.1:8378/app/antigravity');
    await sealDirectCloudBackup(appId);
    assert.equal(await restoreDirectCloudBackup(appId), true);
    assert.deepEqual(await readFile(settings), original);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Antigravity exact restore wins over changes made after the managed patch', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'torve-antigravity-exact-'));
  const appId = `antigravity-ide-exact-${process.pid}-${Date.now()}`;
  const settings = path.join(dir, 'settings.json');
  const original = Buffer.from('{"original":true}\r\n');
  try {
    await writeFile(settings, original);
    await prepareDirectCloudBackup(appId, [settings]);
    await writeFile(settings, '{"jetski.cloudCodeUrl":"http://127.0.0.1:8378/app/antigravity"}\n');
    await sealDirectCloudBackup(appId);
    await writeFile(settings, '{"changedWhileConnected":true}\n');
    assert.equal(await restoreDirectCloudBackup(appId, { forceExact: true }), true);
    assert.deepEqual(await readFile(settings), original);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Codex config.toml backup restores the byte-perfect original file', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'torve-codex-config-'));
  const appId = `codex-test-${process.pid}-${Date.now()}`;
  const configPath = path.join(dir, 'config.toml');
  const original = Buffer.from('# user config\r\nmodel = "gpt-5"\r\n');
  const patch: CodexConfigPatchDef = {
    format: 'codex', configPath, providerKey: 'torve', providerName: 'Torve AI',
    baseURL: 'http://127.0.0.1:{buyerPort}/app/codex/v1', model: 'torve-alpha',
    modelCatalogJson: path.join(dir, 'codex-model-catalog.json'), bearerToken: 'torve-local-proxy',
  };
  try {
    await writeFile(configPath, original);
    await prepareDirectCloudBackup(appId, [configPath]);
    applyConfigPatch(patch, 'direct', 8378);
    await sealDirectCloudBackup(appId);
    const patched = await readFile(configPath, 'utf8');
    assert.match(patched, /model_provider = "torve"/);
    assert.match(patched, /experimental_bearer_token = "torve-local-proxy"/);
    assert.equal(await restoreDirectCloudBackup(appId), true);
    assert.deepEqual(await readFile(configPath), original);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
