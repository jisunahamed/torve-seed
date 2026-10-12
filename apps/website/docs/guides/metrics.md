---
sidebar_position: 5
slug: /guides/metrics
title: Metrics
hide_title: true
---

# Metrics

Torve includes a native Prometheus-compatible metrics exporter for buyers and sellers:

```bash
torve metrics serve
```

The exporter reads local Torve runtime state, payment channel ledgers, and metering stores, then exposes them using Prometheus text exposition format.

## Start the exporter

```bash
# Auto-detect role where possible
torve --config ~/.torve/config.json --data-dir ~/.torve metrics serve

# Seller metrics
torve --config ~/.torve/config.json --data-dir ~/.torve \
  metrics serve --role seller --host 0.0.0.0 --port 9108 --instance seller

# Buyer metrics
torve --config ~/.torve/config.json --data-dir ~/.torve \
  metrics serve --role buyer --host 127.0.0.1 --port 9108 --instance buyer
```

Default endpoints:

```text
/metrics
/healthz
/readyz
```

`/metrics` is for Prometheus-compatible scraping. `/healthz` and `/readyz` are for liveness/readiness checks.

## Options

| Option | Default | Description |
|---|---:|---|
| `--role <role>` | `auto` | Metrics role: `buyer`, `seller`, `both`, or `auto`. |
| `--host <host>` | `127.0.0.1` | Listen host. Use `0.0.0.0` when another system needs to scrape over the network. |
| `--port <port>` | `9108` | Listen port. |
| `--path <path>` | `/metrics` | Metrics path. |
| `--instance <name>` | hostname / `torve` | Value for the `instance` label. |
| `--include-chain` | disabled | Include chain balance metrics. This can add RPC latency. |

Equivalent environment variables:

```bash
TORVE_METRICS_ROLE=seller
TORVE_METRICS_HOST=0.0.0.0
TORVE_METRICS_PORT=9108
TORVE_METRICS_PATH=/metrics
TORVE_METRICS_INSTANCE=seller
```

## Common metrics

| Metric | Description |
|---|---|
| `torve_metrics_scrape_timestamp_seconds` | Unix timestamp of the metrics scrape. |
| `torve_daemon_up` | Whether local daemon state exists and is readable. |
| `torve_daemon_info` | Static daemon info such as state, peer id, and ports. |
| `torve_daemon_active_channels` | Active channel count from daemon state. |

## Buyer metrics

Buyer metrics include:

- payment channel counts by status
- all-time spend
- spend since UTC day start
- active authorized USDC
- request totals
- token totals
- per-seller-peer spend, requests, tokens, and channels

Common metric names:

```text
torve_buyer_channels_total
torve_buyer_spend_usdc_total
torve_buyer_spend_today_usdc
torve_buyer_active_authorized_usdc
torve_buyer_requests_total
torve_buyer_tokens_total
torve_buyer_peer_spend_usdc_total
torve_buyer_peer_requests_total
torve_buyer_peer_tokens_total
torve_buyer_peer_channels_total
```

Optional chain metrics are emitted only with `--include-chain`:

```text
torve_buyer_deposits_available_usdc
torve_buyer_deposits_reserved_usdc
torve_wallet_usdc
torve_chain_scrape_error
```

## Seller metrics

Seller metrics include:

- payment channel counts by status
- delivered, settled, and authorized USDC totals
- delivered USDC since UTC day start
- request totals
- token totals
- metering session totals
- metering token/request totals
- usage receipt revenue totals

Common metric names:

```text
torve_seller_channels_total
torve_seller_payment_delivered_usdc_total
torve_seller_payment_delivered_today_usdc
torve_seller_payment_settled_usdc_total
torve_seller_payment_authorized_usdc_total
torve_seller_channel_requests_total
torve_seller_channel_tokens_total
torve_seller_metering_requests_total
torve_seller_metering_requests_today
torve_seller_metering_tokens_total
torve_seller_metering_tokens_today
torve_seller_metering_input_tokens_total
torve_seller_metering_output_tokens_total
torve_seller_sessions_total
torve_seller_sessions_today
torve_seller_receipt_revenue_usd_total
torve_seller_receipt_revenue_today_usd
```

Seller payment metrics (`torve_seller_payment_*`) come from payment channels and represent USDC-denominated payment flow. Seller receipt metrics (`torve_seller_receipt_revenue_*`) come from metering/usage receipts and represent metered usage accounting.

## Read-only behavior

The exporter is designed to be safe to scrape:

- It does not create a new identity during scrape.
- It reads `TORVE_IDENTITY_HEX` if present, otherwise an existing `identity.key` from `--data-dir`.
- It does not create payment channel DBs during scrape.
- Missing DBs are treated as empty or absent metrics rather than initialized state.

## Operational notes

Run the exporter where it can read the same Torve data directory as the buyer or seller process. Expose `/metrics` to your monitoring system according to your infrastructure's normal access-control model.

If `--include-chain` is enabled, the exporter may perform RPC reads. For larger fleets, it is often better to collect chain balances separately or use a dedicated RPC endpoint.
