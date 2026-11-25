import type { OpencodeModelDefinition } from '../system-proxy/config-patch.js';
import type { TorveModel } from './models.js';

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
    const output = positiveNumber(model['max_output_tokens'] ?? model['max_tokens']);
    return {
      id: model.id,
      name: displayName || model.id,
      ...(context !== undefined ? { context } : {}),
      ...(output !== undefined ? { output } : {}),
      vision: capabilities.includes('vision'),
    };
  });
}
