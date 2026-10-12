# Torve Auth Bridge — Supabase ↔ P2P Identity

**Status:** scaffold (design spec for the next implementation agent)
**Fork:** `torve-seed` (AntSeed v0.2.57 → `@torveai/*`, bin `torve`)
**Supabase project:** `yvbrvrnjlonqoxzpikbf.supabase.co` (reused Torve project — single account)
**Website:** `api-website/backend/apps/web` (Next.js, primary) + Docusaurus → `docs.torveai.com`
**Date:** 2026-03-31

---

## 1. Goal

Let a user who already has a Torve account (Supabase Auth) obtain and use a Torve
P2P identity (secp256k1 keypair / peerId / wallet address) from the CLI and Desktop
without creating a second account, re-entering credentials, or managing a seed phrase
manually. The bridge links a Supabase `user.id` to a P2P key, and reuses the existing
web login (Google OAuth + email/password, PKCE) as the only authentication surface.

Non-goals: replacing the P2P identity system; putting P2P keys in Supabase; making the
CLI/Desktop talk to Supabase directly with a long-lived service key.

---

## 2. Prior art in this repo (what we reuse)

| Area | File | Reuse |
|------|------|-------|
| Web session / middleware | `api-website/backend/apps/web/proxy.ts` | Supabase SSR session refresh, CSP, `isPasswordSetupPath`, referral cookie — keep as-is |
| Web Supabase client | `apps/web/lib/supabase/server.ts` | `createSupabaseServerClient()` — bridge adds one new route beside it, does not fork it |
| Web auth guards | `apps/web/lib/auth.ts` | `requireCustomer`, `requireSuperadmin`, `getCustomerSession` — bridge callback reuses `getCustomerSession` to assert "signed in" |
| OAuth callback | `apps/web/app/auth/callback/route.ts` | PKCE `exchangeCodeForSession` + `hasPassword` detour + referral claim — the exact pattern the bridge's CLI/Desktop callback mirrors (new route: `app/auth/bridge/callback/route.ts`) |
| API JWT verification | `apps/api/src/management/auth/supabase-jwt.service.ts` | `jose createRemoteJWKSet` + `jwtVerify` with `issuer=${SUPABASE_URL}/auth/v1`, `aud=authenticated`, `ES256+RS256`, `clockTolerance:5`. **Canonical reference** — the CLI scaffold (`apps/cli/src/auth/supabase-jwt.ts`) mirrors it verbatim |
| API auth guard | `apps/api/src/management/auth/management-auth.guard.ts` | `Bearer` extraction, `upsert` profile, `isSuperadmin`/`isAdmin` promotion, `ensureAutomaticPackageAssignment` — gateway guard follows the same shape |
| P2P identity | `torve-seed/packages/node/src/p2p/identity.ts` | `FileIdentityStore`, `IdentityStore` interface, `ANTSEED_IDENTITY_HEX` env injection, `identityFromPrivateKeyHex` — bridge writes via this interface, does not replace it |
| CLI binary | `torve-seed/apps/cli/package.json` bin | Currently `antseed` → `torve` after rebrand (see `FORK-AUTH.md` scope note) |
| Desktop identity | `torve-seed/apps/desktop/src/main/identity.ts` | `safeStorage` encrypted `identity.enc`, migration from `identity.key`, `ANTSEED_IDENTITY_HEX` injection into CLI child — bridge feeds the same `secureIdentityEnv()` path |
| Desktop product | `torve-seed/apps/desktop/package.json` productName | `Antseed AI VPN` — rebrand touches `INTERNAL_APP_NAME` (`app.setName`) carefully; changing it rotates the macOS keychain key and makes existing `identity.enc` undecryptable (see `identity.ts: UNDECRYPTABLE` handling) |

Env vars already defined in `api-website`:

