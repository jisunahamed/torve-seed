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
const repoRoot = path.resolve(appDir, '..', '..');
const nmDir = path.join(appDir, 'node_modules');

/** Workspace seed packages imported directly by Torve Desktop. */
const WORKSPACE_SEED_PACKAGES = {
  '@torveai/api-adapter': path.resolve(repoRoot, 'packages', 'api-adapter'),
  '@torveai/node': path.resolve(repoRoot, 'packages', 'node'),
};

/**
 * Walk `dependencies` of seed workspace packages recursively so transitive
 * `workspace:*` dependencies (e.g. `@torveai/buyer-core`, `@torveai/protocol`)
 * are also copied into `apps/desktop/node_modules` for ASAR packaging.
 */
function collectTransitiveWorkspacePackages() {
  const resolved = new Map(Object.entries(WORKSPACE_SEED_PACKAGES));
  const queue = [...resolved.entries()];

  while (queue.length > 0) {
    const [, pkgDir] = queue.shift();
    const pkgJsonPath = path.join(pkgDir, 'package.json');
    if (!existsSync(pkgJsonPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
    const deps = pkg?.dependencies ?? {};
    for (const [depName, spec] of Object.entries(deps)) {
      if (resolved.has(depName)) continue;
      if (!String(spec).startsWith('workspace:') && !depName.startsWith('@torveai/')) continue;
      const shortName = depName.startsWith('@torveai/') ? depName.slice('@torveai/'.length) : depName;
      const candidateDir = path.resolve(repoRoot, 'packages', shortName);
      if (existsSync(path.join(candidateDir, 'package.json'))) {
        resolved.set(depName, candidateDir);
        queue.push([depName, candidateDir]);
      }
    }
  }

  return Object.fromEntries(resolved.entries());
}

const WORKSPACE_PACKAGES = collectTransitiveWorkspacePackages();

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
  readFileSync(path.resolve(repoRoot, 'node_modules', 'electron', 'package.json'), 'utf8'),
);
const electronVersion = electronPkg.version;
const betterSqlite3Dir = path.resolve(repoRoot, 'node_modules', 'better-sqlite3');

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
