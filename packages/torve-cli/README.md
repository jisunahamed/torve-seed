# `@torveai/torve-cli`

Standalone, cross-platform companion CLI for **Torve Cloud** — zero Electron runtime dependencies, zero P2P/blockchain packages, built purely on Node.js (`>= 20`) standard library modules.

Works on **Windows**, **macOS**, and **Linux** either:
- **Alongside Torve Desktop**: automatically detects a running `127.0.0.1:8378` Desktop proxy and shares `~/.torve/` state (`models-cache.json`, `backups/`, `direct-cloud-profiles.json`).
- **100% Standalone**: authenticates via PKCE browser login or `--token`, runs a lightweight loopback HTTP proxy (`127.0.0.1:8378`) supporting `/v1/models`, `/v1/chat/completions`, `/v1/responses`, `/v1/messages`, and `/v1beta`, and persists CLI state in `~/.torve/config.json` and `~/.torve/proxy.pid`.

## Installation

```bash
npm install -g @torveai/torve-cli
```

Or run directly from the monorepo:

```bash
node packages/torve-cli/dist/cli.js --help
```

## Commands

### Authentication

```bash
# Browser PKCE OAuth login
torve login

# Headless / SSH login with an API key
torve login --token torve_...

# Clear CLI credentials (or add --all to also clear shared ~/.torve/ state)
torve logout
torve logout --all
```

### Connected AI Apps

```bash
# List supported apps, disk detection, and ON/OFF status
torve apps

# Back up and patch an app (or all detected apps) to route via Torve proxy
torve on opencode
torve on codex
torve on claude-code
torve on gemini-cli
torve on all

# Restore original backup or unpatch
torve off codex
torve off all
```

Supported apps: `opencode`, `codex`, `claude-code`, `claude-desktop`, `gemini-cli`, `antigravity`, `cursor` (manual endpoint instructions), `aider`, `continue`, `hermes`, `droid`, `t3code`, `pi`, `crush`, `goose`, `zed`.

### Local Proxy & Diagnostics

```bash
# Start standalone proxy daemon on 127.0.0.1:8378 (no-op if Desktop proxy is live)
torve start
torve start --port 8378 --foreground

# Stop CLI-started proxy daemon (never kills Torve Desktop)
torve stop

# Fetch Torve Cloud models with context window and max output limits
torve models

# Check account, proxy health, and connected apps summary
torve status
torve status --json
```

## Global Flags

- `--port <n>`: Override proxy port (default `8378` or `TORVE_CLOUD_PROXY_PORT`)
- `--token <api_key>`: Provide Torve API key directly
- `--foreground`: Run `torve start` in foreground
- `--daemon`: Run `torve start` detached in background (default)
- `--all`: Clear shared `~/.torve/` state in `torve logout`
- `--json`: Machine-readable JSON output
- `-h, --help`: Show help
- `-v, --version`: Show CLI version
