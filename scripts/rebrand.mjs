#!/usr/bin/env node
/**
 * Mechanical rebrand codemod: Torve → Torve
 * - Skips .git, node_modules, dist, build, .pnpm-store, release, LICENSE, pnpm-lock.yaml, bun.lockb, binary assets
 * - Ordered replacements (longest first), case-sensitive string replace
 * - Preserves INTERNAL_APP_NAME = "AntStation Desktop" in apps/desktop/src/main/app-context.ts
 * - Keeps CLI bin alias { torve, torve } both pointing to same entry
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'release', 'bundled-runtime', 'cli-dist', '.pnpm-store', '.codex-tmp-authfix', 'anomalyco-opencode', 'torvecode', 'torvecode-go-backup']);
// Note: we also skip any path segment that equals these, plus hidden coverage
const SKIP_FILE_EXACT = new Set(['LICENSE', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock']);
const SKIP_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.tar', '.gz', '.node', '.wasm', '.mp4', '.mov', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.lockb', '.ansi']);

// Ordered longest-first, case-sensitive string replacements.
// Do NOT use regex — plain split/join so we don't mis-handle domains.
const REPLACEMENTS = [
  ['hello@torveai.com', 'hello@torveai.com'],
  ['hello@torveai.com', 'hello@torveai.com'],
  ['com.torveai.desktop', 'com.torveai.desktop'],
  ['https://torveai.com', 'https://torveai.com'],
  ['http://torveai.com', 'http://torveai.com'],
  ['https://docs.torveai.com', 'https://docs.torveai.com'],
  // generic domain must come before generic torve → torve
  ['torveai.com', 'torveai.com'],
  ['Torve VPR', 'Torve VPR'],
  ['TORVE_', 'TORVE_'],
  ['@torveai/', '@torveai/'],
  // preserve case variants
  ['Torve', 'Torve'],
  ['Torve', 'Torve'],
  ['TORVE', 'TORVE'],
  ['torve', 'torve'],
];

let filesScanned = 0;
let filesChanged = 0;
let totalReplacements = 0;
const changedFiles = [];
const skippedBinary = [];

function shouldSkipDir(name) {
  return SKIP_DIRS.has(name);
}

function shouldSkipFile(filePath) {
  const base = path.basename(filePath);
  if (SKIP_FILE_EXACT.has(base)) return `exact:${base}`;
  // LICENSE without extension or LICENSE.md
  if (base === 'LICENSE' || base.startsWith('LICENSE.')) return 'LICENSE';
  const ext = path.extname(base).toLowerCase();
  if (SKIP_EXTS.has(ext)) return `ext:${ext}`;
  if (base === 'pnpm-lock.yaml') return 'lock';
  return null;
}

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    // skip .git etc at any depth
    if (ent.isDirectory()) {
      if (shouldSkipDir(ent.name)) continue;
      // also skip any hidden .git inside
      if (ent.name === '.git') continue;
      walk(full, out);
    } else if (ent.isFile()) {
      const skipReason = shouldSkipFile(full);
      if (skipReason) {
        skippedBinary.push(`${path.relative(ROOT, full)} (${skipReason})`);
        continue;
      }
      // also skip any file inside node_modules/dist already handled by dir skip,
      // but double-check path contains those segments
      const rel = path.relative(ROOT, full).replace(/\\/g, '/');
      if (rel.includes('node_modules/') || rel.includes('/dist/') || rel.startsWith('dist/') || rel.includes('/build/') || rel.includes('.pnpm-store')) {
        continue;
      }
      out.push(full);
    }
  }
}

const allFiles = [];
walk(ROOT, allFiles);

for (const file of allFiles) {
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    skippedBinary.push(`${path.relative(ROOT, file)} (read failed)`);
    continue;
  }
  // heuristic binary check: null byte
  if (content.includes('\0')) {
    skippedBinary.push(`${path.relative(ROOT, file)} (null byte)`);
    continue;
  }
  filesScanned++;
  let next = content;
  let fileReplacements = 0;
  for (const [from, to] of REPLACEMENTS) {
    if (next.includes(from)) {
      const count = next.split(from).length - 1;
      next = next.split(from).join(to);
      fileReplacements += count;
    }
  }
  // Preserve INTERNAL_APP_NAME = "AntStation Desktop" in app-context.ts
  // Our replacements shouldn't have touched "AntStation" but be safe:
  if (file.endsWith(path.join('apps', 'desktop', 'src', 'main', 'app-context.ts'))) {
    // Restore if we accidentally changed it (e.g. future broader replacement)
    if (next.includes('TorStation Desktop')) {
      next = next.split('TorStation Desktop').join('AntStation Desktop');
    }
    // Also ensure the env var line DESKTOP_DEBUG_ENV is TORVE_ (intended) — no revert
    // Keep INTERNAL_APP_NAME exactly
    next = next.replace(/INTERNAL_APP_NAME\s*=\s*['"][^'"]*['"]/, `INTERNAL_APP_NAME = 'AntStation Desktop'`);
  }

  if (next !== content) {
    fs.writeFileSync(file, next, 'utf8');
    filesChanged++;
    totalReplacements += fileReplacements;
    changedFiles.push({ file: path.relative(ROOT, file).replace(/\\/g, '/'), count: fileReplacements });
  }
}

// Post-fix: keep CLI bin alias { torve, torve } if trivial
const cliPkgPath = path.join(ROOT, 'apps', 'cli', 'package.json');
try {
  const raw = fs.readFileSync(cliPkgPath, 'utf8');
  const pkg = JSON.parse(raw);
  if (pkg.bin) {
    const bins = pkg.bin;
    // After codemod, bins likely is { torve: "./dist/cli/index.js" }
    // Ensure both exist pointing to same target
    const target = bins['torve'] || bins['torve'] || './dist/cli/index.js';
    const hasTorve = 'torve' in bins;
    const hasTorve = 'torve' in bins;
    if (!hasTorve || !hasTorve) {
      bins['torve'] = target;
      bins['torve'] = target;
      // sort keys for stability: torve first then torve alias
      const ordered = {};
      ordered['torve'] = bins['torve'];
      ordered['torve'] = bins['torve'];
      pkg.bin = ordered;
      fs.writeFileSync(cliPkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
      console.log('[rebrand] Ensured CLI bin alias: torve + torve →', target);
    }
  }
} catch (e) {
  console.warn('[rebrand] CLI bin alias fix failed:', String(e));
}

console.log(`\n[rebrand] Scanned ${filesScanned} files, changed ${filesChanged} files, ${totalReplacements} replacements.`);
if (changedFiles.length) {
  // sort by count desc
  changedFiles.sort((a, b) => b.count - a.count);
  console.log(`[rebrand] Top changed files (up to 80):`);
  for (const { file, count } of changedFiles.slice(0, 80)) {
    console.log(`  ${String(count).padStart(4)}  ${file}`);
  }
  if (changedFiles.length > 80) console.log(`  ... and ${changedFiles.length - 80} more`);
}
if (skippedBinary.length) {
  console.log(`\n[rebrand] Skipped ${skippedBinary.length} binary/locked files (showing up to 20):`);
  for (const s of skippedBinary.slice(0, 20)) console.log(`  - ${s}`);
}
