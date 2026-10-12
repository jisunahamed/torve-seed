import type { TorveProviderPlugin, Provider } from '@torveai/node';
import { BaseProvider, StaticTokenProvider, parseServiceAliasMap, parseNonNegativeNumber, parseServicePricingJson, buildServiceApiProtocols, parseServiceCapabilitiesJson } from '@torveai/provider-core';

const plugin: TorveProviderPlugin = {
  name: 'anthropic',
  displayName: 'Anthropic',
  version: '0.1.0',
  type: 'provider',
  description: 'Provide Anthropic API capacity using an API key',
  configSchema: [
    { key: 'ANTHROPIC_API_KEY', label: 'API Key', type: 'secret', required: true, description: 'Anthropic API key' },
    { key: 'TORVE_INPUT_USD_PER_MILLION', label: 'Input Price', type: 'number', required: false, default: 10, description: 'Input price in USD per 1M tokens' },
    { key: 'TORVE_OUTPUT_USD_PER_MILLION', label: 'Output Price', type: 'number', required: false, default: 10, description: 'Output price in USD per 1M tokens' },
    { key: 'TORVE_CACHED_INPUT_USD_PER_MILLION', label: 'Cached Input Price', type: 'number', required: false, description: 'Cached input price in USD per 1M tokens (defaults to input price)' },
    { key: 'TORVE_SERVICE_PRICING_JSON', label: 'Service Pricing JSON', type: 'string', required: false, description: 'Per-service pricing JSON' },
    { key: 'TORVE_MAX_CONCURRENCY', label: 'Max Concurrency', type: 'number', required: false, default: 10, description: 'Max concurrent requests' },
    { key: 'TORVE_ALLOWED_SERVICES', label: 'Allowed Services', type: 'string[]', required: false, description: 'Service allow-list' },
    { key: 'TORVE_SERVICE_ALIAS_MAP_JSON', label: 'Service Alias Map', type: 'string', required: false, description: 'JSON map of announced service → upstream model name' },
    { key: 'TORVE_SERVICE_CAPABILITIES_JSON', label: 'Service Capabilities JSON', type: 'string', required: false, description: 'Per-service model capability JSON' },
  ],

  createProvider(config: Record<string, string>): Provider {
    const apiKey = config['ANTHROPIC_API_KEY'];
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required');
    }

    const servicePricing = parseServicePricingJson(config['TORVE_SERVICE_PRICING_JSON']);
    const pricing: Provider['pricing'] = {
      defaults: {
        inputUsdPerMillion: parseNonNegativeNumber(config['TORVE_INPUT_USD_PER_MILLION'], 'TORVE_INPUT_USD_PER_MILLION', 10),
        outputUsdPerMillion: parseNonNegativeNumber(config['TORVE_OUTPUT_USD_PER_MILLION'], 'TORVE_OUTPUT_USD_PER_MILLION', 10),
        ...(config['TORVE_CACHED_INPUT_USD_PER_MILLION'] ? { cachedInputUsdPerMillion: parseNonNegativeNumber(config['TORVE_CACHED_INPUT_USD_PER_MILLION'], 'TORVE_CACHED_INPUT_USD_PER_MILLION', 0) } : {}),
      },
      ...(servicePricing ? { services: servicePricing } : {}),
    };

    const maxConcurrency = parseInt(config['TORVE_MAX_CONCURRENCY'] ?? '10', 10);
    if (Number.isNaN(maxConcurrency)) {
      throw new Error('TORVE_MAX_CONCURRENCY must be a valid number');
    }

    const allowedServices = config['TORVE_ALLOWED_SERVICES']
      ? config['TORVE_ALLOWED_SERVICES'].split(',').map((s: string) => s.trim())
      : [];

    const tokenProvider = new StaticTokenProvider(apiKey);
    const serviceApiProtocols = buildServiceApiProtocols(allowedServices, 'anthropic-messages');
    const serviceRewriteMap = parseServiceAliasMap(config['TORVE_SERVICE_ALIAS_MAP_JSON']);
    const serviceCapabilities = parseServiceCapabilitiesJson(config['TORVE_SERVICE_CAPABILITIES_JSON']);

    return new BaseProvider({
      name: 'anthropic',
      services: allowedServices,
      pricing,
      ...(serviceApiProtocols ? { serviceApiProtocols } : {}),
      ...(serviceCapabilities ? { serviceCapabilities } : {}),
      relay: {
        baseUrl: 'https://api.anthropic.com',
        authHeaderName: 'x-api-key',
        authHeaderValue: '',
        tokenProvider,
        maxConcurrency,
        allowedServices,
        serviceRewriteMap,
      },
    });
  },
};

export default plugin;
