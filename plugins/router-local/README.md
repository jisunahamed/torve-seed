# @torveai/router-local

Local router for AI coding tools. Drop-in replacement for `ANTHROPIC_BASE_URL` or `OPENAI_BASE_URL` that routes requests through the Torve P2P network.

## Installation

```bash
torve plugin add @torveai/router-local
```

## Usage

```bash
torve buyer start

# Then configure your tools:
export ANTHROPIC_BASE_URL=http://localhost:8377
```

Works with Claude Code, Aider, Continue.dev, OpenAI Codex, and any tool that supports custom base URLs.

## Configuration

| Key | Type | Required | Default | Description |
|-----|------|----------|---------|-------------|
| `TORVE_MIN_REPUTATION` | number | No | 50 | Minimum peer reputation (0-100) |
| `TORVE_MAX_PRICING_JSON` | string | No | -- | Max pricing config as JSON |
| `TORVE_MAX_FAILURES` | number | No | 3 | Max failures before cooldown |
| `TORVE_FAILURE_COOLDOWN_MS` | number | No | 30000 | Cooldown duration after failures (ms) |
| `TORVE_MAX_PEER_STALENESS_MS` | number | No | 300000 | Max age of peer info before deprioritizing |

## Max Pricing

Set maximum prices you're willing to pay:

```bash
export TORVE_MAX_PRICING_JSON='{"defaults":{"inputUsdPerMillion":20,"cachedInputUsdPerMillion":10,"outputUsdPerMillion":60}}'
```

Or with per-provider overrides:

```bash
export TORVE_MAX_PRICING_JSON='{"defaults":{"inputUsdPerMillion":20,"cachedInputUsdPerMillion":10,"outputUsdPerMillion":60},"providers":{"anthropic":{"services":{"claude-sonnet-4-5-20250929":{"inputUsdPerMillion":15,"cachedInputUsdPerMillion":8,"outputUsdPerMillion":75}}}}}'
```

## How It Works

Uses `scoreCandidates` and `PeerMetricsTracker` from `@torveai/router-core`. Scores peers on price, latency, capacity, reputation, freshness, and reliability. Enforces max pricing limits. Peers that exceed price limits or fail repeatedly are excluded.
