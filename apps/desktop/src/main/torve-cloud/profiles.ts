import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { getTorveCloudApiKey } from '../ipc/torve-account.js';
import { ensureClaudeDesktopGateway, stopClaudeDesktopGateway } from '../connected-apps/claude-desktop-gateway.js';
import { CLAUDE_DESKTOP_PROFILE_ID, claudeDesktopPatchTargets, removeConfigPatch, applyConfigPatch } from '../system-proxy/config-patch.js';
import type { ConfigPatchDef } from '../system-proxy/config-patch.js';
import { systemProxyWslTargetsPath } from '../system-proxy/paths.js';
import { SYSTEM_PROXY_PROFILES } from '../system-proxy/profiles.js';
import { startTorveCloudProxy, stopTorveCloudProxy, torveCloudProxyStatus } from './proxy.js';
import { discardDirectCloudBackup, prepareDirectCloudBackup, restoreDirectCloudBackup, rollbackDirectCloudBackup, sealDirectCloudBackup } from './backups.js';
import { getDirectCloudOverrides } from './overrides.js';

const STATE_PATH = path.join(homedir(), '.torve', 'direct-cloud-profiles.json');
const PORT = Number(process.env['TORVE_CLOUD_PROXY_PORT']) || 8378;
type State = { profiles: string[]; updatedAt: number };

async function load(): Promise<State> {
  try { const raw = JSON.parse(await readFile(STATE_PATH, 'utf8')) as Partial<State>; return { profiles: Array.isArray(raw.profiles) ? raw.profiles.filter((name): name is string => typeof name === 'string') : [], updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0 }; }
  catch { return { profiles: [], updatedAt: 0 }; }
}
async function save(next: State): Promise<void> { await mkdir(path.dirname(STATE_PATH), { recursive: true }); const temp = `${STATE_PATH}.tmp`; await writeFile(temp, JSON.stringify(next) + '\n', { mode: 0o600 }); await rename(temp, STATE_PATH); }
function cloudProfiles(names: string[]) {
  const found = names.map((name) => SYSTEM_PROXY_PROFILES.find((profile) => profile.name === name));
  if (found.some((profile) => !profile)) throw new Error('One or more selected apps are unknown.');
  if (found.some((profile) => profile?.kind !== 'config-patch' || !profile.configPatch)) throw new Error('Closed desktop apps cannot use Direct Torve Cloud. Use their documented custom-endpoint option; TLS-pinned apps are never silently MITM-routed.');
  return found;
}

function directPatch(appId: string, patch: ConfigPatchDef): ConfigPatchDef {
  if (patch.format === 'claude-desktop') return patch;
  if (!('baseURL' in patch)) return patch;
  const base = patch.baseURL.replace(/\/+$/, '');
  const suffix = base.endsWith('/v1') ? '/v1' : '';
  const root = suffix ? base.slice(0, -3) : base;
  return { ...patch, baseURL: `${root}/app/${appId}${suffix}` } as ConfigPatchDef;
}

function expandHome(filePath: string): string {
  return filePath === '~' ? homedir() : filePath.startsWith('~/') ? path.join(homedir(), filePath.slice(2)) : filePath;
}

function backupPaths(patch: ConfigPatchDef): string[] {
  if (patch.format === 'claude-desktop') {
    const target = claudeDesktopPatchTargets(patch).find((candidate) => existsSync(path.dirname(candidate.configPath)));
    if (!target) return [];
    const library = path.join(target.thirdPartyDir, 'configLibrary');
    return [
      target.configPath,
      path.join(target.thirdPartyDir, 'claude_desktop_config.json'),
      path.join(library, '_meta.json'),
      path.join(library, `${CLAUDE_DESKTOP_PROFILE_ID}.json`),
    ];
  }
  const paths = [expandHome(patch.configPath)];
  if (patch.format === 'pi') paths.push(expandHome(patch.settingsPath));
  if (patch.format === 'gemini-cli') paths.push(expandHome(patch.envPath));
  if (patch.format === 'antigravity-mcp') paths.push(expandHome(patch.serverPath));
  if (patch.format === 'continue' && patch.legacyConfigPath && !existsSync(paths[0]!) && existsSync(expandHome(patch.legacyConfigPath))) return [expandHome(patch.legacyConfigPath)];
  return paths;
}

