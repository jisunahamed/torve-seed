import type { TorveProviderPlugin, Provider, ServiceApiProtocol } from '@torveai/node';
import { BaseProvider, parseServiceCapabilitiesJson } from '@torveai/provider-core';
import { ClaudeCodeTokenProvider } from './claude-code-token.js';

function parseNonNegativeNumber(raw: string | undefined, key: string, fallback: number): number {
  const parsed = raw === undefined ? fallback : Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${key} must be a non-negative number`);
  }
  return parsed;
}

function buildServiceApiProtocols(
  services: string[],
  protocol: ServiceApiProtocol,
): Record<string, ServiceApiProtocol[]> | undefined {
  if (services.length === 0) return undefined;
  return Object.fromEntries(services.map((service) => [service, [protocol]]));
}

const plugin: TorveProviderPlugin = {
  name: 'claude-code',
  displayName: 'Claude Code',
  version: '0.1.0',
  type: 'provider',
  description: 'Claude Code keychain provider (testing and development only)',
  configSchema: [
    { key: 'TORVE_INPUT_USD_PER_MILLION', label: 'Input Price', type: 'number', required: false, default: 10, description: 'Input price in USD per 1M tokens' },
    { key: 'TORVE_OUTPUT_USD_PER_MILLION', label: 'Output Price', type: 'number', required: false, default: 10, description: 'Output price in USD per 1M tokens' },
    { key: 'TORVE_CACHED_INPUT_USD_PER_MILLION', label: 'Cached Input Price', type: 'number', required: false, description: 'Cached input price in USD per 1M tokens (defaults to input price)' },
    { key: 'TORVE_MAX_CONCURRENCY', label: 'Max Concurrency', type: 'number', required: false, default: 10, description: 'Max concurrent requests' },
    { key: 'TORVE_ALLOWED_SERVICES', label: 'Allowed Services', type: 'string[]', required: false, description: 'Service allow-list' },
    { key: 'TORVE_SERVICE_CAPABILITIES_JSON', label: 'Service Capabilities JSON', type: 'string', required: false, description: 'Per-service model capability JSON' },
  ],

  createProvider(config: Record<string, string>): Provider {
    const pricing: Provider['pricing'] = {
      defaults: {
        inputUsdPerMillion: parseNonNegativeNumber(config['TORVE_INPUT_USD_PER_MILLION'], 'TORVE_INPUT_USD_PER_MILLION', 10),
        outputUsdPerMillion: parseNonNegativeNumber(config['TORVE_OUTPUT_USD_PER_MILLION'], 'TORVE_OUTPUT_USD_PER_MILLION', 10),
        ...(config['TORVE_CACHED_INPUT_USD_PER_MILLION'] ? { cachedInputUsdPerMillion: parseNonNegativeNumber(config['TORVE_CACHED_INPUT_USD_PER_MILLION'], 'TORVE_CACHED_INPUT_USD_PER_MILLION', 0) } : {}),
      },
    };

    const maxConcurrency = parseInt(config['TORVE_MAX_CONCURRENCY'] ?? '10', 10);
    if (Number.isNaN(maxConcurrency)) {
      throw new Error('TORVE_MAX_CONCURRENCY must be a valid number');
    }

    const allowedServices = config['TORVE_ALLOWED_SERVICES']
      ? config['TORVE_ALLOWED_SERVICES'].split(',').map((s: string) => s.trim())
      : [];

    const tokenProvider = new ClaudeCodeTokenProvider();
    const serviceApiProtocols = buildServiceApiProtocols(allowedServices, 'anthropic-messages');
    const serviceCapabilities = parseServiceCapabilitiesJson(config['TORVE_SERVICE_CAPABILITIES_JSON']);

    return new BaseProvider({
      name: 'claude-code',
      services: allowedServices,
      pricing,
      ...(serviceApiProtocols ? { serviceApiProtocols } : {}),
      ...(serviceCapabilities ? { serviceCapabilities } : {}),
      relay: {
        baseUrl: 'https://api.anthropic.com',
        authHeaderName: 'authorization',
        authHeaderValue: '',
        tokenProvider,
        maxConcurrency,
        allowedServices,
        extraHeaders: { 'anthropic-beta': 'oauth-2025-04-20' },
      },
    });
  },
};

export default plugin;
