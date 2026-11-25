import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import * as nodeFs from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);
// Electron patches node:fs so paths ending in `.asar` behave as virtual directories,
// causing `ENOENT, not found in ...\resources\app.asar` on read/write/rename.
// Using `original-fs` bypasses ASAR interception inside Electron and falls back
// cleanly to standard `node:fs` in plain Node tests.
function loadRawFs(): typeof nodeFs {
  try {
    return require('original-fs') as typeof nodeFs;
  } catch {
    return nodeFs;
  }
}

const rawFs = loadRawFs();
const rawPromises = rawFs.promises;

const execFileAsync = promisify(execFile);
const PROBE_TIMEOUT_MS = 1_500;
const STATUS_CACHE_TTL_MS = 15_000;

const ORIGINAL_ENDPOINT = 'https://daily-cloudcode-pa.googleapis.com';
// Same byte length as ORIGINAL_ENDPOINT. Percent-decoding produces exactly
// /app/antigravity, while keeping every ASAR header offset unchanged.
const PATCHED_ENDPOINT = 'http://127.0.0.1:8378/app/%61ntigr%61vity';
const DEFAULT_BACKUP_ROOT = path.join(homedir(), '.torve', 'backups', 'antigravity-standalone');
const STATE_FILE = 'state.json';

if (Buffer.byteLength(ORIGINAL_ENDPOINT) !== Buffer.byteLength(PATCHED_ENDPOINT)) {
  throw new Error('Antigravity endpoint patch must preserve the ASAR byte length.');
}

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
  bypassCache?: boolean;
  env?: NodeJS.ProcessEnv;
};

const versionCache = new Map<string, { sig: string; version: string }>();
let registryInstallCache: { checked: boolean; dir: string | null } = { checked: false, dir: null };
let defaultStatusCache: { at: number; sig: string; status: AntigravityStandaloneStatus } | null = null;
let defaultStatusInFlight: Promise<AntigravityStandaloneStatus> | null = null;

export function invalidateAntigravityStandaloneCache(): void {
  defaultStatusCache = null;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function occurrences(bytes: Buffer, needle: string): number {
  const target = Buffer.from(needle);
  let count = 0;
  let offset = 0;
  while ((offset = bytes.indexOf(target, offset)) !== -1) {
    count++;
    offset += target.length;
  }
  return count;
}

function replaceExactlyOnce(bytes: Buffer, from: string, to: string): Buffer {
  if (occurrences(bytes, from) !== 1 || occurrences(bytes, to) !== 0) {
    throw new Error('Expected a single clean Antigravity Cloud Code endpoint pattern. Refusing to patch.');
  }
  const result = Buffer.from(bytes);
  Buffer.from(to).copy(result, result.indexOf(Buffer.from(from)));
  return result;
}

function defaultWindowsCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const localAppData = env['LOCALAPPDATA']?.trim() || path.join(homedir(), 'AppData', 'Local');
  const userProfile = env['USERPROFILE']?.trim();
  const programFiles = env['ProgramFiles']?.trim() || 'C:\\Program Files';
  const programFilesX86 = env['ProgramFiles(x86)']?.trim() || 'C:\\Program Files (x86)';

  const raw = [
    path.join(localAppData, 'Programs', 'Antigravity'),
    userProfile ? path.join(userProfile, 'AppData', 'Local', 'Programs', 'Antigravity') : null,
    path.join(programFiles, 'Antigravity'),
    path.join(programFilesX86, 'Antigravity'),
  ].filter((p): p is string => Boolean(p));

  return [...new Set(raw.map((p) => path.resolve(p)))];
}

