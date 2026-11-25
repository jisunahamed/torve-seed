import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import os from 'node:os';
import { torveCloudUpstream } from './models.js';

export type DesktopAuthMode = 'oauth' | 'manual';
export type DesktopUsageRange = '24h' | '7d' | '30d';
export type DesktopUsageScope = 'account' | 'key';

export type DesktopKeyMeta = {
  id: string | null;
  name: string | null;
  prefix: string | null;
  createdAt: string | null;
};

export type DesktopUserMeta = {
  id: string | null;
  email: string | null;
  name: string | null;
  plan: string | null;
  status: string | null;
};

export type DesktopQuotaSummary = {
  usedTokensToday: number;
  usedRequestsToday: number;
  dailyTokenLimit: number | null;
  dailyRequestLimit: number | null;
  rateLimitStatus: 'ok' | 'limited' | string;
  resetsAt: string | null;
  monthlyUsedTokens: number | null;
  monthlyAllowanceTokens: number | null;
  monthlyUsedRequests: number | null;
  monthlyAllowanceRequests: number | null;
};

export type DesktopMeResponse = {
  user: DesktopUserMeta;
  key: DesktopKeyMeta;
  quota: DesktopQuotaSummary;
};

export type DesktopUsageTotals = {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type DesktopModelUsageRow = {
  modelId: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  avgLatencyMs: number | null;
  lastUsedAt: string | null;
};

export type DesktopAppUsageRow = {
  appId: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  lastUsedAt: string | null;
};

export type DesktopUsageResponse = {
  range: DesktopUsageRange;
  scope: DesktopUsageScope | 'local';
  totals: DesktopUsageTotals;
  byModel: DesktopModelUsageRow[];
  byApp: DesktopAppUsageRow[];
};

export type DesktopAuthExchangeResult = {
  apiKey: string;
  key: DesktopKeyMeta;
  user: DesktopUserMeta;
};

export type PkcePair = {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
};

export type FetchLike = typeof fetch;

const PKCE_TIMEOUT_MS = 5 * 60_000;
const API_TIMEOUT_MS = 12_000;
const LOOPBACK_HOST = '127.0.0.1';

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

/** Generate RFC 7636 PKCE verifier/challenge and CSRF state in main-process memory. */
export function generatePkcePair(): PkcePair {
  // 32 random bytes -> 43 base64url characters (within state 16-512 & verifier 43-128).
  const state = toBase64UrlNoPad(randomBytes(32));
  // 48 random bytes -> 64 RFC 7636 unreserved characters [A-Za-z0-9_-].
  const codeVerifier = toBase64UrlNoPad(randomBytes(48));
  const codeChallenge = toBase64UrlNoPad(createHash('sha256').update(codeVerifier, 'ascii').digest());
  return { state, codeVerifier, codeChallenge, codeChallengeMethod: 'S256' };
}

export function isValidPkceState(value: string): boolean {
  return /^[A-Za-z0-9_-]{16,512}$/.test(value);
}

export function isValidPkceVerifier(value: string): boolean {
  return /^[A-Za-z0-9\-._~]{43,128}$/.test(value);
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
  url.searchParams.set('device_name', (params.deviceName || os.hostname() || 'Windows Desktop').slice(0, 128));
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

function parseUserMeta(raw: unknown): DesktopUserMeta {
  const rec = asRecord(raw);
  return {
    id: strOrNull(rec?.['id']),
    email: strOrNull(rec?.['email']),
    name: strOrNull(rec?.['name']),
    plan: strOrNull(rec?.['plan']),
    status: strOrNull(rec?.['status']),
  };
}

function parseKeyMeta(raw: unknown): DesktopKeyMeta {
  const rec = asRecord(raw);
  return {
    id: strOrNull(rec?.['id']),
    name: strOrNull(rec?.['name']),
    prefix: strOrNull(rec?.['prefix']),
    createdAt: strOrNull(rec?.['createdAt'], rec?.['created_at']),
  };
}

export class DesktopApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = 'DesktopApiError';
    this.status = status;
    this.code = code;
  }
}

