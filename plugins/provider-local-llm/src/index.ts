import type { TorveProviderPlugin, Provider, ServiceApiProtocol } from '@torveai/node';
import { BaseProvider, StaticTokenProvider, parseServiceAliasMap, parseServiceCapabilitiesJson, parseServicePricingJson } from '@torveai/provider-core';

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
  name: 'local-llm',
  displayName: 'Local LLM',
  version: '0.1.0',
  type: 'provider',
  description: 'Provide local LLM capacity to P2P peers',
  configSchema: [
    { key: 'LOCAL_LLM_BASE_URL', label: 'Base URL', type: 'string', required: false, default: 'http://localhost:11434', description: 'Local LLM server base URL' },
    { key: 'LOCAL_LLM_API_KEY', label: 'API Key', type: 'secret', required: false, description: 'Optional API key for local LLM' },
    { key: 'TORVE_INPUT_USD_PER_MILLION', label: 'Input Price', type: 'number', required: false, default: 0, description: 'Input price in USD per 1M tokens' },
    { key: 'TORVE_OUTPUT_USD_PER_MILLION', label: 'Output Price', type: 'number', required: false, default: 0, description: 'Output price in USD per 1M tokens' },
    { key: 'TORVE_CACHED_INPUT_USD_PER_MILLION', label: 'Cached Input Price', type: 'number', required: false, description: 'Cached input price in USD per 1M tokens (defaults to input price)' },
    { key: 'TORVE_MAX_CONCURRENCY', label: 'Max Concurrency', type: 'number', required: false, default: 1, description: 'Max concurrent requests' },
    { key: 'TORVE_ALLOWED_SERVICES', label: 'Allowed Services', type: 'string[]', required: false, description: 'Service allow-list' },
    { key: 'TORVE_SERVICE_PRICING_JSON', label: 'Service Pricing JSON', type: 'string', required: false, description: 'Per-service pricing JSON' },
    { key: 'TORVE_SERVICE_ALIAS_MAP_JSON', label: 'Service Alias Map', type: 'string', required: false, description: 'JSON map of announced service → upstream model name' },
    { key: 'TORVE_SERVICE_CAPABILITIES_JSON', label: 'Service Capabilities JSON', type: 'string', required: false, description: 'Per-service model capability JSON' },
  ],

  createProvider(config: Record<string, string>): Provider {
    const baseUrl = config['LOCAL_LLM_BASE_URL'] ?? 'http://localhost:11434';
    const apiKey = config['LOCAL_LLM_API_KEY'] ?? '';
    const servicePricing = parseServicePricingJson(config['TORVE_SERVICE_PRICING_JSON']);

    const pricing: Provider['pricing'] = {
      defaults: {
        inputUsdPerMillion: parseNonNegativeNumber(config['TORVE_INPUT_USD_PER_MILLION'], 'TORVE_INPUT_USD_PER_MILLION', 0),
        outputUsdPerMillion: parseNonNegativeNumber(config['TORVE_OUTPUT_USD_PER_MILLION'], 'TORVE_OUTPUT_USD_PER_MILLION', 0),
        ...(config['TORVE_CACHED_INPUT_USD_PER_MILLION'] ? { cachedInputUsdPerMillion: parseNonNegativeNumber(config['TORVE_CACHED_INPUT_USD_PER_MILLION'], 'TORVE_CACHED_INPUT_USD_PER_MILLION', 0) } : {}),
      },
      ...(servicePricing ? { services: servicePricing } : {}),
    };

    const maxConcurrency = parseInt(config['TORVE_MAX_CONCURRENCY'] ?? '1', 10);
    if (Number.isNaN(maxConcurrency)) {
      throw new Error('TORVE_MAX_CONCURRENCY must be a valid number');
    }

    const allowedServices = config['TORVE_ALLOWED_SERVICES']
      ? config['TORVE_ALLOWED_SERVICES'].split(',').map((s: string) => s.trim())
      : [];
    const serviceApiProtocols = buildServiceApiProtocols(allowedServices, 'openai-chat-completions');
    const serviceRewriteMap = parseServiceAliasMap(config['TORVE_SERVICE_ALIAS_MAP_JSON']);
    const serviceCapabilities = parseServiceCapabilitiesJson(config['TORVE_SERVICE_CAPABILITIES_JSON']);

    const tokenProvider = apiKey ? new StaticTokenProvider(apiKey) : undefined;

    return new BaseProvider({
      name: 'local-llm',
      services: allowedServices,
      pricing,
      ...(serviceApiProtocols ? { serviceApiProtocols } : {}),
      ...(serviceCapabilities ? { serviceCapabilities } : {}),
      relay: {
        baseUrl,
        authHeaderName: 'authorization',
        authHeaderValue: apiKey ? `Bearer ${apiKey}` : '',
        tokenProvider,
        maxConcurrency,
        allowedServices,
        serviceRewriteMap,
      },
    });
  },
};

export default plugin;
