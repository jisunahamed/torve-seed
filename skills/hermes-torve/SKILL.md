---
name: hermes-torve
description: "Connect Hermes Agent to the Torve P2P AI network. Install and fund the buyer, configure Hermes' current providers schema, and use either the local AI VPN endpoint or its authenticated public tunnel. Use when: user asks to connect Hermes to Torve, set up a remote Hermes agent, deposit funds, or change the routed model."
user-invocable: true
metadata: { "hermes-torve": { "emoji": "🐝" } }
---

# Connect Hermes to Torve

Set up Torve as the model backend for a Hermes agent. Torve is a P2P network of AI service providers, and its buyer proxy routes Hermes model calls through the network. Hermes can connect locally or through the AI VPN's authenticated public endpoint.

## Picture

```
Hermes agent  →  local buyer proxy or HTTPS tunnel  →  Torve P2P  →  Provider peer
```

- Buyer proxy discovers providers via DHT, opens a payment channel per seller, signs per-request vouchers.
- Exposes an OpenAI-compatible `/v1/*` endpoint configured under `providers.<name>` in `~/.hermes/config.yaml`.
- The model ID Hermes passes is an id or alias from Torve's network-wide `/v1/models` catalog (e.g. `minimax-m2.7`). The proxy resolves it to the selected seller's actual advertised service id.

When Hermes runs on the buyer machine, use the local endpoint. When it runs elsewhere, use the authenticated endpoint generated under **AI VPN → Agents → Define your internet-accessible Torve endpoint**. Never expose port `8377` directly to the internet.

## Before you start

Ask the user anything you don't already have:

- **Where Hermes is running** — beside the AI VPN/buyer proxy, or on a remote host that will use the AI VPN's authenticated HTTPS endpoint.
- **Chain** — `base-mainnet` for real funds, `base-sepolia` for testnet. Default to `base-mainnet` unless the user says otherwise.

---

## Install the CLI

```bash
npm install -g @torveai/cli
torve --version
```

Requires Node.js 20+. Latest version: `npm view @torveai/cli version`. A global `npm install` can take 1–3 minutes — use a long timeout.

## Chain configuration

Always create `~/.torve/config.json` with `payments.crypto.chainId` set. Without it, the `torve buyer deposit` CLI command fails with "No crypto payment configuration found" and the buyer proxy cannot open payment channels.

```json
{
  "network": {},
  "buyer": {
    "maxPricing": {
      "defaults": {
        "inputUsdPerMillion": 100,
        "outputUsdPerMillion": 100
      }
    }
  },
  "payments": {
    "preferredMethod": "crypto",
    "crypto": {
      "chainId": "base-mainnet"
    }
  }
}
```

**Do not hardcode contract addresses.** `@torveai/node` resolves Deposits, Channels, USDC, and the RPC URL from `chainId` via its built-in chain-config presets. Hardcoded addresses drift when contracts redeploy; the preset is the source of truth.

To switch chains later, edit only `chainId` (`base-mainnet` ↔ `base-sepolia`) and restart the buyer.

## Identity and the buyer wallet

The buyer needs an EVM identity — a 32-byte secp256k1 private key supplied via the `TORVE_IDENTITY_HEX` env var (64 hex chars, optional `0x` prefix), or already present in `~/.torve/identity.key`.

The EVM address derived from that key is your **buyer wallet**. It only needs:

- **USDC on the target chain** — used as payment channel reserves, deposited via the payments portal

**The buyer wallet does NOT need ETH or any native token for gas.** All on-chain transactions (channel reserve, settle, close) are initiated by the seller. The buyer only signs off-chain messages.

**Never move `identity.key` off the host that runs the buyer.** The hot wallet stays put. Funding happens via the payments portal running on that host (see next section), not by exporting the key to a wallet app on another machine.

Check balance any time:

```bash
torve buyer balance
```

## Running the buyer proxy

Foreground, for a laptop or a quick test:

```bash
torve buyer start
```

For an isolated Hermes buyer, use a dedicated data directory. This is where Torve writes `buyer.state.json`, SQLite databases, payment-channel state, and the fallback `identity.key`:

