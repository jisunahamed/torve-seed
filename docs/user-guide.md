# Torve User Guide

Use **Torve Desktop** or the **`@torveai/torve` CLI** to route your local AI coding tools through **Torve Cloud** via a secure loopback proxy (`http://127.0.0.1:8378`) with automatic config backup/restore, model catalog sync, and per-app model controls.

---

## 1. Torve Desktop (Windows)

### Install & Sign In
1. Run `Torve-Desktop-Setup-<version>.exe` (one-click installer for Windows).
2. Click **Sign In** to authenticate with your Torve account via browser PKCE OAuth (`sk-trv-...` credentials are encrypted locally on your device).
3. Once signed in, the local Torve proxy starts automatically on `http://127.0.0.1:8378`.

### Supported Apps (6 Active Integrations)
Open **Connected Apps** in Torve Desktop to toggle apps **ON** or **OFF**:

| App ID | App Name | What Gets Configured |
| :--- | :--- | :--- |
| `antigravity` | **Google Antigravity** | Native Model Picker integration (+ MCP bridge fallback) |
| `codex` | **Codex** (`Codex Desktop` & `Codex CLI`) | `~/.codex/config.toml`, model catalog cache, and safe SQLite old-thread migration |
| `opencode` | **OpenCode** (`OpenCode Desktop` & `OpenCode CLI`) | `~/.config/opencode/opencode.jsonc` (`torve` provider + 1M context / 32K output floors) |
| `claude-desktop` | **Claude Desktop** (`</> Code` tab) | Third-party API profile pointing to local Anthropic gateway (`127.0.0.1:8380` -> `127.0.0.1:8378`) + `~/.claude/settings.json` |
| `claude-code` | **Claude Code CLI** | `~/.claude/settings.json` |
| `gemini-cli` | **Gemini CLI** | `~/.gemini/settings.json` & `~/.gemini/.env` |

Apps listed under **Coming Soon** (`Cursor`, `Cline / Roo Code`, `Aider`, `Continue`) are shown disabled until official support ships. Apps not detected on your machine display a **Not Installed** badge; install the app first and click **Refresh Apps**.

### Safe Backups & Non-Destructive Rollback
- Before patching any app config, Torve saves an atomic snapshot under `~/.torve/backups/`.
- Turning an app **OFF** restores your original configuration cleanly.
- **Codex Old Chats:** Turning **Codex ON** closes running Codex processes, backs up `%USERPROFILE%\.codex\state_*.sqlite` (`+ -wal / -shm`) to `~/.torve/backups/codex/sqlite-safety/`, and migrates older threads inside a SQLite transaction (`migrated-threads.json`). Turning **Codex OFF** restores only previously migrated thread IDs so **any new chats created while Torve was ON stay 100% intact**.

### Action Required & Auto-Updates
- **Overview -> Action Required:** Automatically highlights when an app needs a restart, Antigravity needs its Native Picker re-applied, or your account/proxy needs attention, with a 1-click fix button.
- **Auto-Updates:** Torve Desktop silently checks for updates 5 seconds after launch and every 4 hours, downloads verified updates in the background, and displays **`Restart to Install`** when ready.

---

## 2. Torve CLI (`@torveai/torve`)

The **`torve`** command works both **alongside Torve Desktop** (sharing `~/.torve/` and detecting the Desktop proxy) and **100% standalone** over SSH or terminal-only machines.

### Requirements
- **Node.js `>= 20`** (`Node 22.5+` recommended for automatic SQLite Codex old-thread migration via `node:sqlite`)

### Install

```powershell
# If you previously installed the older @torveai/cli package, remove it first:
npm uninstall -g @torveai/cli

# Install the CLI globally:
npm install -g @torveai/torve
```

Verify installation:

```powershell
torve --version
torve --help
```

### Authentication

```powershell
# Interactive browser PKCE login
torve login

# Headless / SSH login with an API key
torve login --token sk-trv-your-key

# Remove CLI credentials (keep shared ~/.torve files)
torve logout

# Clear CLI credentials + shared ~/.torve state
torve logout --all
```

### Manage Connected Apps

```powershell
# List all 6 supported apps, install detection, ON/OFF state, and Coming Soon list
torve apps

# Connect a specific app (creates backup + patches config + restarts if needed)
torve on codex
torve on antigravity
torve on opencode
torve on claude-desktop
torve on claude-code
torve on gemini-cli

# Connect every detected app at once
torve on all

# Disconnect a specific app (restores original config backup & Codex old threads)
torve off codex

# Disconnect all connected apps
torve off all
```

### Run & Inspect the Local Proxy

```powershell
# Start standalone loopback proxy on http://127.0.0.1:8378 (background daemon)
torve start

# Run in the foreground or on a custom port
torve start --foreground
torve start --port 8378 --daemon

# Stop the CLI-started proxy daemon (never kills Torve Desktop)
torve stop

# View account status, proxy health, and connected apps
torve status
torve status --json

# List available Torve Cloud models with context/output limits
torve models
torve models --json
```

### CLI Options Reference

| Flag | Description |
| :--- | :--- |
| `--port <n>`, `-p <n>` | Override loopback proxy port (default `8378` or `TORVE_CLOUD_PROXY_PORT`) |
| `--token <key>`, `-t <key>` | Pass API key directly (for headless `login` or per-command auth) |
| `--foreground`, `-f` | Run `torve start` in the foreground |
| `--daemon`, `-d` | Run `torve start` in the background (default) |
| `--all` | Clear shared `~/.torve/` state when running `torve logout` |
| `--json` | Emit machine-readable JSON output |
| `-h`, `--help` | Show CLI usage |
| `-v`, `--version` | Show CLI version |

---

## 3. Troubleshooting

- **Codex old conversation says `"This model isn't available"` or returns `403`:**
  1. Close **Codex** completely (Desktop + CLI).
  2. Toggle **Codex OFF** and back **ON** (`torve off codex` then `torve on codex`, or toggle in Torve Desktop).
  3. Make sure the Torve proxy (`http://127.0.0.1:8378`) is running (`torve status`). Older non-catalog/renamed models in old thread histories or context compaction are automatically mapped to working Torve models.
- **`torve` command shows an old version (`1.0.12`) after installing:**
  Run `npm uninstall -g @torveai/cli` and `npm install -g @torveai/torve`, then open a fresh terminal.
- **Check health anytime:**
  Run `torve status` to confirm your account, proxy status (`127.0.0.1:8378`), and active connected apps.
