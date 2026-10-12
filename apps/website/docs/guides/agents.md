---
sidebar_position: 3
slug: /guides/agents
title: Connect Agents
description: Connect Hermes, OpenClaw, and other agents to the Torve AI VPN locally or through an authenticated public HTTPS endpoint.
---

# Connect Agents

The Torve AI VPN exposes the models selected by your routing policy through an OpenAI- and Anthropic-compatible API. An agent can connect in either of two ways:

- **Local agent** — use the buyer API on the same computer at `http://127.0.0.1:8377/v1`.
- **Remote agent or hosted client** — define an authenticated internet-accessible endpoint from the AI VPN's **Agents** view.

The public endpoint is useful for agents on another server, hosted development tools such as Cursor, CI workers, and custom applications that cannot reach your computer's `localhost` address.

## Agent setup skills

Use the maintained setup skill for the agent you want to connect:

- [Hermes integration](/integrations/hermes) and [Hermes Agent skill](https://github.com/Torve/torve/tree/main/skills/hermes-torve) — configure the current Hermes `providers:` schema, select models, fund the buyer, and use local or public endpoints.
- [OpenClaw integration](/integrations/openclaw) and [OpenClaw skill](https://github.com/Torve/torve/tree/main/skills/openclaw-torve) — configure Torve under `models.providers`, including bearer-header authentication for a public endpoint.

For another agent, use its custom OpenAI or Anthropic provider settings with the base URL and API key described below. See [Using the API](/docs/guides/using-the-api) for request formats and routing behavior.

## Connect locally

Use the local endpoint when the agent runs on the same computer as the AI VPN:

```bash
export TORVE_BASE_URL="http://127.0.0.1:8377/v1"
export TORVE_API_KEY="torve-p2p"
```

The local buyer proxy does not validate an API key, but many agent SDKs require a non-empty value. The `torve-p2p` value is only a placeholder.

Test model discovery:

```bash
curl "$TORVE_BASE_URL/models" \
  -H "Authorization: Bearer $TORVE_API_KEY"
```

### Hermes

Current Hermes releases store named custom endpoints under `providers:`. Add Torve in `~/.hermes/config.yaml`:

```yaml
model:
  provider: torve
  default: torve
  base_url: ""
  api_mode: chat_completions

providers:
  torve:
    name: Torve
    api: http://127.0.0.1:8377/v1
    api_key: torve-p2p
    transport: chat_completions
    extra_headers:
      originator: hermes
    default_model: torve
    models:
      torve:
        context_length: 200000
      minimax-m2.7:
        context_length: 200000
      kimi-k2.6:
        context_length: 256000
```

The `torve` model follows the current AI VPN model picker. Add concrete IDs returned by `GET /v1/models` when you want them in Hermes' model menu. The [Hermes Agent skill](https://github.com/Torve/torve/tree/main/skills/hermes-torve) covers funding, systemd, auxiliary models, and routing in detail.

### OpenClaw

Add Torve under `models.providers` in `~/.openclaw/openclaw.json`:

```json
{
  "models": {
    "providers": {
      "torve": {
        "baseUrl": "http://127.0.0.1:8377/v1",
        "apiKey": "torve-p2p",
        "authHeader": true,
        "api": "anthropic-messages",
        "models": [
          {
            "id": "kimi-k2.6",
            "name": "Kimi K2.6 via Torve",
            "reasoning": false,
            "input": ["text"],
            "contextWindow": 256000,
            "maxTokens": 8192
          }
        ]
      }
    }
  }
}
```

Then run `openclaw models set "torve/kimi-k2.6"` followed by `openclaw gateway restart`. `authHeader: true` makes OpenClaw send the API key as `Authorization: Bearer <API_KEY>`, which is required by the public gateway and also works locally. See the [OpenClaw skill](https://github.com/Torve/torve/tree/main/skills/openclaw-torve) for the complete walkthrough and setup script.

## Connect a remote agent

When the agent cannot reach the AI VPN on `localhost`, first create an authenticated endpoint by following the [Public HTTPS Tunnels guide](/docs/guides/public-tunnels). That guide is the canonical reference for ngrok and Cloudflare setup, authentication, supported routes, CLI commands, Cursor, and troubleshooting.

After the endpoint starts, replace the local placeholder values in the configuration above with the values shown by the AI VPN:

| Agent | Public endpoint field | Torve API key field |
|---|---|---|
| Hermes | `providers.torve.api` | `providers.torve.api_key` |
| OpenClaw | `models.providers.torve.baseUrl` | `models.providers.torve.apiKey` |

Use the complete public base URL ending in `/v1`. For OpenClaw, keep `authHeader: true` so it sends the generated Torve key as a bearer token.

For another agent, use its custom OpenAI- or Anthropic-compatible provider settings. See [Using the API](/docs/guides/using-the-api) for request formats and model routing.
