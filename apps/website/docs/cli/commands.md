---
sidebar_position: 1
slug: /commands
title: CLI Commands
sidebar_label: Commands
hide_title: true
---

# CLI Commands

### Getting started

```bash title="setup"
torve seller setup                  Initialize seller onboarding
torve buyer start                   Start the buyer proxy
```

In normal use, you configure the node once with `torve seller setup` or `torve config ...`, then start it later with `torve seller start` or `torve buyer start` without repeating flags every time. Secrets such as API keys stay in env vars; provider definitions, services, pricing, capabilities, unit billing, and `baseUrl` live in `~/.torve/config.json`.

### Providing (selling)

```bash title="provider"
torve seller start                  Start providing AI services
torve seller start --base-rpc-url <url>
                                      Use a custom Base RPC URL for this run
torve seller register               Register peer identity on-chain (ERC-8004)
torve seller stake <ants> --epochs <n>
                                      Stake ANTS only (optional; requires the upgrade)
torve seller legacy stake <amount>  Stake USDC as a provider (pre-cutover, min $10)
torve seller legacy unstake         Withdraw legacy USDC stake
torve seller legacy claim-starter   Claim the legacy-seller starter ANTS position
torve seller pool positions         List pool positions
torve seller pool withdraw <id...>  Withdraw positions (`--accept-slashing` for early exit)
torve seller rewards [claim]        View or claim all seller rewards
```

### ANTS staking

```bash title="ants"
torve ants                          Open the local staking dashboard (wallet-signed; --port, --no-open)
torve ants status                   Phase, epoch countdown, balances, stake, claimable rewards
torve ants stake <ants> --agent <id> --epochs <n>
                                      Stake ANTS into any registered seller pool
torve ants positions                Open lANTS positions with state, pending rewards, exit slash
torve ants move <id...> --to <id>   Move positions to another pool (terms preserved)
torve ants split <id> <ants>        Split a position; torve ants merge <id...> merges same-pool positions
torve ants extend <id> --epochs <n> Extend a lock; torve ants max-lock <id> [--off] toggles max lock
torve ants withdraw <id...> [--preview] [--accept-slashing]
                                      Withdraw with a slashing estimate and explicit consent
torve ants rewards [claim]          View or claim staker, seller, buyer, legacy, and locked rewards
torve ants rewards compound --epochs <n> [--to <agentId>]
                                      Restake every restakable reward into new positions (optionally moved into one pool)
torve ants rewards restake --epochs <n>
                                      Restake staker pool rewards only
torve ants rewards stake-usage --side <seller|buyer> --epochs <n>
                                      Claim usage rewards straight into a position
torve ants pools | pool <id>        Compare pools: power, share, volume per epoch, ANTS per 1k power, your share
torve ants usage | emissions | addresses
                                      Usage points per epoch, emission schedule, contract addresses
torve ants seller [register|claim-starter]
                                      Seller binding, eligibility, starter grant
torve ants verify [seller]          Wash-trading registry facts and per-seller status
torve ants verify submit <artifact.json>
                                      Stage, authenticate, and finalize a seller proof (resumable)
torve ants verify proof <proofId>   Proof submission progress
```

Every dashboard action maps to one of these commands; the dashboard runs on
`127.0.0.1` and signs with the node wallet.

### Buying (consuming)

```bash title="buyer"
torve buyer start                   Start the buyer proxy
torve buyer start --router <name>   Start the buyer proxy with a non-default router
torve buyer deposit                       Show funding address + QR; incoming USDC deposits automatically (gasless)
torve buyer sweep                   Gaslessly sweep hot-wallet USDC into deposits (fixed relay fee)
torve buyer deposit --onchain <usdc>  Direct on-chain deposit from the hot wallet (requires ETH for gas)
torve buyer withdraw <amount>       Withdraw USDC from deposits
torve buyer set-authorized-wallet   Connect and authorize an external wallet (`--self` for the buyer wallet)
torve buyer activity                Activity summary: tokens, spend history, savings, channels, claimable ANTS
torve buyer balance                 Check wallet and deposit balance
torve network browse                Browse peers, models, and pricing (same catalog as /v1/models)
```

### Network and monitoring

```bash title="network"
torve seller status                 Show seller status
torve seller doctor                 Diagnose the announced seller endpoint
torve buyer status                  Show buyer status
torve metrics serve                 Serve Prometheus-compatible buyer/seller metrics
torve config                        Manage config file
torve peer <peerId>                 View a peer's profile
torve profile                       Manage your peer profile
torve buyer channels                List payment channels
torve network bootstrap             Run a dedicated DHT bootstrap node
torve buyer connection              Manage connection settings
torve dev                           Run seller + buyer locally for testing
```

### Service configuration

`torve config seller add-service <provider> <serviceId>` supports:

| Option | Purpose |
|---|---|
| `--upstream <model>` | Map the public service ID to an upstream model ID |
| `--input`, `--cached`, `--output` | Token prices in USD per million tokens |
| `--categories <csv>` | Discovery tags |
| `--capabilities <json>` | Model hints such as context window, input modalities, reasoning, and tool use |
| `--unit-billing-models <json>` | Per-protocol non-token billing, currently used by `openai-images` |
| `--base-url <url>` | Set the provider-wide upstream base URL |

```bash
torve config seller add-service openai flux.1-schnell \
  --upstream "black-forest-labs/FLUX.1-schnell" \
  --input 0 --output 0 \
  --capabilities '{"inputs":["text","image"]}' \
  --unit-billing-models '{"openai-images":{"version":1,"components":[{"unit":"output_images","priceUsd":0.003}]}}'
```

`torve seller setup` exposes the same capability and unit-billing fields interactively. `torve seller start` warns if unit billing is configured for a plugin that does not support it. Image services are not health-probed because a meaningful probe would incur an upstream generation charge.

Before deploying this CLI version to sellers, follow the [metadata v12 upgrade order](/docs/guides/metadata-v12-upgrade): upgrade buyers first, then sellers.