```bash
export BUYDIR="$HOME/.torve-buyer-hermes"
mkdir -p "$BUYDIR"
TORVE_DATA_DIR="$BUYDIR" torve --data-dir "$BUYDIR" buyer start
```

Advanced: if Hermes must use a non-default proxy port:

```bash
torve --data-dir "$BUYDIR" buyer start --port 5005
```

Persistent (Linux, systemd):

```bash
sudo tee /etc/systemd/system/torve-buyer.service > /dev/null <<EOF
[Unit]
Description=Torve Buyer Proxy
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
Environment=TORVE_IDENTITY_HEX=<64-hex-no-0x>
Environment=TORVE_DATA_DIR=%h/.torve-buyer-hermes
ExecStart=/usr/bin/env torve --data-dir %h/.torve-buyer-hermes buyer start
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now torve-buyer
```

The service user must own the `~/.torve/` directory that holds `config.json` and `identity.key`.

The buyer startup log prints the Deposits/Channels addresses and RPC URL it bound to — glance at those to confirm it's on the chain you expected.

## Funding the buyer

`torve buyer deposit` prints the buyer's funding address and a QR code (an EIP-681 payment request), then watches the hot wallet and deposits incoming USDC into the buyer's credits automatically: the node signs a gasless EIP-3009 authorization and a permissionless relayer submits the transaction on-chain for a fixed ~$0.05 USDC fee. The buyer never needs ETH. (The old `torve payments` web portal is retired.)

```bash
torve buyer deposit              # address + QR, then waits and auto-deposits incoming USDC
torve buyer deposit --no-watch   # just print the address + QR
```

Send USDC **on the Base network only** to the printed address — from any wallet, an exchange withdrawal, or a card on-ramp. While `torve buyer start` is running, incoming hot-wallet USDC is swept into the deposits balance automatically even without `torve buyer deposit` open (config `buyer.autoSweep`, default `true`). `torve buyer sweep` triggers one sweep manually.

After funding, confirm with `torve buyer balance` — the "Deposits Account → Available" line should reflect the deposit (net of the relay fee). A first-ever deposit must net at least 1 USDC after the fee.

### When Hermes runs on a remote host

No port forwarding is needed anymore: `torve buyer deposit` is plain terminal output, so run it inside the SSH session (the QR renders in the terminal) or just copy the printed address. The running buyer daemon on the remote host sweeps the funds automatically once they land.


## Choose the endpoint

For Hermes running on the same machine as the AI VPN or buyer proxy:

```bash
export TORVE_BASE_URL="http://127.0.0.1:8377/v1"
export TORVE_API_KEY="torve-p2p"
```

The local buyer proxy does not validate the key, but Hermes requires a non-empty value.

For Hermes running on another machine:

1. Open **Agents** in the AI VPN.
2. Under **Define your internet-accessible Torve endpoint**, configure and start ngrok or Cloudflare Tunnel.
3. Copy the displayed **OpenAI base URL** and generated **API key**.
4. Set them on the Hermes machine:

```bash
export TORVE_BASE_URL="https://your-endpoint.example/v1"
export TORVE_API_KEY="torve_your_generated_key"
```

The public endpoint requires `Authorization: Bearer <API_KEY>`. The tunnel accepts only the supported model API routes and forwards them to the local buyer proxy.

## Model routing

Pinning a peer is optional. A request that names only a model selects the highest-ranked eligible offer under the shared Price + Trust preferences, including pricing, cached-input pricing coverage, recent failures, cooldowns, and seller access rules. Peer-attributed retryable failures can advance to the next ranked offer. Explicitly pinned requests never fail over.

List every model on the network — `GET /v1/models` is answered locally and covers the whole network, independent of any pinned peer:

```bash
curl -s "$TORVE_BASE_URL/models" -H "Authorization: Bearer $TORVE_API_KEY" | jq '.data[].id'
curl -s "$TORVE_BASE_URL/models?type=text" -H "Authorization: Bearer $TORVE_API_KEY"
curl -s "$TORVE_BASE_URL/models?type=images" -H "Authorization: Bearer $TORVE_API_KEY"
curl -s "$TORVE_BASE_URL/models/<model-id>" -H "Authorization: Bearer $TORVE_API_KEY"
torve network browse                                      # table of peers and their services
```

