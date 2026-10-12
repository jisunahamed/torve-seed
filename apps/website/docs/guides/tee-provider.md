---
sidebar_position: 2
slug: /guides/tee-provider
title: Run a TEE-Attested Seller
hide_title: true
---

# Run a TEE-Attested Seller

A seller running on Intel TDX hardware can prove it — cryptographically, to every buyer, before any payment. This guide takes an existing seller (see [Become a Provider](/docs/guides/become-a-provider)) and adds TEE attestation via the [`torve-verifier`](https://github.com/Torve/torve/tree/main/packages/torve-verifier) SDK, so buyers running `--require-verifier` will route to you.

:::info Availability
Verifier SDK support landed in the CLI with [PR #713](https://github.com/Torve/torve/pull/713) (July 2026). Check that your `torve seller start --help` lists a `--verifiers` option; older releases don't have it.
:::

## How it works

- Your seller loads the SDK's **prover** at startup and advertises the capability `verifier.torve-verifier` in its discovery metadata.
- A buyer challenges you on the reserved route `/_torve/attest/torve-verifier` with a fresh nonce. The prover mints an Intel TDX quote **bound to that nonce and your peer id**, signs the evidence bundle with your identity key, and returns it.
- The buyer verifies the quote against Intel's DCAP certificate chain locally. Attestation runs before provider matching, payment, and metering — it is free and unmetered, and rate-limited to 10 attestations per buyer per minute.

If the prover fails to load at startup, the seller exits rather than advertising a capability it can't answer.

## Prerequisites

- A genuine **Intel TDX** VM — e.g. a GCP `c3` confidential VM (Ubuntu 24.04) with TDX enabled. The prover mints quotes through `configfs-tsm` (`/sys/kernel/config/tsm/report`), which only exists on real TDX hardware and requires **root**.
- A working seller (`torve seller start` serving requests) on that VM.
- Node.js 20+.

## 1. Install the verifier SDK

The CLI resolves the id `torve-verifier` to the npm package `@torveai/torve-verifier`, version-pinned, and auto-installs it into `~/.torve/plugins` on first use (`npm install --ignore-scripts` under the hood).

To test an unpublished source checkout, install it into the plugins directory from the monorepo package:

```bash
git clone https://github.com/Torve/torve.git
cd torve
pnpm install
pnpm --filter @torveai/torve-verifier build
cd packages/torve-verifier
npm pack
npm install --prefix ~/.torve/plugins ./torve-torve-verifier-*.tgz
```

The loader expects the package at `~/.torve/plugins/node_modules/@torveai/torve-verifier`.

## 2. Configure the prover

The prover reads its configuration from the environment only — never from buyer-supplied values:

```bash
# Required: your peer id (EVM address, without 0x)
export TORVE_TEE_PEER_ID=<your-peer-id>

# Recommended: your seller identity key (hex). Enables the seller-bound
# capability — the evidence bundle is signed so buyers can recover your peerId.
# Disabled automatically if the key's address doesn't match TORVE_TEE_PEER_ID.
export TORVE_VERIFIER_SIGNING_KEY=<hex-private-key>

# Node quote source. Defaults to configfs; leave unset on a standard TDX VM.
# export TORVE_VERIFIER_NODE_TEE=configfs
```

## 3. Start the seller with the verifier

```bash
sudo -E torve seller start --verifiers torve-verifier
```

(`sudo` because `configfs` quote minting needs root; `-E` preserves the environment.)

Three equivalent ways to enable it, in precedence order:

1. `--verifiers torve-verifier` on the command line
2. `TORVE_VERIFIER_SDKS=torve-verifier` in the environment
3. `"verifiers": ["torve-verifier"]` under `seller` in `~/.torve/config.json` (the `torve seller setup` wizard can write this)

The first id in the list becomes your advertised default. On success you'll see:

```
Verifier prover embedded: torve-verifier
Verifiers advertised: torve-verifier
```

## 4. Confirm you're advertising

From any other machine:

```bash
torve network peer <your-peer-id>
# → Verifiers:       torve-verifier (default)
```

`torve network browse` also shows a `Verifier` column once any peer advertises one.

## 5. Attest your inference provider too (optional)

The two gating capabilities (`seller-node-tee-genuine`, `seller-bound`) cover your **node**. If your downstream inference provider also runs confidential hardware, the prover can relay its evidence so buyers see it — `seller-provider-tee-genuine`, `seller-provider-gpu-cc` (NVIDIA Confidential Computing), and `seller-provider-measured-image` are reported for buyer policy:

```bash
# An endpoint that returns the provider's evidence for a nonce ({nonce} → hex)
export TORVE_VERIFIER_PROVIDER_EVIDENCE_URL='http://127.0.0.1:9000/evidence?nonce={nonce}'
export TORVE_VERIFIER_PROVIDER_TEE_FIELD=quote

# The frozen report_data binding scheme the provider's quote uses:
#   torve-rd-v1            — Torve's canonical scheme
#   nonce-pubkey-sha256-v1   — used by e.g. Chutes
export TORVE_VERIFIER_PROVIDER_BINDING_SCHEME=torve-rd-v1
export TORVE_VERIFIER_PROVIDER_BINDING_PUBKEY_FIELD=e2e_pubkey

# Optional: per-GPU NVIDIA CC evidence field → enables seller-provider-gpu-cc
# export TORVE_VERIFIER_PROVIDER_GPU_FIELD=gpu_evidence
```

The SDK is provider-agnostic — no vendor hosts or schemas are baked in. Pointing at a different confidential-inference backend is configuration only. For a worked example against a live third-party TDX provider (Chutes), including the small auth shim it needs, see the [SDK's e2e guide](https://github.com/Torve/torve/blob/main/packages/torve-verifier/docs/e2e-report-data-schemes.md).

## 6. Test the full loop as a buyer

From a second machine (no special hardware needed):

```bash
torve buyer start --verifiers torve-verifier --require-verifier --peer <your-peer-id>
```

Send any request through the proxy. The buyer log should show:

```
Verified <your-peer-id>... via torve-verifier
```

If attestation fails under `--require-verifier`, the request is refused with a 502 naming the failed claims — which is exactly the guarantee your buyers are paying for.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Seller exits at startup with a verifier load error | SDK not installed in `~/.torve/plugins`, or its version doesn't match the CLI's pinned version |
| `seller-node-tee-genuine` fails locally | Not a genuine TDX VM, not running as root, or `configfs-tsm` unavailable |
| `seller-bound` missing from verdicts | `TORVE_VERIFIER_SIGNING_KEY` unset, or its address doesn't match `TORVE_TEE_PEER_ID` |
| Buyer reports TCB failures | Host platform needs microcode/TCB updates; buyers running `TORVE_VERIFIER_STRICT_TCB=true` accept only `UpToDate` |

## See also

- [Verify a seller's TEE](/docs/guides/verify-tee) — the buyer side of this handshake
- [AIP-3: Pluggable Verifier SDKs](https://github.com/Torve/AIPs/blob/main/AIPS/aip-3.md) — the protocol specification
- [Don't Trust the TEE Label](/blog/dont-trust-the-tee-label) — why this exists
