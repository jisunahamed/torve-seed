import test from 'node:test';
import assert from 'node:assert/strict';

import { opencodeModelsFromCatalog } from './opencode-catalog.js';

test('OpenCode catalog mapping keeps ids, display names, limits, and vision capability', () => {
  assert.deepEqual(opencodeModelsFromCatalog([
    { id: 'auto', display_name: 'Auto', max_tokens: 8192 },
    { id: 'gemma-4', display_name: 'Gemma 4', max_input_tokens: 262144, max_tokens: 4096, capabilities: ['vision', 'tools'] },
    { id: 'plain-model', display_name: '  ', capabilities: ['streaming'] },
  ]), [
    { id: 'auto', name: 'Auto', output: 8192, vision: false },
    { id: 'gemma-4', name: 'Gemma 4', context: 262144, output: 4096, vision: true },
    { id: 'plain-model', name: 'plain-model', vision: false },
  ]);
});
