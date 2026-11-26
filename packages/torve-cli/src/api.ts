import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import os from 'node:os';
import { legacyModelsCachePath, modelsCachePath, readJsonFile, writeJsonAtomic } from './state.js';
import type { DesktopMeResponse, ModelsCache, TorveKeyMeta, TorveModel, TorveUserMeta } from './types.js';

const PKCE_TIMEOUT_MS = 5 * 60_000;
const API_TIMEOUT_MS = 12_000;
const MODELS_TTL_MS = 5 * 60_000;
const LOOPBACK_HOST = '127.0.0.1';

export type FetchLike = typeof fetch;

export interface PkcePair {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
}

export interface DesktopAuthExchangeResult {
  apiKey: string;
  key: TorveKeyMeta;
  user: TorveUserMeta;
}

export function torveCloudUpstream(): string {
  return (process.env['TORVE_CLOUD_API_URL'] || 'https://api.torveai.com').replace(/\/+$/, '');
}

export function torveWebBaseUrl(): string {
  return (process.env['TORVE_WEB_URL'] || 'https://torveai.com').replace(/\/+$/, '');
}

export function torveDesktopApiBase(): string {
  const base = torveCloudUpstream().replace(/\/api\/desktop$/i, '');
  return `${base}/api/desktop`;
}

