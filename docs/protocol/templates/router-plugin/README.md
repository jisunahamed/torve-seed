# Build a Torve Router Plugin

This template shows how to publish a **router plugin** for the Torve Network. A router plugin implements general buyer policy and peer-selection logic based on latency, price, reputation, or custom criteria. The CLI buyer proxy additionally applies the shared model-route planner to model-only requests so `/v1/models`, Desktop, and API dispatch agree on seller ordering.

## How It Works

```
torve buyer start --router lowest-latency
       ↓
CLI loads torve-router-lowest-latency from ~/.torve/plugins/
       ↓
plugin.createRouter(config) → Router
       ↓
TorveNode (buyer mode) calls router.selectPeer() for generic requests
       ↓
CLI model-only requests resolve canonical offers, apply router policy,
then rank eligible offers with @torveai/node/model-routing
```

Your plugin owns general peer policy and generic selection. Discovery, canonical model matching, transport, metering, and payments are handled by the node and buyer proxy. Explicit peer pins remain hard overrides.

## Quick Start

```bash
npm install
npm run verify     # check the plugin satisfies the interface
npm run build      # compile to dist/
```

To test end-to-end with the CLI:

```bash
torve plugin add ./   # install this package as a plugin
torve buyer start --router lowest-latency
```

## Customization

Replace `LowestLatencyRouter` in `src/router.ts` with your own selection strategy:

```ts
import type { Router } from '@torveai/node';
import type { PeerInfo, SerializedHttpRequest } from '@torveai/node/types';

export class CheapestRouter implements Router {
  selectPeer(_req: SerializedHttpRequest, peers: PeerInfo[]): PeerInfo | null {
    if (peers.length === 0) return null;
    // Sort by price ascending, fall back to latency
    return [...peers].sort((a, b) =>
      (a.defaultInputUsdPerMillion ?? Number.POSITIVE_INFINITY) -
      (b.defaultInputUsdPerMillion ?? Number.POSITIVE_INFINITY)
    )[0] ?? null;
  }

  onResult(_peer: PeerInfo, _result: { success: boolean; latencyMs: number; tokens: number }): void {
    // Update internal state (latency EMA, reputation, etc.)
  }
}
```

Then update `src/index.ts` to use the new class and adjust `name`, `displayName`, and `configKeys`.

## DefaultRouter

`@torveai/node` ships a built-in router that filters by minimum reputation score and sorts by price:

```ts
import { DefaultRouter } from '@torveai/node';
const router = new DefaultRouter({ minReputation: 70 }); // default is 0 (no reputation gate)
```

That `DefaultRouter` behavior is the generic SDK fallback. In the CLI buyer proxy, a bare model id is planned with the shared Price + Trust preferences after router-policy checks. The model-route default `minTrustScore` is `60`, independent of the generic router's `minReputation` default.

## Publishing

```bash
npm publish

# Users install with:
torve plugin add my-router-package
torve buyer start --router my-router
```

## Verification

```bash
npm run verify
```

## Interface Reference

### `Router`

```ts
interface Router {
  selectPeer(req: SerializedHttpRequest, peers: PeerInfo[]): PeerInfo | null;
  onResult(peer: PeerInfo, result: {
    success: boolean;
    latencyMs: number;
    tokens: number;
  }): void;
}
```

- `selectPeer` — called before each request. Return the peer to route to, or `null` to skip.
- `onResult` — called after each request completes. Update latency, reputation, or other routing state.

### `TorveRouterPlugin`

| Property | Type | Description |
|---|---|---|
| `type` | `'router'` | Must be `'router'` |
| `name` | `string` | Short ID, e.g. `'local'` |
| `displayName` | `string` | Human-readable label |
| `version` | `string` | Semantic version (e.g. `'1.0.0'`) |
| `description` | `string` | Short description of the plugin |
| `configSchema` | `ConfigField[]` | Plugin configuration fields |
| `createRouter(config)` | `Router \| Promise<Router>` | Factory |

## Links

- [@torveai/node source](https://github.com/Torve/node)
- [Router interface](https://github.com/Torve/node/tree/main/src/interfaces/buyer-router.ts)
- [Official local router](https://github.com/Torve/router-local)
- [Provider plugin template](../provider-plugin/)
