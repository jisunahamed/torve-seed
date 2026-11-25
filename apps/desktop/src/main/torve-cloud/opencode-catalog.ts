import type { OpencodeModelDefinition } from '../system-proxy/config-patch.js';
import type { TorveModel } from './models.js';

export const OPENCODE_MIN_OUTPUT_TOKENS = 32_768;

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function opencodeModelsFromCatalog(models: readonly TorveModel[]): OpencodeModelDefinition[] {
  return models.map((model) => {
    const capabilities = Array.isArray(model['capabilities']) ? model['capabilities'] : [];
    const displayName = typeof model['display_name'] === 'string'
      ? model['display_name'].trim()
      : typeof model['name'] === 'string' ? model['name'].trim() : '';
    const context = positiveNumber(model['max_input_tokens'] ?? model['context_window'] ?? model['context_length']);
    const rawOutput = positiveNumber(model['max_output_tokens'] ?? model['max_tokens']);
    const output = Math.max(rawOutput ?? 0, OPENCODE_MIN_OUTPUT_TOKENS);
    return {
      id: model.id,
      name: displayName || model.id,
      ...(context !== undefined ? { context } : {}),
      output,
      vision: capabilities.includes('vision'),
    };
  });
}