function toBase64UrlNoPad(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function generatePkcePair(): PkcePair {
  const state = toBase64UrlNoPad(randomBytes(32));
  const codeVerifier = toBase64UrlNoPad(randomBytes(48));
  const codeChallenge = toBase64UrlNoPad(createHash('sha256').update(codeVerifier, 'ascii').digest());
  return { state, codeVerifier, codeChallenge, codeChallengeMethod: 'S256' };
}

export function buildDesktopAuthUrl(params: {
  webBaseUrl?: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  deviceName?: string;
}): string {
  const base = (params.webBaseUrl || torveWebBaseUrl()).replace(/\/+$/, '');
  const url = new URL(`${base}/auth/desktop`);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('device_name', (params.deviceName || os.hostname() || 'Torve CLI').slice(0, 128));
  return url.toString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function strOrNull(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function numOrNull(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function numOrZero(...values: unknown[]): number {
  return numOrNull(...values) ?? 0;
}

function parseUserMeta(raw: unknown): TorveUserMeta {
  const rec = asRecord(raw);
  return {
    id: strOrNull(rec?.['id']),
    email: strOrNull(rec?.['email']),
    name: strOrNull(rec?.['name']),
    plan: strOrNull(rec?.['plan']),
    status: strOrNull(rec?.['status']),
  };
}

function parseKeyMeta(raw: unknown): TorveKeyMeta {
  const rec = asRecord(raw);
  return {
    id: strOrNull(rec?.['id']),
    name: strOrNull(rec?.['name']),
    prefix: strOrNull(rec?.['prefix']),
    createdAt: strOrNull(rec?.['createdAt'], rec?.['created_at']),
  };
}

export class TorveApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = 'TorveApiError';
    this.status = status;
    this.code = code;
  }
}

async function parseErrorResponse(response: Response, fallback: string): Promise<TorveApiError> {
  let rawText = '';
  let parsed: Record<string, unknown> | null = null;
  try {
    rawText = await response.text();
    parsed = asRecord(JSON.parse(rawText));
  } catch {
    /* non-JSON body */
  }
  const nestedError = asRecord(parsed?.['error']);
  const code = strOrNull(parsed?.['code'], nestedError?.['code']);
  const backendMessage = strOrNull(
    parsed?.['message'],
    nestedError?.['message'],
    typeof parsed?.['error'] === 'string' ? parsed['error'] : null,
    parsed?.['detail'],
    rawText.trim() || null,
  );
  if (response.status === 409) {
    const detail = backendMessage ? ` (${backendMessage})` : '';
    return new TorveApiError(
      `Key limit reached${detail}. Revoke an unused key on torveai.com Dashboard and retry.`,
      409,
      code ?? 'key_limit_reached',
    );
  }
  return new TorveApiError(backendMessage || `${fallback} (HTTP ${response.status}).`, response.status, code);
}

export async function exchangeDesktopAuthCode(
  params: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    deviceName?: string;
    apiBase?: string;
  },
  fetchImpl: FetchLike = fetch,
): Promise<DesktopAuthExchangeResult> {
  const apiBase = (params.apiBase || torveDesktopApiBase()).replace(/\/+$/, '');
  const response = await fetchImpl(`${apiBase}/auth/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      code: params.code,
      code_verifier: params.codeVerifier,
      redirect_uri: params.redirectUri,
      device_name: params.deviceName || os.hostname() || 'Torve CLI',
    }),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw await parseErrorResponse(response, 'Failed to exchange Torve login code');
  }
  const payload = asRecord(await response.json());
  const apiKey = strOrNull(payload?.['apiKey'], payload?.['api_key']);
  if (!apiKey) {
    throw new TorveApiError('Torve returned an auth exchange response without an API key.', response.status);
  }
  return {
    apiKey,
    key: parseKeyMeta(payload?.['key']),
    user: parseUserMeta(payload?.['user']),
  };
}

export async function revokeDesktopAuthKey(
  apiKey: string,
  opts: { apiBase?: string } = {},
  fetchImpl: FetchLike = fetch,
): Promise<{ revoked: boolean; skippedManual: boolean }> {
  const apiBase = (opts.apiBase || torveDesktopApiBase()).replace(/\/+$/, '');
  const response = await fetchImpl(`${apiBase}/auth/revoke`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (response.status === 403) return { revoked: false, skippedManual: true };
  if (!response.ok && response.status !== 401 && response.status !== 404) {
    throw await parseErrorResponse(response, 'Failed to revoke Torve key');
  }
  return { revoked: response.ok, skippedManual: false };
}

export function parseDesktopMePayload(raw: unknown): DesktopMeResponse {
  const rec = asRecord(raw) ?? {};
  const quotaRec = asRecord(rec['quota']) ?? asRecord(rec['allowance']) ?? asRecord(rec['limits']) ?? rec;
  const monthlyRec = asRecord(quotaRec['monthly']) ?? asRecord(rec['monthlyPackage']) ?? quotaRec;
  const user = parseUserMeta(rec['user'] ?? rec);
  const key = parseKeyMeta(rec['key']);
  const rateLimitRaw = strOrNull(
    quotaRec['rateLimitStatus'],
    quotaRec['rate_limit_status'],
    rec['rateLimitStatus'],
  ) ?? 'ok';

  return {
    user,
    key,
    quota: {
      usedTokensToday: numOrZero(quotaRec['usedTokensToday'], quotaRec['used_tokens_today'], quotaRec['tokensUsedToday']),
      usedRequestsToday: numOrZero(quotaRec['usedRequestsToday'], quotaRec['used_requests_today'], quotaRec['requestsToday']),
      dailyTokenLimit: numOrNull(quotaRec['dailyTokenLimit'], quotaRec['daily_token_limit'], quotaRec['tokenLimitToday']),
      dailyRequestLimit: numOrNull(quotaRec['dailyRequestLimit'], quotaRec['daily_request_limit'], quotaRec['requestLimitToday']),
      rateLimitStatus: rateLimitRaw.toLowerCase(),
      resetsAt: strOrNull(quotaRec['resetsAt'], quotaRec['resets_at'], rec['resetsAt']),
      monthlyUsedTokens: numOrNull(
        monthlyRec['monthlyUsedTokens'],
        monthlyRec['monthly_used_tokens'],
        monthlyRec['usedTokens'],
        monthlyRec['used'],
      ),
      monthlyAllowanceTokens: numOrNull(
        monthlyRec['monthlyAllowanceTokens'],
        monthlyRec['monthly_allowance_tokens'],
        monthlyRec['allowanceTokens'],
        monthlyRec['limitTokens'],
        monthlyRec['limit'],
      ),
      monthlyUsedRequests: numOrNull(monthlyRec['monthlyUsedRequests'], monthlyRec['monthly_used_requests']),
      monthlyAllowanceRequests: numOrNull(monthlyRec['monthlyAllowanceRequests'], monthlyRec['monthly_allowance_requests']),
    },
  };
}

export async function fetchDesktopMe(
  apiKey: string,
  opts: { apiBase?: string } = {},
  fetchImpl: FetchLike = fetch,
): Promise<DesktopMeResponse> {
  const apiBase = (opts.apiBase || torveDesktopApiBase()).replace(/\/+$/, '');
  const response = await fetchImpl(`${apiBase}/me`, {
    headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw await parseErrorResponse(response, 'Failed to verify Torve account');
  }
  return parseDesktopMePayload(await response.json());
}

export async function readModelsCache(): Promise<ModelsCache | null> {
  const [primary, legacy] = await Promise.all([
    readJsonFile<Partial<ModelsCache>>(modelsCachePath()),
    readJsonFile<Partial<ModelsCache>>(legacyModelsCachePath()),
  ]);
  const valid = (c: Partial<ModelsCache> | null): ModelsCache | null => {
    if (!c || typeof c.updatedAt !== 'number' || !Array.isArray(c.models)) return null;
    const models = c.models.filter((m): m is TorveModel => Boolean(m && typeof m === 'object' && typeof m.id === 'string'));
    return models.length > 0 ? { updatedAt: c.updatedAt, models } : null;
  };
  const p = valid(primary);
  const l = valid(legacy);
  if (p && l) return p.updatedAt >= l.updatedAt ? p : l;
  return p ?? l;
}

export async function saveModelsCache(models: TorveModel[]): Promise<ModelsCache> {
  const next: ModelsCache = { updatedAt: Date.now(), models };
  await Promise.all([
    writeJsonAtomic(modelsCachePath(), next),
    writeJsonAtomic(legacyModelsCachePath(), next).catch(() => {}),
  ]);
  return next;
}

export async function fetchTorveModelsUpstream(
  apiKey: string,
  opts: { upstream?: string; force?: boolean } = {},
  fetchImpl: FetchLike = fetch,
): Promise<TorveModel[]> {
  if (!opts.force) {
    const cached = await readModelsCache();
    if (cached && Date.now() - cached.updatedAt < MODELS_TTL_MS) {
      return cached.models;
    }
  }
  const upstream = (opts.upstream || torveCloudUpstream()).replace(/\/+$/, '');
  const response = await fetchImpl(`${upstream}/v1/models`, {
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: 'application/json',
      'x-torve-client-app': 'torve-cli',
    },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw await parseErrorResponse(response, 'Failed to fetch Torve models');
  }
  const payload = await response.json() as { data?: unknown; models?: unknown };
  const list = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.models)
      ? payload.models
      : null;
  if (!list) throw new TorveApiError('Torve returned an invalid model catalog.', response.status);
  const models = list.filter((m): m is TorveModel => Boolean(m && typeof m === 'object' && typeof (m as TorveModel).id === 'string'));
  await saveModelsCache(models);
  return models;
}

export async function fetchTorveDesktopModelsEndpoint(
  apiKey: string,
  opts: { apiBase?: string } = {},
  fetchImpl: FetchLike = fetch,
): Promise<TorveModel[] | null> {
  const apiBase = (opts.apiBase || torveDesktopApiBase()).replace(/\/+$/, '');
  try {
    const response = await fetchImpl(`${apiBase}/models`, {
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { data?: unknown; models?: unknown };
    const list = Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload.models)
        ? payload.models
        : null;
    if (!list) return null;
    return list.filter((m): m is TorveModel => Boolean(m && typeof m === 'object' && typeof (m as TorveModel).id === 'string'));
  } catch {
    return null;
  }
}

export async function fetchModelsFromLocalProxy(port: number, fetchImpl: FetchLike = fetch): Promise<TorveModel[] | null> {
  try {
    const response = await fetchImpl(`http://127.0.0.1:${port}/v1/models`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(2_500),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { data?: unknown; models?: unknown };
    const list = Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload.models)
        ? payload.models
        : null;
    if (!list) return null;
    return list.filter((m): m is TorveModel => Boolean(m && typeof m === 'object' && typeof (m as TorveModel).id === 'string'));
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderCallbackHtml(ok: boolean, message: string): string {
  const accent = ok ? '#14FF73' : '#FF5A5F';
  const title = ok ? 'Torve CLI Connected' : 'Connection Failed';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${title}</title>
<style>
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#0A0A0A; color:#F4F4F5; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
  .card { max-width:440px; padding:32px; background:#111111; border:1px solid #27272A; border-radius:16px; text-align:center; }
  .badge { display:inline-block; width:44px; height:44px; line-height:44px; border-radius:12px; background:${accent}; color:#0A0A0A; font-weight:800; font-size:20px; margin-bottom:16px; }
  h1 { margin:0 0 8px; font-size:18px; font-weight:600; }
  p { margin:0; font-size:14px; line-height:1.5; color:#A1A1AA; }
</style>
</head>
<body>
  <div class="card">
    <div class="badge">T</div>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>`;
}

function writeHtml(res: ServerResponse, status: number, ok: boolean, message: string): void {
  const html = renderCallbackHtml(ok, message);
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html, 'utf8').toString(),
    'cache-control': 'no-store',
  });
  res.end(html);
}

export interface LoopbackPkceHandle {
  redirectUri: string;
  cancel: (reason?: string) => void;
}

export async function startLoopbackPkceServer(params: {
  expectedState: string;
  onCode: (code: string, redirectUri: string) => Promise<void>;
  onError: (message: string) => void;
  timeoutMs?: number;
}): Promise<LoopbackPkceHandle> {
  const timeoutMs = params.timeoutMs ?? PKCE_TIMEOUT_MS;
  let settled = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let server: Server | null = null;
  let redirectUri = '';

  const cleanup = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    const active = server;
    server = null;
    if (active) {
      try { active.close(); } catch { /* already closed */ }
    }
  };

  const failOnce = (message: string) => {
    if (settled) return;
    settled = true;
    cleanup();
    params.onError(message);
  };

  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://${LOOPBACK_HOST}`);
    if (req.method !== 'GET' || url.pathname !== '/auth/callback') {
      writeHtml(res, 404, false, 'Invalid callback route.');
      return;
    }
    if (settled) {
      writeHtml(res, 409, false, 'This login session has already completed or expired.');
      return;
    }

    const oauthError = url.searchParams.get('error_description') || url.searchParams.get('error');
    if (oauthError) {
      const msg = `Authorization was declined: ${oauthError}`;
      writeHtml(res, 400, false, msg);
      failOnce(msg);
      return;
    }

    const returnedState = url.searchParams.get('state') || '';
    if (!returnedState || returnedState !== params.expectedState) {
      const msg = 'Security state mismatch. Please retry torve login.';
      writeHtml(res, 400, false, msg);
      failOnce(msg);
      return;
    }

    const code = url.searchParams.get('code') || '';
    if (!code.trim()) {
      const msg = 'Missing authorization code from callback.';
      writeHtml(res, 400, false, msg);
      failOnce(msg);
      return;
    }

    settled = true;
    void params.onCode(code.trim(), redirectUri).then(
      () => {
        writeHtml(res, 200, true, 'Torve CLI is connected. You can close this window and return to your terminal.');
        cleanup();
      },
      (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        writeHtml(res, 400, false, msg);
        cleanup();
        params.onError(msg);
      },
    );
  });

  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(0, LOOPBACK_HOST, () => {
      server!.off('error', reject);
      const addr = server!.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind loopback auth callback port.'));
        return;
      }
      redirectUri = `http://${LOOPBACK_HOST}:${addr.port}/auth/callback`;
      resolve();
    });
  });

  timeoutId = setTimeout(() => {
    failOnce('Browser sign-in timed out after 5 minutes. Please try again.');
  }, timeoutMs);
  timeoutId.unref?.();

  return {
    redirectUri,
    cancel: (reason = 'Browser sign-in was cancelled.') => failOnce(reason),
  };
}

export function openExternalUrl(url: string): boolean {
  try {
    if (process.platform === 'win32') {
      const child = spawn('cmd.exe', ['/c', 'start', '', url], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      return true;
    }
    const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
    const child = spawn(cmd, [url], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
