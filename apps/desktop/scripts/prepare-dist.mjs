/**
 * Replace pnpm workspace symlinks in node_modules with real copies so
 * electron-builder can pack them into the asar archive, and install an
 * Electron-ABI-compatible prebuild for better-sqlite3.
 */

import { lstatSync, rmSync, rmdirSync, unlinkSync, cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appDir = path.resolve(__dirname, '..');
const nmDir = path.join(appDir, 'node_modules');

/** Workspace packages required by the Electron main process and shared code at runtime. */
const WORKSPACE_PACKAGES = {
  '@torveai/api-adapter': path.resolve(appDir, '..', '..', 'packages', 'api-adapter'),
  '@torveai/node': path.resolve(appDir, '..', '..', 'packages', 'node'),
};

function removeLinkOrDir(targetPath) {
  try {
    const stat = lstatSync(targetPath);
    if (stat.isSymbolicLink()) {
      try { unlinkSync(targetPath); } catch { rmdirSync(targetPath); }
      return;
    }
  } catch {
    return;
  }
  rmSync(targetPath, { recursive: true, force: true });
}

function copyWorkspacePackage(linkPath, sourcePath, label) {
  console.log(`[prepare-dist] Copying workspace package: ${label} -> ${sourcePath}`);
  removeLinkOrDir(linkPath);
  const innerNm = path.join(sourcePath, 'node_modules');
  cpSync(sourcePath, linkPath, {
    recursive: true,
    dereference: true,
    filter: (src) => src !== innerNm && path.basename(src) !== 'node_modules',
  });
}

// --- 1. Replace workspace symlinks/stale copies with fresh copies from source ---

for (const [pkgName, sourcePath] of Object.entries(WORKSPACE_PACKAGES)) {
  const parts = pkgName.split('/');
  const linkPath = parts.length === 2
    ? path.join(nmDir, parts[0], parts[1])
    : path.join(nmDir, parts[0]);

  if (parts.length === 2) {
    mkdirSync(path.join(nmDir, parts[0]), { recursive: true });
  }

  copyWorkspacePackage(linkPath, sourcePath, pkgName);
}

// --- 2. Remove stale legacy CLI / bundled-runtime artifacts if present ---

for (const legacyDir of ['cli-dist', 'bundled-runtime', 'bundled-plugins']) {
  const fullPath = path.join(appDir, legacyDir);
  if (existsSync(fullPath)) {
    rmSync(fullPath, { recursive: true, force: true });
    console.log(`[prepare-dist] Removed legacy directory: ${legacyDir}`);
  }
}

// --- 3. Install Electron-compatible native module prebuilds ---
// codex-threads.ts opens Codex's SQLite DB via better-sqlite3, which must
// match Electron's Node ABI rather than the host system Node.

const electronPkg = JSON.parse(
  readFileSync(path.resolve(appDir, '..', '..', 'node_modules', 'electron', 'package.json'), 'utf8'),
);
const electronVersion = electronPkg.version;
const betterSqlite3Dir = path.resolve(appDir, '..', '..', 'node_modules', 'better-sqlite3');

const targetArch = process.env.TORVE_PACK_ARCH || process.arch;
if (!['x64', 'arm64'].includes(targetArch)) {
  throw new Error(`[prepare-dist] Unsupported TORVE_PACK_ARCH=${targetArch}`);
}

const prebuildInstallEntry = createRequire(
  path.join(betterSqlite3Dir, 'package.json'),
).resolve('prebuild-install/bin.js');
console.log(`[prepare-dist] Installing better-sqlite3 prebuild for Electron ${electronVersion} (${targetArch})...`);
execFileSync(process.execPath, [
  prebuildInstallEntry,
  '--runtime', 'electron',
  '--target', electronVersion,
  '--arch', targetArch,
  '--verbose',
], { cwd: betterSqlite3Dir, stdio: 'inherit' });

if (process.platform === 'darwin') {
  const nodeFile = path.join(betterSqlite3Dir, 'build', 'Release', 'better_sqlite3.node');
  if (existsSync(nodeFile)) {
    const desc = execFileSync('file', [nodeFile], { encoding: 'utf8' });
    const expected = targetArch === 'arm64' ? 'arm64' : 'x86_64';
    if (!desc.includes(expected)) {
      throw new Error(
        `[prepare-dist] better_sqlite3.node arch mismatch — expected ${expected}, got: ${desc.trim()}`,
      );
    }
    console.log(`[prepare-dist] Verified better_sqlite3.node is ${expected}`);
  }
}

console.log('[prepare-dist] Done.');
