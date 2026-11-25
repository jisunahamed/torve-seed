import test from 'node:test';
import assert from 'node:assert/strict';

import { opencodeModelsFromCatalog } from './opencode-catalog.js';

test('OpenCode catalog mapping enforces 32K output floor and keeps larger output, ids, display names, and vision capability', () => {
  assert.deepEqual(opencodeModelsFromCatalog([
    { id: 'auto', display_name: 'Auto', max_tokens: 8192 },
    { id: 'gemma-4', display_name: 'Gemma 4', max_input_tokens: 262144, max_tokens: 1024, capabilities: ['vision', 'tools'] },
    { id: 'plain-model', display_name: '  ', capabilities: ['streaming'] },
    { id: 'large-out', display_name: 'Large Out', max_output_tokens: 65_536 },
  ]), [
    { id: 'auto', name: 'Auto', output: 32_768, vision: false },
    { id: 'gemma-4', name: 'Gemma 4', context: 262144, output: 32_768, vision: true },
    { id: 'plain-model', name: 'plain-model', output: 32_768, vision: false },
    { id: 'large-out', name: 'Large Out', output: 65_536, vision: false },
  ]);
});
