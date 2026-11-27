/**
 * Build hardening & Electron Fuses hook.
 *
 * Dual-mode script:
 *  1. CLI (`--prepack`): strips any stray `.map` / `.d.ts` files from `dist/` and
 *     `cli-dist/` and minifies/strips comments from compiled JS/CJS files in
 *     `dist/` (excluding `dist/renderer/`, which Vite already minifies) BEFORE
 *     `electron-builder` packs `app.asar`.
 *  2. `electron-builder` `afterPack` hook:
 *     - Scans `resources/app.asar` (read-only) and fails loudly if any `.map`
 *       file slipped in (must NOT mutate `app.asar` after its integrity hash
 *       was embedded).
 *     - Strips any `.map` files from extraResources (`bundled-runtime`,
 *       `bundled-plugins`, `cli-dist`) outside `app.asar`.
 *     - Flips `@electron/fuses` on the packaged Electron binary before macOS
 *       ad-hoc signing / Linux sandbox chmod in `./after-pack.js`.
 */

import { flipFuses, FuseV1Options, FuseVersion } from '@electron/fuses';
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import baseAfterPack from './after-pack.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultDesktopDir = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const STRIP_SUFFIXES = ['.map', '.d.ts', '.d.mts', '.d.cts'];
const MINIFY_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);

function shouldStripArtifact(fileName) {
  const lower = fileName.toLowerCase();
  return STRIP_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

function walkDirectory(dir, onFile, skipDir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skipDir && skipDir(fullPath)) continue;
      walkDirectory(fullPath, onFile, skipDir);
    } else if (entry.isFile()) {
      onFile(fullPath, entry.name);
    }
  }
}

export function stripArtifactsInDirs(dirs, { mapsOnly = false } = {}) {
  let removed = 0;
  for (const dir of dirs) {
    walkDirectory(dir, (fullPath, fileName) => {
      const match = mapsOnly
        ? fileName.toLowerCase().endsWith('.map')
        : shouldStripArtifact(fileName);
      if (match) {
        rmSync(fullPath, { force: true });
        removed += 1;
      }
    });
  }
  return removed;
}

export function minifyCompiledMain(distDir) {
  if (!existsSync(distDir)) return 0;
  const esbuild = require('esbuild');
  const rendererDir = path.resolve(distDir, 'renderer');
  let minified = 0;

  walkDirectory(
    distDir,
    (fullPath, fileName) => {
      const ext = path.extname(fileName).toLowerCase();
      if (!MINIFY_EXTENSIONS.has(ext)) return;
      const source = readFileSync(fullPath, 'utf8');
      // Omit `format` so esbuild preserves ESM (`import`/`import.meta.url`) and
      // CJS (`require`/`module.exports`) module syntax verbatim.
      const result = esbuild.transformSync(source, {
        loader: 'js',
        target: 'node22',
        minify: true,
        legalComments: 'none',
        sourcemap: false,
      });
      writeFileSync(fullPath, result.code, 'utf8');
      minified += 1;
    },
    (dirPath) => path.resolve(dirPath) === rendererDir,
  );

  return minified;
}

export function hardenPrepack(desktopDir = defaultDesktopDir) {
  const distDir = path.join(desktopDir, 'dist');
  const cliDistDir = path.join(desktopDir, 'cli-dist');

  const removed = stripArtifactsInDirs([distDir, cliDistDir]);
  const minified = minifyCompiledMain(distDir);

  console.log(
    `[harden:prepack] Removed ${removed} sourcemap/declaration file(s); minified ${minified} JS/CJS file(s) in dist/.`,
  );
  return { removed, minified };
}