async function parseErrorResponse(response: Response, fallback: string): Promise<DesktopApiError> {
  let rawText = '';
  let parsed: Record<string, unknown> | null = null;
  try {
    rawText = await response.text();
    parsed = asRecord(JSON.parse(rawText));
  } catch {
    /* non-JSON error body */
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
    return new DesktopApiError(
      `Desktop key limit reached${detail}. Please revoke an unused key on the torveai.com Dashboard and retry.`,
      409,
      code ?? 'key_limit_reached',
    );
  }

  return new DesktopApiError(
    backendMessage || `${fallback} (HTTP ${response.status}).`,
    response.status,
    code,
  );
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
      device_name: params.deviceName || os.hostname() || 'Windows Desktop',
    }),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw await parseErrorResponse(response, 'Failed to exchange Torve Desktop login code');
  }
  const payload = asRecord(await response.json());
  const apiKey = strOrNull(payload?.['apiKey'], payload?.['api_key']);
  if (!apiKey) {
    throw new DesktopApiError('Torve returned an auth exchange response without an API key.', response.status);
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
  if (response.status === 403) {
    return { revoked: false, skippedManual: true };
  }
  if (!response.ok && response.status !== 401 && response.status !== 404) {
    throw await parseErrorResponse(response, 'Failed to revoke Torve Desktop key');
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

export function parseDesktopUsagePayload(
  raw: unknown,
  range: DesktopUsageRange,
  scope: DesktopUsageScope,
): DesktopUsageResponse {
  const rec = asRecord(raw) ?? {};
  const totalsRec = asRecord(rec['totals']) ?? rec;
  const rawModels = Array.isArray(rec['byModel']) ? rec['byModel'] : Array.isArray(rec['by_model']) ? rec['by_model'] : [];
  const rawApps = Array.isArray(rec['byApp']) ? rec['byApp'] : Array.isArray(rec['by_app']) ? rec['by_app'] : [];

  const byModel: DesktopModelUsageRow[] = [];
  for (const item of rawModels) {
    const row = asRecord(item);
    const modelId = strOrNull(row?.['modelId'], row?.['model_id'], row?.['model'], row?.['id']);
    if (!modelId) continue;
    const inputTokens = numOrZero(row?.['inputTokens'], row?.['input_tokens'], row?.['promptTokens']);
    const outputTokens = numOrZero(row?.['outputTokens'], row?.['output_tokens'], row?.['completionTokens']);
    const totalTokens = numOrNull(row?.['totalTokens'], row?.['total_tokens']) ?? (inputTokens + outputTokens);
    byModel.push({
      modelId,
      requests: numOrZero(row?.['requests'], row?.['requestCount'], row?.['count']),
      inputTokens,
      outputTokens,
      totalTokens,
      avgLatencyMs: numOrNull(row?.['avgLatencyMs'], row?.['avg_latency_ms'], row?.['latencyMs']),
      lastUsedAt: strOrNull(row?.['lastUsedAt'], row?.['last_used_at']),
    });
  }

  const byApp: DesktopAppUsageRow[] = [];
  for (const item of rawApps) {
    const row = asRecord(item);
    const appId = strOrNull(row?.['appId'], row?.['app_id'], row?.['app'], row?.['clientApp']);
    if (!appId) continue;
    const inputTokens = numOrZero(row?.['inputTokens'], row?.['input_tokens']);
    const outputTokens = numOrZero(row?.['outputTokens'], row?.['output_tokens']);
    const totalTokens = numOrNull(row?.['totalTokens'], row?.['total_tokens']) ?? (inputTokens + outputTokens);
    byApp.push({
      appId,
      requests: numOrZero(row?.['requests'], row?.['requestCount'], row?.['count']),
      inputTokens,
      outputTokens,
      totalTokens,
      lastUsedAt: strOrNull(row?.['lastUsedAt'], row?.['last_used_at']),
    });
  }

  const totalInput = numOrZero(totalsRec['inputTokens'], totalsRec['input_tokens']);
  const totalOutput = numOrZero(totalsRec['outputTokens'], totalsRec['output_tokens']);
  const totalTokens = numOrNull(totalsRec['totalTokens'], totalsRec['total_tokens']) ?? (totalInput + totalOutput);

  return {
    range: (strOrNull(rec['range']) as DesktopUsageRange | null) ?? range,
    scope: (strOrNull(rec['scope']) as DesktopUsageScope | null) ?? scope,
    totals: {
      requests: numOrZero(totalsRec['requests'], totalsRec['requestCount']),
      inputTokens: totalInput,
      outputTokens: totalOutput,
      totalTokens,
    },
    byModel,
    byApp,
  };
}

export async function fetchDesktopUsage(
  apiKey: string,
  params: { range?: DesktopUsageRange; scope?: DesktopUsageScope; apiBase?: string } = {},
  fetchImpl: FetchLike = fetch,
): Promise<DesktopUsageResponse> {
  const range: DesktopUsageRange = params.range ?? '7d';
  const scope: DesktopUsageScope = params.scope ?? 'account';
  const apiBase = (params.apiBase || torveDesktopApiBase()).replace(/\/+$/, '');
  const url = new URL(`${apiBase}/usage`);
  url.searchParams.set('range', range);
  url.searchParams.set('scope', scope);
  const response = await fetchImpl(url.toString(), {
    headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw await parseErrorResponse(response, 'Failed to load Torve usage statistics');
  }
  return parseDesktopUsagePayload(await response.json(), range, scope);
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
  const title = ok ? 'Torve Desktop Connected' : 'Connection Failed';
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

export type LoopbackPkceHandle = {
  redirectUri: string;
  cancel: (reason?: string) => void;
};

/** Start a single-use loopback HTTP server on 127.0.0.1:<ephemeral>/auth/callback.
 *  Always closes cleanly on completion, error, cancellation, or 5m timeout. */
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
      const msg = 'Security state mismatch. Please retry Sign in from Torve Desktop.';
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
        writeHtml(res, 200, true, 'Torve Desktop is connected. You can close this window.');
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