- Web: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `TORVEAI_SUPERADMIN_EMAIL`, `WEB_PUBLIC_ORIGIN`, `TORVEAI_MANAGEMENT_API_URL`, `REFERRAL_COOKIE_SECRET`
- API: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_AUDIENCE`, `SUPABASE_ADMIN_EMAIL`

---

## 3. Architecture

```
                ┌─────────────────────────────────┐
                │  Supabase Auth                  │
                │  yvbrvrnjlonqoxzpikbf.*          │
                │  /auth/v1/.well-known/jwks.json │
                └──────────────┬──────────────────┘
                               │ JWKS (jose)
              ┌────────────────┼────────────────┐
              │                │                │
   ┌──────────▼─────┐  ┌───────▼────────┐ ┌────▼──────────┐
   │  Website       │  │  torve login   │ │  Desktop      │
   │  (Next.js)     │◄─┤  (CLI)         │ │  (Electron)   │
   │  proxy.ts     ─┤  │  loopback or   │ │  safeStorage  │
   │  /auth/bridge/ │  │  device code   │ │  torve://     │
   │  callback      │  └───────┬────────┘ └────┬──────────┘
   └──────────┬─────┘          │               │
              │  JWT (Bearer)  │               │ torve://auth/callback
              └────────────────┼───────────────┘
                               ▼
                    ┌───────────────────┐
                    │  Gateway / API    │
                    │  verifySupabaseJwt│
                    │  (jose)           │
                    └─────────┬─────────┘
                              │ userId → torve_users
                    ┌─────────▼─────────┐
                    │  P2P Node         │
                    │  identity.key /   │
                    │  identity.enc     │
                    └───────────────────┘
```

Trust boundary: the website is the only party that sees the Supabase session cookie.
The CLI/Desktop never store a Supabase refresh token; they receive a short-lived
*bridge code* (opaque, 5 min, single-use) that the gateway exchanges for a verified
Supabase JWT, then maps to a P2P key.

---

## 4. Flows

### 4.1 CLI — `torve login`

Preferred: loopback redirect (no extra infrastructure). Fallback: device-code polling
for headless/SSH hosts where a browser cannot reach `127.0.0.1`.

**Loopback:**

1. `torve login` generates a PKCE `code_verifier` + `code_challenge` (S256) and a
   `state` (32 bytes random, base64url). It also generates a one-time `bridge_nonce`
   to bind the eventual callback to this CLI invocation.
2. CLI starts an ephemeral loopback HTTP server on `127.0.0.1:0` (random free port).
   It prints `Listening on http://127.0.0.1:<port>/callback` and opens the system
   browser to:
   ```
   ${TORVE_WEB_ORIGIN}/auth/bridge/start?state=<state>&code_challenge=<challenge>&nonce=<bridge_nonce>&port=<port>
   ```
   (`open` package — already in CLI deps.)
3. Web `app/auth/bridge/start/route.ts`:
   - Requires `getCustomerSession()` — if not signed in, redirects to `/login?next=/auth/bridge/start?...` (reuse `proxy.ts` + `requireCustomer`).
   - Validates `state`, `code_challenge`, `port` (port must be numeric, `127.0.0.1` only).
   - Creates a `torve_bridge_codes` row: `{ id, user_id, code_challenge, state, bridge_nonce, port, expires_at = now()+5m, used_at=null }`.
   - Redirects to Supabase OAuth authorize? No — user is already signed in, so it
     immediately mints a short-lived bridge code (32 bytes random, base64url) and
     redirects the browser to `http://127.0.0.1:<port>/callback?code=<bridge_code>&state=<state>`.
     (No Supabase round-trip needed; the mapping row itself is the proof.)
