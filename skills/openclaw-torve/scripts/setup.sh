#!/usr/bin/env bash
set -euo pipefail

# Setup Torve buyer proxy for OpenClaw
#
# Usage:
#   ./setup.sh --service moonshotai/kimi-k2.5 [--port 5005] [--bootstrap HOST:PORT] [--service-flag]
#
# Examples:
#   ./setup.sh --service moonshotai/kimi-k2.5
#   ./setup.sh --service moonshotai/kimi-k2.5 --port 5005 --bootstrap 108.128.178.49:6882 --service-flag
#   TORVE_BASE_URL=https://example.com/v1 TORVE_API_KEY=torve_... ./setup.sh --service moonshotai/kimi-k2.5

PORT=5005
SERVICE=""
SERVICE_NAME=""
BOOTSTRAP=""
INSTALL_SERVICE=false
CONTEXT_WINDOW=131072
MAX_TOKENS=8192

usage() {
  cat <<EOF
Usage: $0 --service <service-id> [options]

Required:
  --service <id>            Service ID available on the network (e.g., moonshotai/kimi-k2.5)

Options:
  --service-name <name>     Display name for the service (default: derived from service ID)
  --port <n>                Buyer proxy port (default: 5005)
  --bootstrap <host:port>   Bootstrap node address (e.g., 108.128.178.49:6882)
  --context-window <n>      Service context window size (default: 131072)
  --max-tokens <n>          Service max output tokens (default: 8192)
  --service-flag            Install as systemd service
  -h, --help                Show this help
EOF
  exit 1
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --service) SERVICE="$2"; shift 2 ;;
    --service-name) SERVICE_NAME="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --bootstrap) BOOTSTRAP="$2"; shift 2 ;;
    --context-window) CONTEXT_WINDOW="$2"; shift 2 ;;
    --max-tokens) MAX_TOKENS="$2"; shift 2 ;;
    --service-flag) INSTALL_SERVICE=true; shift ;;
    --help|-h) usage ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

if [ -z "$SERVICE" ]; then
  echo "Error: --service is required"
  usage
fi

if [ -z "$SERVICE_NAME" ]; then
  SERVICE_NAME="$SERVICE via Torve"
fi

BASE_URL="${TORVE_BASE_URL:-http://127.0.0.1:${PORT}/v1}"
API_KEY="${TORVE_API_KEY:-torve-p2p}"

echo "==> Installing Torve CLI..."
if ! command -v torve &>/dev/null; then
  npm install -g @torveai/cli
fi
echo "  CLI version: $(torve --version)"

echo "==> Installing buyer proxy plugin..."
torve plugin add @torveai/router-local </dev/null 2>&1 | tail -3 || true

# Add bootstrap node if specified
if [ -n "$BOOTSTRAP" ]; then
  BOOTSTRAP_HOST="${BOOTSTRAP%%:*}"
  BOOTSTRAP_PORT="${BOOTSTRAP##*:}"
  echo "==> Adding bootstrap node ${BOOTSTRAP_HOST}:${BOOTSTRAP_PORT}..."
  if [ -f ~/.torve/config.json ]; then
    python3 -c "
import json, sys
cfg = json.load(open('$HOME/.torve/config.json'))
nodes = cfg.setdefault('bootstrapNodes', [])
entry = {'host': '${BOOTSTRAP_HOST}', 'port': int('${BOOTSTRAP_PORT}')}
if entry not in nodes:
    nodes.append(entry)
json.dump(cfg, open('$HOME/.torve/config.json', 'w'), indent=2)
print('  Added to ~/.torve/config.json')
"
  else
    echo "  Warning: ~/.torve/config.json not found. Create it first with 'torve buyer start --help' or 'torve seller setup'."
  fi
fi

echo "==> Configuring OpenClaw service provider..."
if ! command -v openclaw &>/dev/null; then
  echo "Error: openclaw not found. Install it first: npm install -g openclaw"
  exit 1
fi

OPENCLAW_CONFIG="${OPENCLAW_CONFIG_PATH:-$HOME/.openclaw/openclaw.json}"
if [ ! -f "$OPENCLAW_CONFIG" ]; then
  echo "Error: OpenClaw config not found at $OPENCLAW_CONFIG"
  exit 1
fi

python3 -c "
import json, sys

cfg = json.load(open('${OPENCLAW_CONFIG}'))

# Set up service provider
providers = cfg.setdefault('models', {}).setdefault('providers', {})
providers['torve'] = {
    'baseUrl': '${BASE_URL}',
    'apiKey': '${API_KEY}',
    'authHeader': True,
    'api': 'anthropic-messages',
    'models': [{
        'id': '${SERVICE}',
        'name': '${SERVICE_NAME}',
        'reasoning': False,
        'input': ['text'],
        'contextWindow': ${CONTEXT_WINDOW},
        'maxTokens': ${MAX_TOKENS}
    }]
}

# Set as default service
cfg.setdefault('agents', {}).setdefault('defaults', {}).setdefault('model', {})['primary'] = 'torve/${SERVICE}'

json.dump(cfg, open('${OPENCLAW_CONFIG}', 'w'), indent=2)
print('  Provider configured: torve/${SERVICE}')
print('  Endpoint: ${BASE_URL}')
print('  Default service set: torve/${SERVICE}')
"

if [ "$INSTALL_SERVICE" = true ]; then
  echo "==> Installing systemd service..."
  TORVE_BIN=$(command -v torve)
  sudo tee /etc/systemd/system/torve-buyer.service > /dev/null <<SERVICE
[Unit]
Description=Torve Buyer Proxy
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$(whoami)
ExecStart=${TORVE_BIN} buyer start --router local --port ${PORT}
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=torve-buyer

[Install]
WantedBy=multi-user.target
SERVICE
  sudo systemctl daemon-reload
  sudo systemctl enable --now torve-buyer
  echo "  Service installed and started"
else
  echo ""
  echo "==> To start the buyer proxy:"
  echo "  torve buyer start --router local --port ${PORT}"
  echo ""
  echo "  Or install as a service with: $0 --service ${SERVICE} --service-flag"
fi

echo ""
echo "==> Apply the changes with: openclaw gateway restart"
echo "==> Done"
