import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  CODEX_CATALOG_MAX_BYTES,
  FALLBACK_CODEX_MODEL_TEMPLATE,
  codexCatalogPayload,
  installedCodexCatalog,
  invalidateCodexModelsCache,
  modelsEndpointPayload,
  writeCodexModelCatalog,
} from './codex-catalog.js';

const MODELS = [
  { id: 'auto', display_name: 'Auto', max_input_tokens: 128_000 },
  { id: 'torve-alpha', name: 'Torve Alpha', context_window: 200_000 },
  { id: 'torve-beta' },
  { id: 'torve-2m', name: 'Torve 2M', context_length: 2_000_000 },
];

function createFixtureModelsCache(dir: string): string {
  const fixturePath = path.join(dir, 'models_cache.json');
  writeFileSync(
    fixturePath,
    JSON.stringify({
      models: [
        {
          ...FALLBACK_CODEX_MODEL_TEMPLATE,
          slug: 'gpt-5.4-mini',
          display_name: 'GPT-5.4-Mini',
          upgrade: { model: 'gpt-5.6-luna', migration_markdown: 'Upgrade notice' },
          availability_nux: { badge: 'New' },
        },
      ],
    }),
    'utf8',
  );
  return fixturePath;
}

test('Codex catalog merges fixture models_cache.json schema and stays below 1 MiB', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'torve-codex-catalog-'));
  const fixturePath = createFixtureModelsCache(dir);
  const catalogPath = path.join(dir, 'codex-model-catalog.json');
  try {
    const fixtureBase = installedCodexCatalog([fixturePath]);
    await writeCodexModelCatalog(MODELS, catalogPath, fixtureBase);
    const bytes = await readFile(catalogPath);
    const catalog = JSON.parse(bytes.toString('utf8')) as ReturnType<typeof codexCatalogPayload>;
    assert.ok(bytes.byteLength < CODEX_CATALOG_MAX_BYTES);
    assert.deepEqual(catalog.models.slice(-4).map((model) => model.slug), ['auto', 'torve-alpha', 'torve-beta', 'torve-2m']);

    const auto = catalog.models.find((model) => model.slug === 'auto');
    assert.ok(auto);
    assert.equal(auto['upgrade'], null);
    assert.equal(auto['availability_nux'], null);
    assert.equal((auto['supported_reasoning_levels'] as unknown[]).length, 1);
    assert.equal(auto['context_window'], 1_000_000);
    assert.equal(auto['max_context_window'], 1_000_000);
    assert.equal(auto['auto_compact_token_limit'], 900_000);
    assert.equal(auto['effective_context_window_percent'], 95);
    assert.equal(auto['supports_parallel_tool_calls'], true);

    const torve = catalog.models.find((model) => model.slug === 'torve-alpha');
    assert.ok(torve);
    assert.equal(torve['upgrade'], null);
    assert.equal(torve['context_window'], 1_000_000);
    assert.equal(torve['max_context_window'], 1_000_000);
    assert.equal(torve['auto_compact_token_limit'], 900_000);
    assert.equal(torve['effective_context_window_percent'], 95);
    assert.equal(torve['supports_parallel_tool_calls'], true);
    for (const required of [
      'support_verbosity',
      'default_verbosity',
      'supported_reasoning_levels',
      'shell_type',
      'base_instructions',
      'truncation_policy',
      'supports_parallel_tool_calls',
    ]) {
      assert.equal(Object.prototype.hasOwnProperty.call(torve, required), true, `missing strict Codex field ${required}`);
    }

    const torveBeta = catalog.models.find((model) => model.slug === 'torve-beta');
    assert.ok(torveBeta);
    assert.equal(torveBeta['context_window'], 1_000_000);
    assert.equal(torveBeta['max_context_window'], 1_000_000);
    assert.equal(torveBeta['auto_compact_token_limit'], 900_000);
    assert.equal(torveBeta['effective_context_window_percent'], 95);
    assert.equal(torveBeta['supports_parallel_tool_calls'], true);

    const torve2m = catalog.models.find((model) => model.slug === 'torve-2m');
    assert.ok(torve2m);
    assert.equal(torve2m['context_window'], 2_000_000);
    assert.equal(torve2m['max_context_window'], 2_000_000);
    assert.equal(torve2m['auto_compact_token_limit'], 900_000);
    assert.equal(torve2m['effective_context_window_percent'], 95);
    assert.equal(torve2m['supports_parallel_tool_calls'], true);

    assert.ok(catalog.models.some((model) => model.slug.startsWith('gpt-')), 'native Codex models must remain in the merged catalog');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('installedCodexCatalog provides a clean built-in fallback schema when no local cache exists', () => {
  const missingPath = path.join(tmpdir(), `missing-codex-cache-${process.pid}-${Date.now()}.json`);
  const fallback = installedCodexCatalog([missingPath]);
  assert.ok(fallback.models.length >= 1);
  assert.equal(FALLBACK_CODEX_MODEL_TEMPLATE['supports_parallel_tool_calls'], true);
  const merged = codexCatalogPayload(MODELS, fallback);
  const torve = merged.models.find((model) => model.slug === 'torve-alpha');
  assert.ok(torve);
  assert.equal(torve['support_verbosity'], true);
  assert.equal(torve['default_verbosity'], 'medium');
  assert.equal(torve['shell_type'], 'shell_command');
  assert.equal(torve['context_window'], 1_000_000);
  assert.equal(torve['max_context_window'], 1_000_000);
  assert.equal(torve['auto_compact_token_limit'], 900_000);
  assert.equal(torve['effective_context_window_percent'], 95);
  assert.equal(torve['supports_parallel_tool_calls'], true);
});

test('Codex catalog stays well below 1 MiB with a realistic 25-model catalog', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'torve-codex-25-models-'));
  const catalogPath = path.join(dir, 'codex-model-catalog.json');
  try {
    const models = Array.from({ length: 25 }, (_, i) => ({
      id: i === 0 ? 'auto' : `torve-model-${i}`,
      display_name: i === 0 ? 'Auto' : `Torve Model ${i}`,
      description: `Realistic Torve Cloud model entry #${i} with full metadata.`,
      max_input_tokens: i % 3 === 0 ? 1_048_576 : 200_000,
    }));
    await writeCodexModelCatalog(models, catalogPath, installedCodexCatalog([path.join(dir, 'missing.json')]));
    const bytes = await readFile(catalogPath);
    assert.ok(bytes.byteLength < CODEX_CATALOG_MAX_BYTES, `catalog ${bytes.byteLength} bytes must stay below ${CODEX_CATALOG_MAX_BYTES}`);
    const parsed = JSON.parse(bytes.toString('utf8')) as ReturnType<typeof codexCatalogPayload>;
    for (const model of models) {
      const entry = parsed.models.find((item) => item.slug === model.id);
      assert.ok(entry, `missing model ${model.id}`);
      assert.ok((entry['context_window'] as number) >= 1_000_000);
      assert.equal(entry['auto_compact_token_limit'], 900_000);
      assert.equal(entry['effective_context_window_percent'], 95);
      assert.equal(entry['supports_parallel_tool_calls'], true);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('/v1/models selects Codex catalog shape only when client_version is present', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'torve-codex-endpoint-'));
  try {
    const fixtureBase = installedCodexCatalog([createFixtureModelsCache(dir)]);
    assert.ok(Array.isArray((modelsEndpointPayload(MODELS, '0.171.0', fixtureBase) as { models: unknown[] }).models));
    assert.deepEqual(modelsEndpointPayload(MODELS, null, fixtureBase), { object: 'list', data: MODELS });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Codex models cache invalidation removes stale catalog data', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'torve-codex-cache-'));
  const cachePath = path.join(dir, 'models_cache.json');
  try {
    await writeFile(cachePath, '{"models":[{"slug":"stale"}]}');
    await invalidateCodexModelsCache(cachePath);
    assert.equal(existsSync(cachePath), false);
    await invalidateCodexModelsCache(cachePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