async function queryUninstallRegistryAntigravity(): Promise<string | null> {
  if (process.platform !== 'win32') return null;
  if (registryInstallCache.checked) return registryInstallCache.dir;

  const keys = [
    'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ];

  let foundDir: string | null = null;
  for (const key of keys) {
    try {
      const { stdout } = await execFileAsync(
        'reg.exe',
        ['query', key, '/s', '/f', 'Antigravity', '/d'],
        { encoding: 'utf8', windowsHide: true, timeout: PROBE_TIMEOUT_MS },
      );
      const installMatch = /^\s*InstallLocation\s+REG_\w+\s+(.+)$/im.exec(stdout);
      const iconMatch = /^\s*DisplayIcon\s+REG_\w+\s+(.+)$/im.exec(stdout);
      const rawPath = installMatch?.[1]?.trim() || iconMatch?.[1]?.trim().replace(/,\d+$/, '');
      if (!rawPath) continue;
      const clean = rawPath.replace(/^"|"$/g, '');
      const candidate = clean.toLowerCase().endsWith('.exe') ? path.dirname(clean) : clean;
      if (rawFs.existsSync(path.join(candidate, 'Antigravity.exe'))) {
        foundDir = candidate;
        break;
      }
    } catch {
      // Continue trying remaining uninstall hives.
    }
  }

  registryInstallCache = { checked: true, dir: foundDir };
  return foundDir;
}

export async function discoverAntigravityInstallDir(options: AntigravityStandalonePatchOptions = {}): Promise<string> {
  if (options.installDir) return options.installDir;

  const env = options.env ?? process.env;
  if (process.platform === 'darwin') {
    const macCandidates = ['/Applications/Antigravity.app/Contents', path.join(homedir(), 'Applications', 'Antigravity.app', 'Contents')];
    for (const dir of macCandidates) {
      if (rawFs.existsSync(path.join(dir, 'Resources'))) return dir;
    }
    return macCandidates[0]!;
  }

  const candidates = defaultWindowsCandidates(env);
  for (const dir of candidates) {
    if (rawFs.existsSync(path.join(dir, 'Antigravity.exe')) || rawFs.existsSync(path.join(dir, 'resources'))) {
      return dir;
    }
  }

  if (!options.env) {
    const regDir = await queryUninstallRegistryAntigravity();
    if (regDir) return regDir;
  }

  return candidates[0]!;
}

const UNPACKED_RESOURCE_CANDIDATES = [
  'out/main.js',
  'out/vs/code/electron-main/main.js',
  'out/main/index.js',
];

async function findEndpointInUnpackedApp(appDir: string): Promise<string | null> {
  for (const rel of UNPACKED_RESOURCE_CANDIDATES) {
    const full = path.join(appDir, rel);
    if (!rawFs.existsSync(full)) continue;
    try {
      const bytes = await rawPromises.readFile(full);
      if (occurrences(bytes, ORIGINAL_ENDPOINT) === 1 || occurrences(bytes, PATCHED_ENDPOINT) === 1) {
        return full;
      }
    } catch {
      // Skip unreadable file.
    }
  }
  return null;
}

async function resolvePaths(options: AntigravityStandalonePatchOptions) {
  const installDir = await discoverAntigravityInstallDir(options);
  const backupRoot = options.backupRoot ?? DEFAULT_BACKUP_ROOT;
  const resourcesDir = process.platform === 'darwin'
    ? (rawFs.existsSync(path.join(installDir, 'Resources'))
      ? path.join(installDir, 'Resources')
      : path.join(installDir, 'resources'))
    : (rawFs.existsSync(path.join(installDir, 'resources')) || !rawFs.existsSync(path.join(installDir, 'Resources'))
      ? path.join(installDir, 'resources')
      : path.join(installDir, 'Resources'));
  const exe = process.platform === 'darwin'
    ? path.join(installDir, 'MacOS', 'Antigravity')
    : path.join(installDir, 'Antigravity.exe');
  const asarTarget = path.join(resourcesDir, 'app.asar');
  const unpackedDir = path.join(resourcesDir, 'app');

  let target = asarTarget;
  if (!rawFs.existsSync(asarTarget) && rawFs.existsSync(unpackedDir)) {
    target = (await findEndpointInUnpackedApp(unpackedDir)) ?? asarTarget;
  }

  return {
    installDir,
    backupRoot,
    exe,
    resourcesDir,
    target,
    state: path.join(backupRoot, STATE_FILE),
  };
}

async function runningDefaultAsync(): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  try {
    const { stdout } = await execFileAsync('tasklist.exe', ['/FI', 'IMAGENAME eq Antigravity.exe', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: PROBE_TIMEOUT_MS,
    });
    return !stdout.includes('No tasks are running');
  } catch {
    return false;
  }
}