function readAsarFilesViaHeader(asarPath) {
  const fd = openSync(asarPath, 'r');
  try {
    const sizeBuf = Buffer.alloc(8);
    if (readSync(fd, sizeBuf, 0, 8, 0) !== 8) {
      throw new Error(`[after-pack-harden] Unable to read ASAR header size: ${asarPath}`);
    }
    const headerSize = sizeBuf.readUInt32LE(4);
    const headerBuf = Buffer.alloc(headerSize);
    if (readSync(fd, headerBuf, 0, headerSize, 8) !== headerSize) {
      throw new Error(`[after-pack-harden] Unable to read ASAR header: ${asarPath}`);
    }
    const jsonLen = headerBuf.readUInt32LE(4);
    const header = JSON.parse(headerBuf.subarray(8, 8 + jsonLen).toString('utf8'));
    const entries = [];
    const walk = (node, prefix) => {
      if (!node || typeof node !== 'object' || !node.files) return;
      for (const [name, child] of Object.entries(node.files)) {
        const rel = prefix ? `${prefix}/${name}` : `/${name}`;
        if (child && typeof child === 'object' && child.files) {
          walk(child, rel);
        } else {
          entries.push(rel);
        }
      }
    };
    walk(header, '');
    return entries;
  } finally {
    closeSync(fd);
  }
}

export function listAsarEntries(asarPath) {
  try {
    const asar = require('@electron/asar');
    if (typeof asar.listPackage === 'function') {
      return asar.listPackage(asarPath, { isPack: false });
    }
  } catch {
    // Fall back to direct ASAR pickle header parsing when @electron/asar is not hoisted.
  }
  return readAsarFilesViaHeader(asarPath);
}

export function assertNoSourceMapsInAsar(asarPath) {
  if (!existsSync(asarPath)) {
    throw new Error(`[after-pack-harden] Expected ASAR archive missing: ${asarPath}`);
  }
  const entries = listAsarEntries(asarPath);
  const mapFiles = entries.filter((entry) => entry.toLowerCase().endsWith('.map'));
  if (mapFiles.length > 0) {
    const sample = mapFiles.slice(0, 10).join(', ');
    throw new Error(
      `[after-pack-harden] Found ${mapFiles.length} sourcemap file(s) inside ${asarPath}: ${sample}`,
    );
  }
  console.log(`[after-pack-harden] Verified 0 .map files in ${asarPath} (${entries.length} entries scanned).`);
}

function resolveResourcesDir(context) {
  if (typeof context.packager?.getResourcesDir === 'function') {
    return context.packager.getResourcesDir(context.appOutDir);
  }
  if (context.electronPlatformName === 'darwin') {
    return path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      'Contents',
      'Resources',
    );
  }
  return path.join(context.appOutDir, 'resources');
}

export function resolveElectronBinaryPath(context) {
  const filename = context.packager.appInfo.productFilename;
  switch (context.electronPlatformName) {
    case 'win32':
      return path.join(context.appOutDir, `${filename}.exe`);
    case 'darwin':
      return path.join(context.appOutDir, `${filename}.app`);
    case 'linux':
      return path.join(context.appOutDir, context.packager.executableName ?? filename);
    default:
      throw new Error(`[after-pack-harden] Unsupported platform: ${context.electronPlatformName}`);
  }
}

export default async function afterPack(context) {
  const resourcesDir = resolveResourcesDir(context);
  const appAsarPath = path.join(resourcesDir, 'app.asar');

  // 1. Verify app.asar contains zero .map files (read-only; never mutate post-hash).
  assertNoSourceMapsInAsar(appAsarPath);

  // Strip any .map files from unpacked extraResources outside app.asar.
  const extraRemoved = stripArtifactsInDirs(
    [
      path.join(resourcesDir, 'bundled-runtime'),
      path.join(resourcesDir, 'bundled-plugins'),
      path.join(resourcesDir, 'cli-dist'),
    ],
    { mapsOnly: true },
  );
  if (extraRemoved > 0) {
    console.log(`[after-pack-harden] Removed ${extraRemoved} .map file(s) from extraResources.`);
  }

  // 2. Flip Electron fuses BEFORE macOS ad-hoc codesign / Linux chmod in after-pack.js.
  const electronBinaryPath = resolveElectronBinaryPath(context);
  console.log(`[after-pack-harden] Flipping Electron fuses on ${electronBinaryPath}`);
  const flipped = await flipFuses(electronBinaryPath, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });
  console.log(`[after-pack-harden] Flipped Electron fuses (${flipped} sentinel(s)).`);

  // 3. Run existing platform after-pack logic (Linux chrome-sandbox chmod, macOS ad-hoc codesign).
  await baseAfterPack(context);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  if (process.argv.includes('--prepack')) {
    hardenPrepack();
  } else {
    console.error('Usage: node scripts/after-pack-harden.mjs --prepack');
    process.exitCode = 1;
  }
}
