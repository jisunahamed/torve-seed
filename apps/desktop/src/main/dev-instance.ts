import path from 'node:path';

const MULTI_INSTANCE_ENV = 'TORVE_DESKTOP_MULTI_INSTANCE';

export function isMultiInstanceDevelopment(): boolean {
  return process.env[MULTI_INSTANCE_ENV] === '1';
}

export function shouldRemoveSharedConfigPatches(reason: 'disconnect' | 'shutdown'): boolean {
  return reason === 'disconnect' || !isMultiInstanceDevelopment();
}

export function desktopInstanceName(): string {
  return process.env['TORVE_DESKTOP_INSTANCE']?.trim() ?? '';
}

function envPath(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? path.resolve(value) : null;
}

export function desktopUserDataDir(): string | null {
  return envPath('TORVE_DESKTOP_USER_DATA_DIR');
}

export function desktopSystemProxyDataDir(): string | null {
  return envPath('TORVE_SYSTEM_PROXY_DATA_DIR');
}

export function desktopSystemProxyCliDataDir(): string | null {
  const dataDir = desktopSystemProxyDataDir();
  return dataDir ? path.dirname(dataDir) : null;
}
