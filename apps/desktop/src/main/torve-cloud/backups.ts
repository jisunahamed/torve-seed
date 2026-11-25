import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

type BackupEntry = {
  originalPath: string;
  existedBefore: boolean;
  originalFile: string | null;
  sha256: string | null;
  patchedSha256: string | null;
};
type BackupManifest = { version: 1; appId: string; patchedAt: number | null; entries: BackupEntry[] };

function backupDir(appId: string): string {
  return path.join(homedir(), '.torve', 'backups', appId);
}
function manifestPath(appId: string): string { return path.join(backupDir(appId), 'manifest.json'); }
async function bytes(filePath: string): Promise<Buffer | null> {
  try { return await readFile(filePath); } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}
function sha256(value: Buffer): string { return createHash('sha256').update(value).digest('hex'); }
async function save(manifest: BackupManifest): Promise<void> {
  const filePath = manifestPath(manifest.appId);
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, filePath);
}
async function load(appId: string): Promise<BackupManifest | null> {
  try { return JSON.parse(await readFile(manifestPath(appId), 'utf8')) as BackupManifest; }
  catch { return null; }
}

/** Capture byte-for-byte originals before a direct-cloud config patch. */
export async function prepareDirectCloudBackup(appId: string, sourcePaths: readonly string[]): Promise<void> {
  const dir = backupDir(appId);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const entries: BackupEntry[] = [];
  for (const [index, sourcePath] of [...new Set(sourcePaths)].entries()) {
    const original = await bytes(sourcePath);
    const originalFile = original ? `original.${index}.${path.basename(sourcePath)}` : null;
    if (original && originalFile) await writeFile(path.join(dir, originalFile), original, { mode: 0o600 });
    entries.push({ originalPath: sourcePath, existedBefore: original !== null, originalFile, sha256: original ? sha256(original) : null, patchedSha256: null });
  }
  await save({ version: 1, appId, patchedAt: null, entries });
}

/** Add newly managed files to an existing backup without replacing originals
 * already captured by an older connector version. This is used when a live
 * upgrade starts managing an additional file (for example Claude Code's
 * settings.json alongside Claude Desktop's profile files). */
export async function extendDirectCloudBackup(appId: string, sourcePaths: readonly string[]): Promise<void> {
  const manifest = await load(appId);
  if (!manifest) return prepareDirectCloudBackup(appId, sourcePaths);
  const dir = backupDir(appId);
  const key = (filePath: string) => process.platform === 'win32' ? path.resolve(filePath).toLowerCase() : path.resolve(filePath);
  const known = new Set(manifest.entries.map((entry) => key(entry.originalPath)));
  let changed = false;
  for (const sourcePath of [...new Set(sourcePaths)]) {
    if (known.has(key(sourcePath))) continue;
    const original = await bytes(sourcePath);
    const index = manifest.entries.length;
    const originalFile = original ? `original.${index}.${path.basename(sourcePath)}` : null;
    if (original && originalFile) {
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, originalFile), original, { mode: 0o600 });
    }
    manifest.entries.push({
      originalPath: sourcePath,
      existedBefore: original !== null,
      originalFile,
      sha256: original ? sha256(original) : null,
      patchedSha256: null,
    });
    known.add(key(sourcePath));
    changed = true;
  }
  if (changed) await save(manifest);
}

/** Record post-patch hashes so disconnect can detect user edits safely. */
export async function sealDirectCloudBackup(appId: string): Promise<void> {
  const manifest = await load(appId);
  if (!manifest) return;
  for (const entry of manifest.entries) {
    const current = await bytes(entry.originalPath);
    entry.patchedSha256 = current ? sha256(current) : null;
  }
  manifest.patchedAt = Date.now();
  await save(manifest);
}

/** Whether every current file still matches the last bytes written by Torve.
 * Refresh callers use this before mutating a managed config: only an
 * untouched patch may be resealed, otherwise disconnect must fall back to a
 * semantic unpatch so user/app edits are not overwritten. */
export async function directCloudBackupMatchesPatched(appId: string): Promise<boolean> {
  const manifest = await load(appId);
  if (!manifest || manifest.patchedAt === null) return false;
  for (const entry of manifest.entries) {
    const current = await bytes(entry.originalPath);
    const currentSha = current ? sha256(current) : null;
    if (entry.patchedSha256 !== currentSha) return false;
  }
  return true;
}

/** Restore exact originals only when files still match Torve's patched bytes.
 * Returns false when user edits are present so the caller can use semantic
 * unpatching instead of overwriting them. */
export async function restoreDirectCloudBackup(appId: string, options: { forceExact?: boolean } = {}): Promise<boolean> {
  const manifest = await load(appId);
  if (!manifest) return false;
  if (!options.forceExact && !await directCloudBackupMatchesPatched(appId)) return false;
  const dir = backupDir(appId);
  for (const entry of manifest.entries) {
    if (entry.existedBefore && entry.originalFile) {
      await mkdir(path.dirname(entry.originalPath), { recursive: true });
      await copyFile(path.join(dir, entry.originalFile), entry.originalPath);
    } else {
      await rm(entry.originalPath, { force: true });
    }
  }
  await rm(dir, { recursive: true, force: true });
  return true;
}

export async function discardDirectCloudBackup(appId: string): Promise<void> {
  await rm(backupDir(appId), { recursive: true, force: true });
}

export type DirectCloudBackupSummary = {
  appId: string;
  patchedAt: number | null;
  createdAt: number;
  updatedAt: number;
  filesCount: number;
  targetPaths: string[];
  matchesPatched: boolean;
  files: Array<{ originalPath: string; existedBefore: boolean }>;
};

/** List all ~/.torve/backups/<appId> manifests for the Backup & Restore UI. */
export async function listDirectCloudBackups(): Promise<DirectCloudBackupSummary[]> {
  const root = path.join(homedir(), '.torve', 'backups');
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const results: DirectCloudBackupSummary[] = [];
  for (const appId of entries.sort()) {
    const manifest = await load(appId);
    if (!manifest) continue;
    const files = Array.isArray(manifest.entries) ? manifest.entries : [];
    const ts = typeof manifest.patchedAt === 'number' && Number.isFinite(manifest.patchedAt) ? manifest.patchedAt : 0;
    results.push({
      appId: manifest.appId || appId,
      patchedAt: manifest.patchedAt ?? null,
      createdAt: ts,
      updatedAt: ts,
      filesCount: files.length,
      targetPaths: files.map((entry) => entry.originalPath).filter((p): p is string => typeof p === 'string'),
      matchesPatched: await directCloudBackupMatchesPatched(appId),
      files: files.map((entry) => ({
        originalPath: entry.originalPath,
        existedBefore: entry.existedBefore,
      })),
    });
  }
  return results;
}

/** Roll back an apply that failed before the backup was sealed. */
export async function rollbackDirectCloudBackup(appId: string): Promise<void> {
  const manifest = await load(appId);
  if (!manifest) return;
  const dir = backupDir(appId);
  for (const entry of manifest.entries) {
    if (entry.existedBefore && entry.originalFile) {
      await mkdir(path.dirname(entry.originalPath), { recursive: true });
      await copyFile(path.join(dir, entry.originalFile), entry.originalPath);
    } else {
      await rm(entry.originalPath, { force: true });
    }
  }
  await rm(dir, { recursive: true, force: true });
}