4. Loopback handler validates `state` matches, then calls the gateway:
   ```
   POST ${TORVE_GATEWAY_ORIGIN}/auth/bridge/exchange
   Body: { code: <bridge_code>, code_verifier: <verifier>, bridge_nonce: <nonce> }
   ```
   The gateway validates `code_challenge` (S256 of verifier), `bridge_nonce`, expiry,
   and `used_at is null`, marks `used_at=now()`, then returns
   `{ userId, email, supabaseJwt }` (the JWT is freshly minted via Supabase Admin API
   or reuses the website's session — pick one; see §6).
5. CLI verifies the returned `supabaseJwt` locally via `verifySupabaseJwt()` (defence
   in depth), then links/creates the P2P identity (see §5) and prints
   `Logged in as <email> — peer <peerId>`.

**Device-code fallback** (when `TORVE_WEB_ORIGIN` not reachable or `--device-code` flag):

1. CLI calls `POST /auth/bridge/device/start` → `{ device_code, user_code, verification_uri, expires_in }`.
2. CLI prints `Open https://torveai.com/device and enter code XXXX-XXXX`.
3. Web `app/device/route.ts` lets a signed-in user enter the `user_code`, validates it,
   and links it to `user_id`.
4. CLI polls `POST /auth/bridge/device/poll { device_code }` every 5s until
   `{ status: "approved", supabaseJwt }` or expiry (15 min). Same linking as loopback.

### 4.2 Desktop — `torve://` deep link

1. Desktop registers a custom protocol (`app.setAsDefaultProtocolClient("torve")`).
   On `open-url` (macOS) / `second-instance` (Win/Linux) it receives
   `torve://auth/callback?code=<bridge_code>&state=<state>`.
2. User clicks "Connect Torve account" in Desktop UI → opens browser to
   `${TORVE_WEB_ORIGIN}/auth/bridge/start?state=<state>&code_challenge=<challenge>&proto=torve` (same PKCE/state flow; `proto` tells web to redirect to `torve://` not loopback).
3. Web validates session, creates `torve_bridge_codes` row, redirects to
   `torve://auth/callback?code=<bridge_code>&state=<state>`.
4. Desktop's protocol handler validates `state`, exchanges via the same
   `POST /auth/bridge/exchange` gateway endpoint, verifies JWT, writes identity via
   `saveEncryptedIdentity` / `secureIdentityEnv`, and shows the linked account in settings.
5. Desktop spawns the CLI child with `secureIdentityEnv()` — no file round-trip.

### 4.3 Key properties

- PKCE binds the authorization request to the CLI/Desktop that started it (prevents
  code injection by another local process).
- `state` binds the browser redirect to the same CLI invocation (prevents CSRF).
- `bridge_nonce` binds the loopback listener to the same CLI process (prevents a
  different local process from claiming the code).
- Bridge code is opaque, 32 bytes, single-use, 5 min TTL — even if leaked, window is small.

---

## 5. Mapping table — `torve_users` (or `torve_bridge_codes` + `torve_identities`)

Keep two tables so the short-lived exchange codes and the durable link are separate
and the codes table can be truncated aggressively.

**`torve_bridge_codes`** (ephemeral, 5 min TTL):

```sql
create table torve_bridge_codes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  code          text not null unique,            -- 32 bytes base64url, hashed with sha256 before storage
  code_hash     text not null unique,            -- sha256(code) hex — store hash, compare hash
  code_challenge text not null,                  -- PKCE S256 challenge
  state         text not null,
  bridge_nonce  text,                             -- nullable for device-code flow
  redirect_uri  text not null,                    -- loopback URL or torve:// — validated against allowlist
  expires_at    timestamptz not null default now() + interval '5 minutes',
  used_at       timestampz,
  created_at    timestamptz not null default now()
);
create index on torve_bridge_codes (expires_at);
-- Cron/trigger: delete where expires_at < now() - interval '1 hour'
```

Store `code_hash`, not raw `code` — the raw code travels only in the redirect URL
and the exchange POST. Logging the row never leaks it.

**`torve_users`** (durable link, one row per Supabase user):

```sql
create table torve_users (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  peer_id       text not null unique,            -- P2P peerId (hex, derived from secp256k1 pubkey)
  wallet_address text not null unique,           -- 0x... EVM address (lowercase)
  is_superadmin boolean not null default false,   -- snapshot at link time; rechecked on verify
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
```

Alternative: keep `torve_users` in the CLI/Desktop's local SQLite (`packages/node`
storage migrations) if we want zero Supabase-side durable state and treat the
Supabase JWT as the only durable identity. Trade-off: local-only mapping means
reinstalling the desktop loses the link unless the user runs `torve login` again.
Recommendation: keep `torve_users` server-side (Postgres via the management API)
so the link survives reinstall and the gateway can resolve `userId → wallet` for
billing/allowlisting without local state. Local cache is still useful for offline.