Close aliases (e.g. `claude-opus-5` / `opus-5` / `opus5`) merge into one entry with an `aliases` array and a `peers` array of every seller serving the model in routing-preference order. Duplicate offers from one seller collapse to its cheapest matching service.

### Optional: force a specific seller

Three pin mechanisms override auto-selection (precedence: header > model prefix > session pin):

```bash
torve network peer <peerId>                       # full details for one peer
torve buyer connection set --peer <peerId>        # session pin
```

Alternatively, pass `x-torve-pin-peer: <peerId>` as a per-request header, or prefix the model with `<peerId>@<service-id>`.

Session pins are stored in `buyer.state.json`, survive buyer-proxy restarts, and are reloaded by the running proxy. A systemd `--peer <peerId>` flag is another hard-pin option for deployments that want the route declared directly in `ExecStart=`.

## Wiring Hermes to the buyer proxy

Register Torve as a named provider in `~/.hermes/config.yaml`. Current Hermes releases use the `providers:` mapping; the older `custom_providers:` list is legacy and auto-migrated by Hermes.

```yaml
model:
  provider: torve
  default: torve
  base_url: ""
  api_mode: chat_completions

providers:
  torve:
    name: Torve
    api: ${TORVE_BASE_URL}
    api_key: ${TORVE_API_KEY}
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

Notes:

- Hermes expands `${TORVE_BASE_URL}` and `${TORVE_API_KEY}` placeholders at runtime. Literal values also work.
- For a local connection, the API key can be any non-empty placeholder. For a public endpoint, it must be the generated `torve_...` key from the AI VPN.
- `transport: chat_completions` selects the OpenAI Chat Completions wire format supported by Hermes and the buyer proxy.
- `models` is a mapping in current Hermes releases. Keep `torve` to follow the current AI VPN selection and add concrete IDs returned by `GET $TORVE_BASE_URL/models` when needed.
- `model.provider: torve` selects the named provider. `model.default: torve` follows the current AI VPN model picker rather than pinning a seller.

### Auxiliary calls when using openai-responses models

Some sellers serve models only through the `openai-responses` protocol, which requires streaming. Hermes auxiliary functions (title generation, context compression, etc.) make non-streaming requests and will fail with `HTTP 400: Stream must be set to true` if they hit an openai-responses-only offer.

Fix: point Hermes auxiliaries at a `chat_completions` model from the same or a different peer. In `~/.hermes/config.yaml`, override the auxiliary providers that make non-streaming calls:

```yaml
auxiliary:
  title_generation:
    provider: torve
    model: minimax-m2.7   # chat_completions protocol — no streaming requirement
  compression:
    provider: torve
    model: minimax-m2.7
```

Check the available protocols with `GET /v1/models/<model-id>` and inspect each `peers[]` offer. Use `torve network peer <peerId>` only when you need the full metadata for one seller.

### Swapping the routed model

Edit `model.default` (and the provider's `models` mapping if needed) and restart the Hermes systemd unit — the buyer proxy stays up, no CLI change, no contract call. Model-only requests auto-select a peer that serves the new model. Only if you pinned a peer that doesn't serve it do you need to clear the pin (`torve buyer connection clear`) or re-pin to one that does:

```bash
sudo systemctl restart hermes
sudo journalctl -u hermes --no-pager -n 20
```

On a remote host, the same two commands prefixed with `ssh user@host`.

## Sanity check

```bash
torve buyer balance
curl -s "$TORVE_BASE_URL/models" \
  -H "Authorization: Bearer $TORVE_API_KEY" | head
```

Then send a prompt through Hermes and watch the buyer log — you should see a channel open on the first request, then per-request voucher signing.

## References

- Torve integration page: `https://torveai.com/integrations/hermes/`
- Torve public tunnel guide: `https://torveai.com/docs/guides/public-tunnels`
- Hermes Agent provider documentation: `https://hermes-agent.nousresearch.com/docs/integrations/providers`
- Hermes Agent source: `https://github.com/NousResearch/hermes-agent`
