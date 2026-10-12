/**
 * Supabase JWT verification for the Torve CLI / gateway.
 *
 * Mirrors `api-website/backend/apps/api/src/management/auth/supabase-jwt.service.ts`
 * and `api-website/backend/apps/web/lib/auth.ts` patterns.
 *
 * Validates a Supabase-issued access token via remote JWKS (jose).
 * Issuer:   ${SUPABASE_URL}/auth/v1
 * Audience: ${SUPABASE_JWT_AUDIENCE} (default: "authenticated")
 * Algs:     ES256 + RS256
 * Clock skew: 5s
 *
 * Scaffold status: NOT wired into any command yet. Next agent should:
 *   1. Add `jose` to apps/cli/package.json (`pnpm --filter @torveai/cli add jose`)
 *      (api-website/api already depends on jose@^5.10.0 — pin the same range).
 *   2. Call verifySupabaseJwt() from the `torve login` exchange handler and from
 *      any gateway route that accepts a Supabase bearer.
 *   3. Remove the @ts-ignore on the jose import once the dep is installed.
 */

// TODO: install jose — `pnpm --filter @torveai/cli add jose@^5.10.0`
 // @ts-ignore — jose not yet in @torveai/cli deps; scaffold must not break `pnpm run typecheck`
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export interface VerifiedSupabaseUser {
  userId: string;
  email: string;
  isSuperadmin: boolean;
  claims: JWTPayload & {
    email?: string;
    role?: string;
    user_metadata?: { avatar_url?: string; full_name?: string; name?: string };
  };
}

// ---------------------------------------------------------------------------
// JWKS cache — one RemoteJWKSet per SUPABASE_URL, lazily created.
// jose's createRemoteJWKSet already caches + respects cooldownDuration.
// ---------------------------------------------------------------------------

let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let cachedIssuer: string | null = null;
let cachedAudience: string | null = null;
let cachedSuperadminEmail: string | null = null;

function getSupabaseConfig(): { issuer: string; jwksUrl: string; audience: string; superadminEmail: string } {
  // Mirrors supabase-jwt.service.ts: SUPABASE_URL + SUPABASE_ADMIN_EMAIL required.
  // For the CLI we also accept NEXT_PUBLIC_SUPABASE_URL as fallback so a dev
  // can reuse their `apps/web/.env.local` without duplicating vars.
  const rawUrl =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.TORVE_SUPABASE_URL ||
    "";
  const superadminEmail =
    process.env.SUPABASE_ADMIN_EMAIL ||
    process.env.SUPERADMIN_EMAIL ||
    process.env.TORVEAI_SUPERADMIN_EMAIL ||
    "";

  if (!rawUrl) {
    throw new Error(
      "SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) must be set to verify Supabase JWTs. " +
        "See torve-seed/.env.example — Supabase section.",
    );
  }

  const baseUrl = rawUrl.replace(/\/$/, "");
  const issuer = `${baseUrl}/auth/v1`;
  const jwksUrl = `${baseUrl}/auth/v1/.well-known/jwks.json`;
  // Audience defaults to "authenticated" — Supabase Auth sets aud=authenticated
  // on access tokens. Overridable via SUPABASE_JWT_AUDIENCE for self-hosted.
  const audience = process.env.SUPABASE_JWT_AUDIENCE || "authenticated";

  return { issuer, jwksUrl, audience, superadminEmail: superadminEmail.trim().toLowerCase() };
}

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  const { issuer, jwksUrl, audience, superadminEmail } = getSupabaseConfig();

  // Invalidate cache if SUPABASE_URL changes (e.g. tests or env reload).
  if (!cachedJwks || cachedIssuer !== issuer || cachedAudience !== audience) {
    cachedIssuer = issuer;
    cachedAudience = audience;
    cachedSuperadminEmail = superadminEmail;
    cachedJwks = createRemoteJWKSet(new URL(jwksUrl), {
      timeoutDuration: 5_000,
      cooldownDuration: 30_000,
    });
  }
  return cachedJwks;
}

/**
 * Verify a Supabase access token and return the caller's identity.
 *
 * @throws Error with message "Invalid or expired Supabase session" on bad/expired JWT
 * @throws Error with message "Session is missing required identity claims" if sub/email absent
 */
export async function verifySupabaseJwt(accessToken: string): Promise<VerifiedSupabaseUser> {
  if (!accessToken || typeof accessToken !== "string") {
    throw new Error("Invalid or expired Supabase session");
  }

  const { issuer, audience, superadminEmail } = getSupabaseConfig();
  const jwks = getJwks();

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(accessToken, jwks, {
      issuer,
      audience,
      algorithms: ["ES256", "RS256"],
      clockTolerance: 5,
    }));
  } catch {
    // Keep error message identical to api-website's SupabaseJwtService so
    // callers can match on it (ManagementAuthGuard maps to 401).
    throw new Error("Invalid or expired Supabase session");
  }

  const email = typeof payload.email === "string" ? (payload.email as string).toLowerCase() : "";
  if (!payload.sub || !email) {
    throw new Error("Session is missing required identity claims");
  }

  const claims = payload as VerifiedSupabaseUser["claims"];
  return {
    userId: payload.sub,
    email,
    isSuperadmin: Boolean(superadminEmail && email === superadminEmail),
    claims,
  };
}

// ---------------------------------------------------------------------------
// TODOs for the wiring agent
// ---------------------------------------------------------------------------
// - [ ] Add `jose` dep to apps/cli/package.json and run typecheck. Remove
//       the @ts-ignore above once installed.
// - [ ] Decide where the verified identity lives: in-memory for the `torve login`
//       exchange, persisted via the mapping table (torve_users), or both.
// - [ ] Share issuer/audience/superadmin resolution with the gateway if the
//       gateway will also verify (avoid duplicating getSupabaseConfig).
// - [ ] Add unit tests mirroring api-website's JWT tests (mock JWKS, test
//       ES256+RS256, exp/nbf skew, missing sub/email, wrong aud/iss).
// - [ ] Consider exporting a NestJS-style provider wrapper if the CLI gateway
//       reuses DI (otherwise plain function is fine).
// - [ ] Rate-limit callers that repeatedly send bad JWTs (gateway concern).