async function removeDirectPatch(appId: string, patch: ConfigPatchDef): Promise<void> {
  if (await restoreDirectCloudBackup(appId)) return;
  removeConfigPatch(directPatch(appId, patch), systemProxyWslTargetsPath());
  await discardDirectCloudBackup(appId);
}
export async function torveCloudProfilesState(): Promise<{ running: boolean; port: number; activeProfileNames: string[]; mode: 'system-proxy'; peerId: string; pid: null; startedAt: number; lastExitCode: null; lastError: null }> {
  const state = await load();
  return { running: torveCloudProxyStatus().running, port: PORT, activeProfileNames: state.profiles, mode: 'system-proxy', peerId: 'direct', pid: null, startedAt: state.updatedAt || Date.now(), lastExitCode: null, lastError: null };
}
export async function startTorveCloudProfiles(names: string[]): Promise<Awaited<ReturnType<typeof torveCloudProfilesState>>> {
  if (!await getTorveCloudApiKey()) throw new Error('Connect a Torve account before enabling an app.');
  const profiles = cloudProfiles([...new Set(names)]);
  const previous = await load();
  const alreadyConnected = new Set(previous.profiles);
  const toApply = profiles.filter((profile) => !alreadyConnected.has(profile!.name));
  await startTorveCloudProxy(PORT);
  if (profiles.some((profile) => profile?.configPatch?.format === 'claude-desktop')) {
    await ensureClaudeDesktopGateway(PORT, undefined, path.join(homedir(), '.torve', 'claude-direct-models.json'), '/app/claude-desktop');
  }
  const applied: typeof toApply = [];
  const overrides = await getDirectCloudOverrides();
  try {
    for (const profile of toApply) {
      const scoped = directPatch(profile!.name, profile!.configPatch!);
      const patch = scoped.format === 'gemini-cli' && overrides[profile!.name]?.enabled
        ? { ...scoped, model: overrides[profile!.name]!.modelId }
        : scoped;
      await prepareDirectCloudBackup(profile!.name, backupPaths(patch));
      try {
        applyConfigPatch(patch, 'direct', PORT, systemProxyWslTargetsPath());
        await sealDirectCloudBackup(profile!.name);
      } catch (err) {
        // A multi-file patch may fail after its first atomic write. Since the
        // backup is not sealed yet, restore its raw originals directly.
        await rollbackDirectCloudBackup(profile!.name);
        throw err;
      }
      applied.push(profile);
    }
  } catch (err) {
    // Do not leave a partially connected batch behind when an install probe
    // or a config parse fails midway through the toggle operation.
    for (const profile of applied.reverse()) await removeDirectPatch(profile!.name, profile!.configPatch!);
    throw err;
  }
  const requested = new Set(profiles.map((profile) => profile!.name));
  for (const name of previous.profiles) {
    if (requested.has(name)) continue;
    const removed = SYSTEM_PROXY_PROFILES.find((profile) => profile.name === name);
    if (removed?.configPatch) await removeDirectPatch(removed.name, removed.configPatch);
  }
  if (!profiles.some((profile) => profile?.configPatch?.format === 'claude-desktop')) await stopClaudeDesktopGateway();
  await save({ profiles: profiles.map((profile) => profile!.name), updatedAt: Date.now() });
  return torveCloudProfilesState();
}
export async function stopTorveCloudProfiles(): Promise<Awaited<ReturnType<typeof torveCloudProfilesState>>> {
  const state = await load();
  for (const name of state.profiles) {
    const profile = SYSTEM_PROXY_PROFILES.find((entry) => entry.name === name);
    if (profile?.configPatch) await removeDirectPatch(profile.name, profile.configPatch);
  }
  await save({ profiles: [], updatedAt: Date.now() });
  await stopTorveCloudProxy();
  await stopClaudeDesktopGateway();
  return torveCloudProfilesState();
}