Migration placement: `torve-seed` migrations live in `packages/node/src/storage/migrations/`
(buyer-identities, channels, metering). For server-side `torve_users`, migrations live
in `api-website/backend/apps/api` (Prisma/Drizzle — check that repo's migration tool).

---

## 6. Supabase JWT verification — `apps/cli/src/auth/supabase-jwt.ts` (scaffold)

The scaffold at `apps/cli/src/auth/supabase-jwt.ts` mirrors
`api-website/backend/apps/api/src/management/auth/supabase-jwt.service.ts` exactly:

- `jose` `createRemoteJWKSet(new URL("${SUPABASE_URL}/auth/v1/.well-known/jwks.json"), { timeoutDuration: 5000, cooldownDuration: 30_000 })`
- `jwtVerify(token, jwks, { issuer: "${SUPABASE_URL}/auth/v1", audience: "authenticated", algorithms: ["ES256","RS256"], clockTolerance: 5 })`
- `payload.sub` + `payload.email` required; `email.toLowerCase() === superadminEmail` → `isSuperadmin`

Resolution order for env (tolerant during migration):

```
SUPABASE_URL  ←  NEXT_PUBLIC_SUPABASE_URL  ←  TORVE_SUPABASE_URL
SUPABASE_ADMIN_EMAIL  ←  SUPERADMIN_EMAIL  ←  TORVEAI_SUPERADMIN_EMAIL
SUPABASE_JWT_AUDIENCE  (default "authenticated")
```

Wiring TODOs (left as comments in the scaffold):

- Add `jose@^5.10.0` to `apps/cli/package.json` (same range as `apps/api`).
- Remove the `@ts-ignore` on the `jose` import once installed.
- Use `verifySupabaseJwt` in `torve login`'s exchange handler and in any gateway
  route that accepts `Authorization: Bearer <supabase_jwt>`.
- Share `getSupabaseConfig()` with the gateway if both verify (avoid divergence).

---

## 7. Env vars (see `torve-seed/.env.example`)

| Var | Required | Example | Notes |
|-----|----------|---------|-------|
| `SUPABASE_URL` | gateway/CLI verify | `https://yvbrvrnjlonqoxzpikbf.supabase.co` | Also accepts `NEXT_PUBLIC_SUPABASE_URL` fallback for dev |
| `SUPABASE_ANON_KEY` | bridge start | `eyJ...` | Public anon key — safe to expose |
| `SUPABASE_JWT_AUDIENCE` | optional | `authenticated` | Default; override only for self-hosted Supabase |
| `SUPABASE_ADMIN_EMAIL` / `TORVEAI_SUPERADMIN_EMAIL` | for `isSuperadmin` | `admin@torveai.com` | Must match web+api |
| `TORVE_WEB_ORIGIN` / `WEB_PUBLIC_ORIGIN` | bridge redirects | `https://torveai.com` | Must be https in prod |
| `TORVE_GATEWAY_ORIGIN` | CLI exchange | `http://127.0.0.1:8787` | Loopback or `torve://` deep link |
| `WEB_SERVER_ACTION_ORIGINS` | optional | `torveai.com` | Extra origins for Server Actions |
| `TORVEAI_MANAGEMENT_API_URL` | server-to-server | `https://api.torveai.com` | Bearer = user's Supabase access token |
| `ANTSEED_IDENTITY_HEX` / `TORVE_IDENTITY_HEX` | optional | `64-hex...` | Node identity override; both names accepted during migration |

No `SUPABASE_SERVICE_ROLE_KEY` belongs in the CLI, Desktop, or `.env.example`.

---

## 8. Reuse of existing `api-website` code paths

- **Do not fork `proxy.ts` or `lib/supabase/server.ts`.** The new bridge routes
  (`app/auth/bridge/start/route.ts`, `app/auth/bridge/callback/route.ts`,
  `app/device/route.ts`) import `createSupabaseServerClient` and `requireCustomer`/`getCustomerSession`
  directly. Middleware already handles session refresh before these routes run.
- **Do not fork `supabase-jwt.service.ts`.** The CLI scaffold copies its logic
  (same issuer/audience/algs/tolerance) rather than importing the NestJS service.
  If the gateway reuses NestJS, it can import the service directly.
- **Referral cookie** — the bridge's `start` route should not disturb the
  `torveai_ref` flow in `proxy.ts` / `app/auth/callback/route.ts`.
- **Password setup** — respect `isPasswordSetupPath` / `hasPassword` / `SET_PASSWORD_PATH`
  in the bridge's auth check (same as `proxy.ts` does for `/dashboard`).

---

## 9. Security considerations

- **Bridge codes:** 32 bytes `crypto.getRandomValues`, base64url, sha256-hashed at rest,
  5 min expiry, single-use (`used_at` check with row-level lock / `update ... where used_at is null`).
- **PKCE:** S256 only; plain is rejected. `code_verifier` is 43–128 chars, base64url.
- **State:** 32 bytes random, base64url, compared with constant-time equality;
  mismatch → abort (no exchange).
- **Loopback validation:** `redirect_uri` must be `http://127.0.0.1:<port>/callback`
  where `port` is the one the CLI registered. Reject `localhost`, `0.0.0.0`, private
  subnets, or any non-loopback host. (Matches OAuth for native apps — RFC 8252 §7.3.)
- **Deep link validation:** `torve://auth/callback` is the only accepted non-loopback
  redirect. Validate the full URL, not just the scheme.
- **No service_role key in CLI/Desktop.** The gateway (server) mints or re-issues the
  JWT for the exchange; the CLI verifies it but never holds a key that can forge one.
- **Rate limiting:** Gateway should rate-limit `POST /auth/bridge/exchange` and
  `POST /auth/bridge/device/*` (e.g. 10/min per IP, 5/min per device_code).
- **Logging:** Never log raw `code`, `code_verifier`, or `supabaseJwt`. Log `code_hash` prefix.
- **Desktop `identity.enc`:** Changing `INTERNAL_APP_NAME` (via `app.setName`) rotates
  the macOS keychain key and makes existing `identity.enc` permanently undecryptable
  (see `apps/desktop/src/main/identity.ts: UNDECRYPTABLE`). The rebrand from
  `AntStation Desktop` must preserve the keychain entry or provide a migration.
- **CSP / `proxy.ts`:** The bridge start page is a server route, not a marketing shell,
  so it gets the strict nonce CSP, not the `siteShell` relaxed policy.

---

## 10. Phased rollout

### Phase 0 — Scaffold (this PR)
- [x] `FORK-AUTH.md` (this file)
- [x] `torve-seed/.env.example` Supabase section (commented, no secrets)
- [x] `torve-seed/apps/cli/src/auth/supabase-jwt.ts` scaffold (mirrors `supabase-jwt.service.ts`, `jose` not yet installed, `@ts-ignore` + TODOs)

No build break: scaffold is not imported anywhere; `jose` not required until Phase 1.

### Phase 1 — Gateway + migrations
- [ ] Add `jose@^5.10.0` to `apps/cli/package.json` and wire `verifySupabaseJwt`.
- [ ] Create `torve_bridge_codes` + `torve_users` tables (or local SQLite alternative).
- [ ] Implement `POST /auth/bridge/exchange` on the gateway (NestJS or CLI gateway).
- [ ] Add `app/auth/bridge/start/route.ts` and `app/auth/bridge/callback/route.ts` in `api-website`.

### Phase 2 — CLI `torve login`
- [ ] Implement `torve login` command: PKCE + loopback server + `open` + exchange + identity link.
- [ ] Device-code fallback for headless hosts.
- [ ] `torve logout` / `torve whoami` helpers.

### Phase 3 — Desktop deep link
- [ ] Register `torve://` protocol (`app.setAsDefaultProtocolClient`) and handle `open-url` / `second-instance`.
- [ ] Desktop UI: "Connect Torve account" button → browser → `torve://auth/callback`.
- [ ] Feed linked identity into `secureIdentityEnv()` for CLI child processes.

### Phase 4 — Hardening
- [ ] Rate limiting, audit logging, metrics.
- [ ] Rebrand `INTERNAL_APP_NAME` migration plan (preserve `identity.enc`).
- [ ] E2E tests: loopback + deep link + device code, token expiry, replay rejection.

---

## 11. Open questions for the next agent

1. **Where does `/auth/bridge/exchange` live?** Options: (a) `api-website/backend/apps/api` (NestJS, already has `SupabaseJwtService` + DB), (b) `torve-seed`'s own gateway (`apps/cli/src/gateway`). (a) is simpler; (b) avoids coupling the fork to the API repo's deploy. Decide before Phase 1.
2. **Does the website mint a new Supabase JWT for the CLI, or does the CLI reuse the website session's access token?** Minting (via Supabase Admin API) gives a fresh TTL; reusing is simpler but the token may already be near expiry when the CLI gets it.
3. **Durable mapping location:** Postgres `torve_users` (survives reinstall, enables server-side `userId→wallet` resolution) vs local SQLite only (simpler, no server state). Recommendation is Postgres + local cache.
4. **Rebrand env var migration:** `ANTSEED_*` → `TORVE_*` rename — keep both accepted for one release (scaffold already does), then warn on legacy names.
5. **Desktop protocol name:** `torve://` vs `torve-ai://` — check OS registration collision with other apps.
