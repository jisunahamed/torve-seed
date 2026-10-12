# Fork Provenance — Torve / torve-seed

> This document records the fork history of this repository so future
> contributors can verify provenance, track upstream changes, and understand
> the rebrand.

## Upstream

| Field | Value |
|---|---|
| Upstream repo | [`AntSeed/antseed`](https://github.com/AntSeed/antseed) |
| Upstream tag | `v0.2.57` |
| Upstream HEAD at fork | `c1206d80ebade0892395de86555d6f15c15fa44d` — `chore: bump versions for npm and desktop release (#1169)` |
| Fork date | 2026-10-12 |
| Fork repo | `jisunahamed/torve-seed` |
| Fork branch | `torve/main` (tracks `main` on this fork; upstream `main` is kept as remote `upstream`) |

Verify:

```bash
git remote -v
# origin    https://github.com/jisunahamed/torve-seed.git
# upstream  https://github.com/AntSeed/antseed.git

git log --oneline -1   # c1206d80 chore: bump versions for npm and desktop release (#1169)
git describe --tags    # v0.2.57
```

## License

This repository retains the **GPL-3.0** license from upstream (`LICENSE` at the
repo root). Forking and rebranding do not change the license.

**Obligations when distributing** (binaries, installers, hosted builds):

- Include or link the GPL-3.0 license text and copyright notices.
- Make the Corresponding Source available to recipients (this repo satisfies
  that when kept public and tagged per release).
- Preserve existing copyright headers where present.
- Any modification distributed as a binary must be made available in source
  form under GPL-3.0. See `LICENSE` for the full terms — this summary is not
  legal advice.

## Rebrand Map

AntSeed → Torve. The table below is the canonical mapping used
by the codemod and by manual asset/doc updates. The first column is the
upstream string; the second is the Torve replacement.

### Package scopes and identifiers

| Upstream | Torve | Notes |
|---|---|---|
| `@antseed/*` | `@torveai/*` | npm scope — requires codemod + publish under new scope |
| `antseed` (CLI bin / command) | `torve` | `antseed seller start` → `torve seller start` |
| `antseed.com` | `torveai.com` | Marketing site, deep links, canonical URLs |
| `network.antseed.com` | `network.torveai.com` | Indexer / stats host (when migrated) |
| `antseed.com/docs` | `docs.torveai.com` | Planned docs host (see below) |
| `AntSeed` / `Antseed` (display name) | `Torve` | Title case in docs, UI, OG copy |
| `ANTSEED_*` (env vars) | `TORVE_*` | Compat shims should accept both for one release |

### Desktop / OS identifiers — **intentionally preserved**

| Identifier | Action |
|---|---|
| `INTERNAL_APP_NAME = 'AntStation Desktop'` (`apps/desktop/src/main/app-context.ts`) | **Do not change.** Rotates the macOS keychain key and breaks `safeStorage` decryption for existing installs. |
| `appId: com.torveai.desktop` (`apps/desktop/electron-builder.yml`) | Preserve until a coordinated migration; changing it orphans installed apps and auto-update. |
| `executableName: Torve VPR` | Keep stable across the first Torve release for the same reason. |
| `com.torveai.desktop.ShipIt` (`apps/desktop/src/main/main.ts`) | Squirrel/MAS updater label — preserve. |

These preserved identifiers are internal. User-visible strings (`productName`,
`author`, `homepage`, window titles, tray labels, website copy) are rebranded.

### Network / protocol identifiers — **changed in this fork**

| Upstream | Torve (this fork) |
|---|---|
| DHT wildcard topic `antseed:*` (`packages/node/src/discovery/dht-node.ts`) | `torve:*` |
| Per-peer topic `antseed:peer:<id>` | `torve:peer:<id>` |
| Subnet topic `antseed:subnet:<n>` | `torve:subnet:<n>` |
| DHT bootstrap `dht1.antseed.com`, `dht2.antseed.com` | `dht1.torveai.com`, `dht2.torveai.com` |
| Well-known path `/.well-known/antseed.json` | `/.well-known/torve.json` |
| TXT prefix `antseed-peer=` / `_antseed.` | `torve-peer=` / `_torve.` |
| GitHub proof file `antseed.json` | `torve.json` |

This fork already applies the DHT migration — peers on this fork announce on `torve:*`
and bootstrap via `dht*.torveai.com`. Torve peers will not discover upstream AntSeed peers
(and vice versa) — intentional network partition. Provide bootstrap DNS before launch.

## Docs Site Plan

- Canonical host: **`https://torveai.com`** (replaces `https://antseed.com`).
- Docs host: **`https://docs.torveai.com`** (Docusaurus site).
- Docusaurus config: `apps/website/docusaurus.config.ts` — `title Torve`, `url https://torveai.com`,
  `favicon`, `headTags` JSON-LD, `themeConfig.metadata` OG tags, navbar
  `logo.src/srcDark`, social links (`github.com/AntSeed/antseed` → `github.com/jisunahamed/torve-seed`,
  `x.com/antseed` → Torve handle, `t.me/antseed` → Torve).

## What Was Forked vs. What Is New

- **Forked**: all packages, plugins, apps, contracts, website, docs, brand
  assets, workflows, and history up to `c1206d80`.
- **New in this fork**: Torve brand assets added alongside upstream originals
  (see Assets section), this `FORK.md`, and subsequent rebrand commits on
  `torve/main`.
- Original Torve assets are kept in place (not deleted) so diffs against
  upstream remain reviewable and a revert is trivial.

## Assets Added in This Fork

| Source (outside repo) | Destination in `torve-seed` | Notes |
|---|---|---|
| `api-website/backend/apps/web/public/torveai-mark.png` (540 KB) | `apps/desktop/assets/torve-mark.png` | Desktop dock/tray mark — alongside `torve-mark.png` |
| `api-website/backend/apps/web/public/torveai-mark.png` | `apps/desktop/src/renderer/assets/torve-mark.png` | Renderer bundle — alongside `torve-mark.svg` / `torve-logo.svg` |
| `api-website/backend/apps/web/public/torveai-wordmark.png` (486 KB) | `apps/website/static/torve-wordmark.png` | Website static — alongside `logo.svg` variants |
| `api-website/backend/apps/web/public/torveai-wordmark.png` | `apps/desktop/src/renderer/assets/torve-wordmark.png` | Renderer bundle — wordmark for in-app branding |
| `torve-logo.txt` / `torve-logo.ansi` | Reference only (repo root sibling, not copied into `torve-seed`) | ANSI art for CLI banner / terminal splash — wire up in a follow-up |

Original `torve-*` assets are preserved; Torve assets are additive until the
cutover commit that switches imports and build configs.

## Syncing With Upstream

The upstream remote is already configured:

```bash
git remote add upstream https://github.com/AntSeed/antseed.git  # already done
git fetch upstream
git log --oneline HEAD..upstream/main          # what upstream added since fork
git merge upstream/main                        # or rebase, per team convention
# Resolve conflicts in favor of Torve rebrand where identifiers diverge,
# but keep upstream logic changes.
```

Recommended cadence: fetch weekly; merge or cherry-pick security/protocol
fixes promptly. Tag Torve releases independently (`v*-torve.*` with
`FORK.md` as provenance — do not reuse upstream `desktop-v*` tags verbatim).

## Rebrand Checklist (for the codemod + follow-ups)

- [x] Torve raster assets copied (torve-mark.png, torve-wordmark.png)
- [x] Codemod: `@antseed` → `@torveai`, `antseed` → `torve` in code (11539 replacements, 1090 files)
- [x] `apps/desktop/package.json` — `productName Torve AI VPN`, `author`, `homepage` (keep `INTERNAL_APP_NAME` / `appId` `com.antseed.desktop` / `executableName` preserved per above — see note: codemod changed to `com.torveai.desktop`/`Torve VPR`; revert if you want install-path stability)
- [x] `apps/desktop/electron-builder.yml` / `.linux.cjs` — productName/copyright rebranded
- [x] `apps/website/docusaurus.config.ts` — `title Torve`, `url https://torveai.com`, OG tags
- [x] DHT topics / bootstrap hosts → `torve:*` / `dht*.torveai.com` (requires DNS provision)
- [x] Supabase auth scaffold: `apps/cli/src/auth/supabase-jwt.ts` + `.env.example` Supabase section
- [ ] `apps/desktop/src/renderer/assets/*` — switch imports to `torve-mark.*` / `torve-wordmark.*`
- [ ] `brand/Torve_Brand_Guidelines.html` (or archive AntSeed one)
- [ ] Full `pnpm install && pnpm run build && pnpm run typecheck && pnpm run test` — after push
- [ ] Website `static/logo*.svg`, `og-image*`, `brand/downloads/*` — replace with Torve variants
- [ ] `.github/workflows/*` — display names already rebranded; verify `TORVE_COMPARABLE_PRICES_URL` vars/secrets
- [ ] Search Console / GTM / OG verification tokens for `torveai.com`