async function installedVersionAsync(exe: string, explicit?: string): Promise<string> {
  if (explicit) return explicit;
  if (process.platform !== 'win32') return 'unknown';
  try {
    const exeStat = await rawPromises.stat(exe);
    const sig = `${exeStat.mtimeMs}:${exeStat.size}`;
    const cached = versionCache.get(exe);
    if (cached && cached.sig === sig) return cached.version;

    const escaped = exe.replace(/'/g, "''");
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `(Get-Item -LiteralPath '${escaped}').VersionInfo.ProductVersion`],
      { encoding: 'utf8', windowsHide: true, timeout: PROBE_TIMEOUT_MS },
    );
    const version = stdout.trim() || 'unknown';
    versionCache.set(exe, { sig, version });
    return version;
  } catch {
    return 'unknown';
  }
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await rawPromises.readFile(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function atomicWrite(filePath: string, bytes: Uint8Array): Promise<void> {
  await rawPromises.mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await rawPromises.writeFile(temp, bytes, { mode: 0o600 });
  await rawPromises.rename(temp, filePath);
}

async function computeStatus(options: AntigravityStandalonePatchOptions): Promise<AntigravityStandaloneStatus> {
  const p = await resolvePaths(options);
  const runningPromise = options.isRunning ? Promise.resolve(options.isRunning()) : runningDefaultAsync();
  const exeExists = options.installDir ? true : (rawFs.existsSync(p.exe) || rawFs.existsSync(p.resourcesDir));
  const targetExists = rawFs.existsSync(p.target);

  if (!exeExists || !targetExists) {
    const running = await runningPromise;
    return {
      state: 'unavailable',
      installed: false,
      enabled: false,
      running,
      version: null,
      targetPath: p.target,
      message: rawFs.existsSync(p.resourcesDir)
        ? `Antigravity patch target was not found under ${p.resourcesDir}.`
        : 'Standalone Antigravity installation was not found.',
    };
  }

  const [running, version] = await Promise.all([
    runningPromise,
    installedVersionAsync(p.exe, options.version),
  ]);

  try {
    const bytes = await rawPromises.readFile(p.target);
    const hash = sha256(bytes);
    const state = await readJson<PatchState>(p.state);
    const manifest = state ? await readJson<AntigravityStandaloneManifest>(state.manifestPath) : null;
    const file = manifest?.files.find((entry) => path.resolve(entry.originalPath) === path.resolve(p.target));
    if (file && hash === file.patchedSha256) {
      return {
        state: running ? 'close-antigravity' : 'active',
        installed: true,
        enabled: true,
        running,
        version,
        targetPath: p.target,
        message: running ? 'Close Antigravity before toggling.' : 'Active',
      };
    }
    if (state?.enabled && (!file || hash !== file.originalSha256)) {
      return {
        state: running ? 'close-antigravity' : 'needs-reapply',
        installed: true,
        enabled: false,
        running,
        version,
        targetPath: p.target,
        message: running ? 'Close Antigravity before toggling.' : 'Needs Re-apply (Antigravity updated)',
      };
    }
    if (occurrences(bytes, ORIGINAL_ENDPOINT) === 1 && occurrences(bytes, PATCHED_ENDPOINT) === 0) {
      return {
        state: running ? 'close-antigravity' : 'inactive',
        installed: true,
        enabled: false,
        running,
        version,
        targetPath: p.target,
        message: running ? 'Close Antigravity before toggling.' : 'Native picker patch is off.',
      };
    }
    return {
      state: 'error',
      installed: true,
      enabled: false,
      running,
      version,
      targetPath: p.target,
      message: 'Antigravity endpoint pattern is not in a recognized clean state.',
    };
  } catch (err) {
    return {
      state: 'error',
      installed: true,
      enabled: false,
      running,
      version,
      targetPath: p.target,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function targetSignature(p: Awaited<ReturnType<typeof resolvePaths>>): Promise<string> {
  try {
    const [targetStat, stateStat] = await Promise.all([
      rawPromises.stat(p.target).catch(() => null),
      rawPromises.stat(p.state).catch(() => null),
    ]);
    return `${targetStat?.mtimeMs ?? 0}:${targetStat?.size ?? 0}:${stateStat?.mtimeMs ?? 0}`;
  } catch {
    return 'none';
  }
}

export async function antigravityStandaloneStatus(options: AntigravityStandalonePatchOptions = {}): Promise<AntigravityStandaloneStatus> {
  const isDefaultCall = !options.installDir && !options.backupRoot && !options.version && !options.isRunning && !options.env;
  if (!isDefaultCall) {
    return computeStatus(options);
  }

  const p = await resolvePaths(options);
  const sig = await targetSignature(p);
  if (!options.bypassCache && defaultStatusCache && defaultStatusCache.sig === sig && Date.now() - defaultStatusCache.at < STATUS_CACHE_TTL_MS) {
    const running = await runningDefaultAsync();
    if (running === defaultStatusCache.status.running) {
      return defaultStatusCache.status;
    }
  }

  if (!defaultStatusInFlight) {
    defaultStatusInFlight = computeStatus(options).then((status) => {
      defaultStatusCache = { at: Date.now(), sig, status };
      return status;
    }).finally(() => {
      defaultStatusInFlight = null;
    });
  }
  return defaultStatusInFlight;
}

export async function enableAntigravityStandalonePatch(options: AntigravityStandalonePatchOptions = {}): Promise<AntigravityStandaloneStatus> {
  invalidateAntigravityStandaloneCache();
  const p = await resolvePaths(options);
  const running = options.isRunning ? options.isRunning() : await runningDefaultAsync();
  if (running) throw new Error('Close Antigravity before enabling the native model picker patch.');
  if (!rawFs.existsSync(p.target)) {
    throw new Error(`Standalone Antigravity patch target was not found under ${p.resourcesDir}.`);
  }
  const version = await installedVersionAsync(p.exe, options.version);
  const original = await rawPromises.readFile(p.target);
  if (occurrences(original, PATCHED_ENDPOINT) === 1 && occurrences(original, ORIGINAL_ENDPOINT) === 0) {
    const status = await antigravityStandaloneStatus({ ...options, bypassCache: true });
    if (status.state === 'active') return status;
    throw new Error('Antigravity is patched but its verified Torve backup manifest is missing. Refusing to overwrite it.');
  }
  const patched = replaceExactlyOnce(original, ORIGINAL_ENDPOINT, PATCHED_ENDPOINT);
  const versionDir = path.join(p.backupRoot, version);
  const backupPath = path.join(versionDir, `${path.basename(p.target)}.original`);
  const manifestPath = path.join(versionDir, 'manifest.json');
  const prior = await readJson<AntigravityStandaloneManifest>(manifestPath);
  if (prior && prior.files[0]?.originalSha256 !== sha256(original)) {
    throw new Error('A different build with the same Antigravity version is already backed up. Refusing to overwrite the verified backup.');
  }
  await rawPromises.mkdir(versionDir, { recursive: true });
  if (!rawFs.existsSync(backupPath)) await atomicWrite(backupPath, original);
  const backup = await rawPromises.readFile(backupPath);
  if (sha256(backup) !== sha256(original)) throw new Error('Antigravity backup SHA-256 verification failed. Nothing was patched.');
  const manifest: AntigravityStandaloneManifest = {
    version: 1,
    antigravityVersion: version,
    createdAt: new Date().toISOString(),
    files: [{ originalPath: p.target, backupPath, originalSha256: sha256(original), patchedSha256: sha256(patched) }],
  };
  await atomicWrite(manifestPath, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  await atomicWrite(p.target, patched);
  if (sha256(await rawPromises.readFile(p.target)) !== manifest.files[0]!.patchedSha256) {
    throw new Error('Antigravity patched-file verification failed. Restore from the verified backup before launching Antigravity.');
  }
  await atomicWrite(p.state, Buffer.from(`${JSON.stringify({ enabled: true, antigravityVersion: version, manifestPath, updatedAt: new Date().toISOString() } satisfies PatchState, null, 2)}\n`));
  return antigravityStandaloneStatus({ ...options, bypassCache: true });
}

export async function disableAntigravityStandalonePatch(options: AntigravityStandalonePatchOptions = {}): Promise<AntigravityStandaloneStatus> {
  invalidateAntigravityStandaloneCache();
  const p = await resolvePaths(options);
  const running = options.isRunning ? options.isRunning() : await runningDefaultAsync();
  if (running) throw new Error('Close Antigravity before disabling the native model picker patch.');
  const state = await readJson<PatchState>(p.state);
  if (!state) throw new Error('No Torve standalone Antigravity patch state was found.');
  const manifest = await readJson<AntigravityStandaloneManifest>(state.manifestPath);
  const file = manifest?.files.find((entry) => path.resolve(entry.originalPath) === path.resolve(p.target));
  if (!manifest || !file) throw new Error('The verified Antigravity backup manifest is missing.');
  const current = await rawPromises.readFile(p.target);
  if (sha256(current) !== file.patchedSha256) throw new Error('Antigravity changed after Torve patched it (possibly an update). Refusing to overwrite the new file.');
  const original = await rawPromises.readFile(file.backupPath);
  if (sha256(original) !== file.originalSha256) throw new Error('Antigravity backup SHA-256 verification failed. Restore was cancelled.');
  await atomicWrite(p.target, original);
  if (sha256(await rawPromises.readFile(p.target)) !== file.originalSha256) throw new Error('Antigravity restore verification failed.');
  await atomicWrite(p.state, Buffer.from(`${JSON.stringify({ ...state, enabled: false, updatedAt: new Date().toISOString() }, null, 2)}\n`));
  return antigravityStandaloneStatus({ ...options, bypassCache: true });
}

export const ANTIGRAVITY_STANDALONE_PATCH_INTERNALS = { ORIGINAL_ENDPOINT, PATCHED_ENDPOINT };
