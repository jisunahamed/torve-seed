import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveDirectCloudModelChoice } from './overrides.js';

test('OpenCode preserves a concrete model selected from its native picker', () => {
  const override = { enabled: true, modelId: 'minimax-m3-1-flash' };
  assert.equal(
    resolveDirectCloudModelChoice('opencode', 'deepseek-v4-1-flash', 'fallback-model', override),
    'deepseek-v4-1-flash',
  );
});

test('OpenCode resolves auto and torve aliases through the per-app default', () => {
  const override = { enabled: true, modelId: 'minimax-m3-1-flash' };
  assert.equal(resolveDirectCloudModelChoice('opencode', 'auto', 'fallback-model', override), 'minimax-m3-1-flash');
  assert.equal(resolveDirectCloudModelChoice('opencode', 'torve', 'fallback-model', override), 'minimax-m3-1-flash');
  assert.equal(resolveDirectCloudModelChoice('opencode', 'auto', 'fallback-model'), 'fallback-model');
});

test('all catalog-aware apps preserve explicit Torve model ids', () => {
  const override = { enabled: true, modelId: 'default-model' };
  for (const appId of ['codex', 'claude-desktop', 'continue', 'antigravity']) {
    assert.equal(resolveDirectCloudModelChoice(appId, 'explicit-model', 'fallback-model', override), 'explicit-model');
  }
});
