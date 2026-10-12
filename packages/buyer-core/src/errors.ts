export type FaultAttribution = 'buyer' | 'peer' | 'unknown';

export type TorveErrorCode =
  | 'node-not-started'
  | 'node-stopped'
  | 'invalid-request'
  | 'buyer-stream-limit'
  | 'buyer-budget-too-low'
  | 'buyer-reserve-misconfigured'
  | 'buyer-session-state'
  | 'buyer-deposits-insufficient'
  | 'buyer-reserve-topup-timeout'
  | 'buyer-transport-closed'
  | 'invalid-spending-auth-header'
  | 'chain-rpc-unavailable'
  | 'peer-not-authorized'
  | 'peer-protocol-violation';

export interface TorveRequestErrorOptions {
  cause?: unknown;
}

export class TorveRequestError extends Error {
  readonly attribution: FaultAttribution;
  readonly code: TorveErrorCode;

  constructor(
    message: string,
    code: TorveErrorCode,
    attribution: FaultAttribution,
    options?: TorveRequestErrorOptions,
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'TorveRequestError';
    this.code = code;
    this.attribution = attribution;
  }
}

export function buyerFault(
  message: string,
  code: TorveErrorCode,
  options?: TorveRequestErrorOptions,
): TorveRequestError {
  return new TorveRequestError(message, code, 'buyer', options);
}

export function peerFault(
  message: string,
  code: TorveErrorCode,
  options?: TorveRequestErrorOptions,
): TorveRequestError {
  return new TorveRequestError(message, code, 'peer', options);
}

export function faultAttributionOf(err: unknown, depth = 0): FaultAttribution {
  if (depth > 5) return 'unknown';
  const attribution = (err as { attribution?: unknown } | null)?.attribution;
  if (attribution === 'buyer' || attribution === 'peer' || attribution === 'unknown') {
    return attribution;
  }
  if (err instanceof Error && err.cause !== undefined && err.cause !== err) {
    return faultAttributionOf(err.cause, depth + 1);
  }
  return 'unknown';
}

export function faultCodeOf(err: unknown, depth = 0): TorveErrorCode | null {
  if (depth > 5) return null;
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && TORVE_ERROR_CODES.has(code as TorveErrorCode)) {
    return code as TorveErrorCode;
  }
  if (err instanceof Error && err.cause !== undefined && err.cause !== err) {
    return faultCodeOf(err.cause, depth + 1);
  }
  return null;
}

const TORVE_ERROR_CODES: ReadonlySet<TorveErrorCode> = new Set<TorveErrorCode>([
  'node-not-started', 'node-stopped', 'invalid-request', 'buyer-stream-limit',
  'buyer-budget-too-low', 'buyer-reserve-misconfigured', 'buyer-session-state',
  'buyer-deposits-insufficient', 'buyer-reserve-topup-timeout', 'buyer-transport-closed', 'invalid-spending-auth-header',
  'chain-rpc-unavailable', 'peer-not-authorized', 'peer-protocol-violation',
]);
