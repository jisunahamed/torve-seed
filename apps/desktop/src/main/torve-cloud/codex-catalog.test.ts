import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CODEX_CATALOG_MAX_BYTES, codexCatalogPayload, invalidateCodexModelsCache, modelsEndpointPayload, writeCodexModelCatalog } from './codex-catalog.js';

const MODELS = [{ id: 'auto', display_name: 'Auto' }, { id: 'torve-alpha', name: 'Torve Alpha' }, { id: 'torve-beta' }];

test('Codex catalog uses the installed models cache schema and stays below 1 MiB', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'torve-codex-catalog-'));
  const catalogPath = path.join(dir, 'codex-model-catalog.json');
  try {
    await writeCodexModelCatalog(MODELS, catalogPath);
    const bytes = await readFile(catalogPath);
    const catalog = JSON.parse(bytes.toString('utf8')) as ReturnType<typeof codexCatalogPayload>;
    assert.ok(bytes.byteLength < CODEX_CATALOG_MAX_BYTES);
    assert.deepEqual(catalog.models.slice(-3).map((model) => model.slug), ['auto', 'torve-alpha', 'torve-beta']);
    const auto = catalog.models.find((model) => model.slug === 'auto');
    assert.ok(auto);
    assert.equal(auto['upgrade'], null);
    assert.equal((auto['supported_reasoning_levels'] as unknown[]).length, 1);
    const torve = catalog.models.find((model) => model.slug === 'torve-alpha');
    assert.ok(torve);
    assert.equal(torve['upgrade'], null);
    for (const required of ['support_verbosity', 'default_verbosity', 'supported_reasoning_levels', 'shell_type', 'base_instructions', 'truncation_policy']) {
      assert.equal(Object.prototype.hasOwnProperty.call(torve, required), true, `missing strict Codex field ${required}`);
    }
    assert.ok(catalog.models.some((model) => model.slug.startsWith('gpt-')), 'native Codex models must remain in the merged catalog');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('/v1/models selects Codex catalog shape only when client_version is present', () => {
  assert.ok(Array.isArray((modelsEndpointPayload(MODELS, '0.171.0') as { models: unknown[] }).models));
  assert.deepEqual(modelsEndpointPayload(MODELS, null), { object: 'list', data: MODELS });
});

test('Codex models cache invalidation removes stale catalog data', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'torve-codex-cache-'));
  const cachePath = path.join(dir, 'models_cache.json');
  try {
    await writeFile(cachePath, '{"models":[{"slug":"stale"}]}');
    await invalidateCodexModelsCache(cachePath);
    assert.equal(existsSync(cachePath), false);
    await invalidateCodexModelsCache(cachePath);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
