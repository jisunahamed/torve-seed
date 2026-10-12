# @torveai/provider-core

Shared infrastructure for building Torve provider plugins. Handles HTTP relaying, authentication, token management, and model validation so plugin authors can focus on provider-specific logic.

## Installation

```bash
pnpm add @torveai/provider-core
```

Peer dependency: `@torveai/node >= 0.1.0`

## Key Exports

### BaseProvider

Implements the `Provider` interface with built-in HTTP relay support. Most provider plugins use this as their foundation.

```ts
import { BaseProvider, StaticTokenProvider } from '@torveai/provider-core';

const provider = new BaseProvider({
  name: 'my-provider',
  services: ['model-a', 'model-b'],
  pricing: { defaults: { inputUsdPerMillion: 10, cachedInputUsdPerMillion: 1, outputUsdPerMillion: 10 } },
  serviceCategories: { 'model-a': ['coding'] },
  relay: {
    baseUrl: 'https://api.example.com',
    authHeaderName: 'Authorization',
    authHeaderValue: '',
    tokenProvider: new StaticTokenProvider('Bearer sk-...'),
    maxConcurrency: 10,
    allowedServices: ['model-a', 'model-b'],
    serviceRewriteMap: {
      'model-a': 'together/model-a',
    },
  },
});
```

### Token Providers

- **`StaticTokenProvider`** -- Wraps a static API key with no refresh logic.
- **`OAuthTokenProvider`** -- Manages OAuth access/refresh token pairs with automatic renewal.
- **`createTokenProvider()`** -- Factory that creates the right provider based on auth type.

### Utilities

- **`swapAuthHeader()`** -- Injects/replaces authentication headers on outgoing requests.
- **`validateRequestService()`** -- Validates request body `model` field against an allow-list.
- **`KNOWN_AUTH_HEADERS`** -- Standard auth header names (x-api-key, Authorization, etc.).

### HttpRelay

Low-level HTTP relay with concurrency control, SSE streaming support, model validation, and optional request model rewriting (`serviceRewriteMap`). Used internally by `BaseProvider`.

## Usage in Plugins

```ts
import type { TorveProviderPlugin } from '@torveai/node';
import { BaseProvider, StaticTokenProvider } from '@torveai/provider-core';

const plugin: TorveProviderPlugin = {
  name: 'my-provider',
  displayName: 'My Provider',
  version: '0.1.0',
  type: 'provider',
  description: 'My custom provider',
  configSchema: [
    { key: 'API_KEY', label: 'API Key', type: 'secret', required: true, description: 'API key' },
  ],
  createProvider(config) {
    return new BaseProvider({
      name: 'my-provider',
      services: ['default-model'],
      pricing: { defaults: { inputUsdPerMillion: 10, cachedInputUsdPerMillion: 1, outputUsdPerMillion: 10 } },
      relay: {
        baseUrl: 'https://api.example.com',
        authHeaderName: 'Authorization',
        authHeaderValue: '',
        tokenProvider: new StaticTokenProvider(`Bearer ${config['API_KEY']}`),
        maxConcurrency: 10,
        allowedServices: ['default-model'],
      },
    });
  },
};

export default plugin;
```
