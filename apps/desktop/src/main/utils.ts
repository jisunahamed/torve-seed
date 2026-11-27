export type RuntimeMode = 'connect' | 'system-proxy' | 'tunnel';

export interface RuntimeProcessState {
  mode: RuntimeMode;
  running: boolean;
  pid: number | null;
  startedAt: number | null;
  lastExitCode: number | null;
  lastError: string | null;
}

export interface StartOptions {
  mode: RuntimeMode;
  router?: string;
  dashboardPort?: number;
  configPath?: string;
  verbose?: boolean;
  env?: Record<string, string>;
  systemProxyPeerId?: string;
  systemProxyPort?: number;
  systemProxyProfiles?: string[];
  systemProxyDefaultModel?: string;
  systemProxyServedModels?: string[];
  setSystemProxy?: boolean;
  tunnelBuyerPort?: number;
}

export type AppendLogFn = (mode: RuntimeMode, stream: 'stdout' | 'stderr' | 'system', line: string) => void;

export function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return {};
}

export function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

export function asNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return fallback;
}

export function asStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

export function asErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  const text = String(error ?? '').trim();
  return text.length > 0 ? text : 'Unexpected error';
}
