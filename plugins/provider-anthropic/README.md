# @torveai/provider-anthropic

Provide Anthropic API capacity on the Torve P2P network using a commercial API key.

> **Important:** Simply reselling raw API access without adding value may violate your API provider's terms of service. Torve is designed for providers who build differentiated services on top of API access — for example, running inference inside a Trusted Execution Environment (TEE), packaging domain-specific skills or agents, fine-tuned models, or offering a managed product experience. Always review your API provider's usage policies before offering capacity on the network.

## Installation

```bash
torve plugin add @torveai/provider-anthropic
```

## Usage

```bash
# Secret lives in env
export ANTHROPIC_API_KEY=sk-ant-...

# Services, pricing, and categories live in config.json
torve config seller add-provider anthropic --plugin anthropic
torve config seller add-service anthropic claude-sonnet-4-5-20250929 \
  --input 3 --output 15 --cached 0.3 \
  --categories chat,coding

torve seller start
```

## Configuration

Only the upstream API key goes in env. Services, pricing, categories, and upstream model mapping all live under `seller.providers.<name>.services[id]` in `~/.torve/config.json`. See [Configuration](/docs/config) for the full shape.

| Key | Required | Description |
|-----|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key |

Set pricing / services via the CLI:

```bash
torve config seller add-service anthropic claude-sonnet-4-5-20250929 \
  --input 12 --output 18 --cached 6 \
  --categories coding,chat

torve config seller add-service anthropic claude-opus-4-5 \
  --input 15 --output 75 \
  --categories reasoning,coding
```

## How It Works

Uses `BaseProvider` and `StaticTokenProvider` from `@torveai/provider-core` to relay requests to `https://api.anthropic.com` with `x-api-key` authentication.
