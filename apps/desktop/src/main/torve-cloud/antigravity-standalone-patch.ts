import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const ORIGINAL_ENDPOINT = 'https://daily-cloudcode-pa.googleapis.com';
// Same byte length as ORIGINAL_ENDPOINT. Percent-decoding produces exactly
// /app/antigravity, while keeping every ASAR header offset unchanged.
const PATCHED_ENDPOINT = 'http://127.0.0.1:8378/app/%61ntigr%61vity';
const DEFAULT_INSTALL_DIR = path.join(process.env['LOCALAPPDATA'] || path.join(homedir(), 'AppData', 'Local'), 'Programs', 'Antigravity');
const DEFAULT_BACKUP_ROOT = path.join(homedir(), '.torve', 'backups', 'antigravity-standalone');
const STATE_FILE = 'state.json';

if (Buffer.byteLength(ORIGINAL_ENDPOINT) !== Buffer.byteLength(PATCHED_ENDPOINT)) throw new Error('Antigravity endpoint patch must preserve the ASAR byte length.');

type PatchFile = { originalPath: string; backupPath: string; originalSha256: string; patchedSha256: string };
export type AntigravityStandaloneManifest = { version: 1; antigravityVersion: string; createdAt: string; files: PatchFile[] };
type PatchState = { enabled: boolean; antigravityVersion: string; manifestPath: string; updatedAt: string };
export type AntigravityStandaloneStatus = {
  state: 'unavailable' | 'inactive' | 'active' | 'needs-reapply' | 'close-antigravity' | 'error';
  installed: boolean;
  enabled: boolean;
  running: boolean;
  version: string | null;
  targetPath: string;
  message: string;
};

export type AntigravityStandalonePatchOptions = {
  installDir?: string;
  backupRoot?: string;
  version?: string;
  isRunning?: () => boolean;
};

