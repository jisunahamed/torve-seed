---
sidebar_position: 2
slug: /flags
title: Global Flags
sidebar_label: Flags
hide_title: true
---

# Global Flags

```bash title="flags"
-c, --config <path>     Path to config file (default: ~/.torve/config.json)
--data-dir <path>       Path to node identity/state directory (env: TORVE_DATA_DIR, default: ~/.torve)
-v, --verbose            Enable verbose logging
--version                Show version
--help                   Show help
```

`--data-dir` controls buyer/seller identity and runtime state: `identity.key`, `buyer.state.json`, SQLite databases, and payment-channel files. Use a separate data directory for each independent buyer process. The environment-variable equivalent is `TORVE_DATA_DIR=<path>`; prefer the explicit flag in service manager commands.

## Buyer Start Flags

`torve buyer start` also supports runtime-only overrides for buyer discovery:

```bash title="buyer start"
--metadata-fetch-timeout-ms <number>    Timeout for each peer metadata HTTP fetch during discovery
```

The same value can be supplied with `TORVE_BUYER_METADATA_FETCH_TIMEOUT_MS`. Precedence is: flag, environment variable, `buyer.metadataFetchTimeoutMs`, built-in default.

## Seller Start Flags

`torve seller start` also supports runtime-only overrides for seller operations:

```bash title="seller start"
--base-rpc-url <url>    Base JSON-RPC endpoint for seller on-chain operations
```

The same value can be supplied with `TORVE_BASE_RPC_URL`. Precedence is: flag, environment variable, `payments.crypto.rpcUrl`, built-in default.

Service capabilities and image unit pricing are durable service configuration rather than `seller start` flags. Set them with:

```bash
torve config seller add-service <provider> <service> \
  --capabilities '<json>' \
  --unit-billing-models '<json>'
```

They can also be entered in `torve seller setup` or written directly under `seller.providers.<provider>.services.<service>` in `config.json`.

## Metrics Flags

`torve metrics serve` also supports:

```bash title="metrics"
--role <buyer|seller|both|auto>
--host <host>
--port <port>
--path <path>
--instance <name>
--include-chain
```

See [Metrics](/docs/guides/metrics) for details.

## Environment Variables

| Variable | Description |
|---|---|
| `TORVE_IDENTITY_HEX` | secp256k1 private key (64 hex chars). When set, used instead of `identity.key` file. Cleared from process environment after read. |
| `TORVE_DATA_DIR` | Node identity/state directory when `--data-dir` is not supplied. Use separate values for independent buyer processes. |
| `TORVE_DEBUG` | Enable verbose runtime logs (`0` or `1`) |
| `TORVE_ENV_FILE` | Override env file path for runtime env loading |
| ~~`TORVE_ALLOWED_SERVICES`~~ | Removed as a user-facing env var. The set of announced services is now derived from the keys under `seller.providers[name].services` in `config.json`. The CLI still injects the env var for plugins internally. |
| `TORVE_ENABLE_SETTLEMENT` | Enable on-chain settlement (`true`/`false`) |
| `TORVE_BASE_RPC_URL` | Base JSON-RPC endpoint override for seller on-chain operations |
| `TORVE_BUYER_METADATA_FETCH_TIMEOUT_MS` | Buyer peer-discovery metadata fetch timeout in milliseconds |
| `TORVE_SETTLEMENT_IDLE_MS` | Settlement idle timeout in milliseconds |
| `TORVE_DEFAULT_SESSION_USDC` | Default session authorization amount in USDC |
| `TORVE_AUTO_FUND_DEPOSIT` | Auto-fund deposit on session start (`true`/`false`) |
| `TORVE_SELLER_WALLET_ADDRESS` | Seller EVM wallet address override |
| `TORVE_METRICS_ROLE` | Metrics exporter role (`buyer`, `seller`, `both`, or `auto`) |
| `TORVE_METRICS_HOST` | Metrics exporter listen host |
| `TORVE_METRICS_PORT` | Metrics exporter listen port |
| `TORVE_METRICS_PATH` | Metrics endpoint path |
| `TORVE_METRICS_INSTANCE` | Metrics `instance` label |
