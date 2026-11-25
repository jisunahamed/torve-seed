import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const OVERRIDES_PATH = path.join(homedir(), '.torve', 'direct-cloud-overrides.json');

export type DirectCloudModelOverride = { modelId: string; enabled: boolean };
export type DirectCloudModelOverrides = Record<string, DirectCloudModelOverride>;

let memory: DirectCloudModelOverrides | null = null;

function validAppId(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value);
}

export async function getDirectCloudOverrides(): Promise<DirectCloudModelOverrides> {
  if (memory) return { ...memory };
  try {
    const raw = JSON.parse(await readFile(OVERRIDES_PATH, 'utf8')) as Record<string, unknown>;
    const result: DirectCloudModelOverrides = {};
    for (const [appId, value] of Object.entries(raw)) {
      if (!validAppId(appId) || !value || typeof value !== 'object') continue;
      const entry = value as Record<string, unknown>;
      if (typeof entry['modelId'] !== 'string' || !entry['modelId'].trim()) continue;
      result[appId] = { modelId: entry['modelId'].trim(), enabled: entry['enabled'] !== false };
    }
    memory = result;
  } catch {
    memory = {};
  }
  return { ...memory };
}

export async function setDirectCloudOverride(appId: string, value: DirectCloudModelOverride | null): Promise<DirectCloudModelOverrides> {
  if (!validAppId(appId)) throw new Error('Invalid connected-app identifier.');
  const next = await getDirectCloudOverrides();
  if (value === null) delete next[appId];
  else {
    const modelId = value.modelId.trim();
    if (!modelId) throw new Error('A model is required.');
    next[appId] = { modelId, enabled: value.enabled !== false };
  }
  await mkdir(path.dirname(OVERRIDES_PATH), { recursive: true });
  const temp = `${OVERRIDES_PATH}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, OVERRIDES_PATH);
  memory = next;
  return { ...next };
}

export async function resolveDirectCloudModel(appId: string | null, requested: string | null, fallback: string | null): Promise<string | null> {
  const override = appId ? (await getDirectCloudOverrides())[appId] : undefined;
  return resolveDirectCloudModelChoice(appId, requested, fallback, override);
}

export function resolveDirectCloudModelChoice(
  appId: string | null,
  requested: string | null,
  fallback: string | null,
  override?: DirectCloudModelOverride,
): string | null {
  const aliasRequested = !requested || requested === 'torve' || requested === 'auto';
  // Per-app defaults resolve only aliases. A concrete picker selection from
  // any catalog-aware connector must always reach Torve Cloud unchanged.
  if (!aliasRequested) return requested;
  if (appId) {
    if (override?.enabled && override.modelId) return override.modelId;
  }
  return fallback;
}