function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
function occurrences(bytes: Buffer, needle: string): number {
  const target = Buffer.from(needle); let count = 0; let offset = 0;
  while ((offset = bytes.indexOf(target, offset)) !== -1) { count++; offset += target.length; }
  return count;
}
function replaceExactlyOnce(bytes: Buffer, from: string, to: string): Buffer {
  if (occurrences(bytes, from) !== 1 || occurrences(bytes, to) !== 0) throw new Error('Expected a single clean Antigravity Cloud Code endpoint pattern. Refusing to patch.');
  const result = Buffer.from(bytes);
  Buffer.from(to).copy(result, result.indexOf(Buffer.from(from)));
  return result;
}
function paths(options: AntigravityStandalonePatchOptions) {
  const installDir = options.installDir ?? DEFAULT_INSTALL_DIR;
  const backupRoot = options.backupRoot ?? DEFAULT_BACKUP_ROOT;
  return { installDir, backupRoot, exe: path.join(installDir, 'Antigravity.exe'), target: path.join(installDir, 'resources', 'app.asar'), state: path.join(backupRoot, STATE_FILE) };
}
function runningDefault(): boolean {
  if (process.platform !== 'win32') return false;
  try { return !execFileSync('tasklist.exe', ['/FI', 'IMAGENAME eq Antigravity.exe', '/NH'], { encoding: 'utf8', windowsHide: true }).includes('No tasks are running'); }
  catch { return false; }
}
function installedVersion(exe: string, explicit?: string): string {
  if (explicit) return explicit;
  if (process.platform !== 'win32') return 'unknown';
  const escaped = exe.replace(/'/g, "''");
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Item -LiteralPath '${escaped}').VersionInfo.ProductVersion`], { encoding: 'utf8', windowsHide: true }).trim() || 'unknown';
  } catch { return 'unknown'; }
}
async function readJson<T>(filePath: string): Promise<T | null> { try { return JSON.parse(await readFile(filePath, 'utf8')) as T; } catch { return null; } }
async function atomicWrite(filePath: string, bytes: Uint8Array): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, bytes, { mode: 0o600 });
  await rename(temp, filePath);
}

export async function antigravityStandaloneStatus(options: AntigravityStandalonePatchOptions = {}): Promise<AntigravityStandaloneStatus> {
  const p = paths(options); const running = (options.isRunning ?? runningDefault)();
  if (!existsSync(p.exe) || !existsSync(p.target)) return { state: 'unavailable', installed: false, enabled: false, running, version: null, targetPath: p.target, message: 'Standalone Antigravity installation was not found.' };
  const version = installedVersion(p.exe, options.version);
  try {
    const bytes = await readFile(p.target); const hash = sha256(bytes);
    const state = await readJson<PatchState>(p.state);
    const manifest = state ? await readJson<AntigravityStandaloneManifest>(state.manifestPath) : null;
    const file = manifest?.files.find((entry) => path.resolve(entry.originalPath) === path.resolve(p.target));
    if (file && hash === file.patchedSha256) return { state: running ? 'close-antigravity' : 'active', installed: true, enabled: true, running, version, targetPath: p.target, message: running ? 'Close Antigravity before toggling.' : 'Active' };
    if (state?.enabled && (!file || hash !== file.originalSha256)) return { state: running ? 'close-antigravity' : 'needs-reapply', installed: true, enabled: false, running, version, targetPath: p.target, message: running ? 'Close Antigravity before toggling.' : 'Needs Re-apply (Antigravity updated)' };
    if (occurrences(bytes, ORIGINAL_ENDPOINT) === 1 && occurrences(bytes, PATCHED_ENDPOINT) === 0) return { state: running ? 'close-antigravity' : 'inactive', installed: true, enabled: false, running, version, targetPath: p.target, message: running ? 'Close Antigravity before toggling.' : 'Native picker patch is off.' };
    return { state: 'error', installed: true, enabled: false, running, version, targetPath: p.target, message: 'Antigravity endpoint pattern is not in a recognized clean state.' };
  } catch (err) { return { state: 'error', installed: true, enabled: false, running, version, targetPath: p.target, message: err instanceof Error ? err.message : String(err) }; }
}

export async function enableAntigravityStandalonePatch(options: AntigravityStandalonePatchOptions = {}): Promise<AntigravityStandaloneStatus> {
  const p = paths(options); const isRunning = options.isRunning ?? runningDefault;
  if (isRunning()) throw new Error('Close Antigravity before enabling the native model picker patch.');
  if (!existsSync(p.exe) || !existsSync(p.target)) throw new Error('Standalone Antigravity installation was not found.');
  const version = installedVersion(p.exe, options.version);
  const original = await readFile(p.target);
  if (occurrences(original, PATCHED_ENDPOINT) === 1 && occurrences(original, ORIGINAL_ENDPOINT) === 0) {
    const status = await antigravityStandaloneStatus(options);
    if (status.state === 'active') return status;
    throw new Error('Antigravity is patched but its verified Torve backup manifest is missing. Refusing to overwrite it.');
  }
  const patched = replaceExactlyOnce(original, ORIGINAL_ENDPOINT, PATCHED_ENDPOINT);
  const versionDir = path.join(p.backupRoot, version);
  const backupPath = path.join(versionDir, 'app.asar.original');
  const manifestPath = path.join(versionDir, 'manifest.json');
  const prior = await readJson<AntigravityStandaloneManifest>(manifestPath);
  if (prior && prior.files[0]?.originalSha256 !== sha256(original)) throw new Error('A different build with the same Antigravity version is already backed up. Refusing to overwrite the verified backup.');
  await mkdir(versionDir, { recursive: true });
  if (!existsSync(backupPath)) await atomicWrite(backupPath, original);
  const backup = await readFile(backupPath);
  if (sha256(backup) !== sha256(original)) throw new Error('Antigravity backup SHA-256 verification failed. Nothing was patched.');
  const manifest: AntigravityStandaloneManifest = { version: 1, antigravityVersion: version, createdAt: new Date().toISOString(), files: [{ originalPath: p.target, backupPath, originalSha256: sha256(original), patchedSha256: sha256(patched) }] };
  await atomicWrite(manifestPath, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  await atomicWrite(p.target, patched);
  if (sha256(await readFile(p.target)) !== manifest.files[0]!.patchedSha256) throw new Error('Antigravity patched-file verification failed. Restore from the verified backup before launching Antigravity.');
  await atomicWrite(p.state, Buffer.from(`${JSON.stringify({ enabled: true, antigravityVersion: version, manifestPath, updatedAt: new Date().toISOString() } satisfies PatchState, null, 2)}\n`));
  return antigravityStandaloneStatus(options);
}

export async function disableAntigravityStandalonePatch(options: AntigravityStandalonePatchOptions = {}): Promise<AntigravityStandaloneStatus> {
  const p = paths(options); const isRunning = options.isRunning ?? runningDefault;
  if (isRunning()) throw new Error('Close Antigravity before disabling the native model picker patch.');
  const state = await readJson<PatchState>(p.state);
  if (!state) throw new Error('No Torve standalone Antigravity patch state was found.');
  const manifest = await readJson<AntigravityStandaloneManifest>(state.manifestPath);
  const file = manifest?.files.find((entry) => path.resolve(entry.originalPath) === path.resolve(p.target));
  if (!manifest || !file) throw new Error('The verified Antigravity backup manifest is missing.');
  const current = await readFile(p.target);
  if (sha256(current) !== file.patchedSha256) throw new Error('Antigravity changed after Torve patched it (possibly an update). Refusing to overwrite the new file.');
  const original = await readFile(file.backupPath);
  if (sha256(original) !== file.originalSha256) throw new Error('Antigravity backup SHA-256 verification failed. Restore was cancelled.');
  await atomicWrite(p.target, original);
  if (sha256(await readFile(p.target)) !== file.originalSha256) throw new Error('Antigravity restore verification failed.');
  await atomicWrite(p.state, Buffer.from(`${JSON.stringify({ ...state, enabled: false, updatedAt: new Date().toISOString() }, null, 2)}\n`));
  return antigravityStandaloneStatus(options);
}

export const ANTIGRAVITY_STANDALONE_PATCH_INTERNALS = { ORIGINAL_ENDPOINT, PATCHED_ENDPOINT };
