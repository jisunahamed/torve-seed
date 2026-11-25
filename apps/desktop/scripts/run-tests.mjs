import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function collectFiles(dir, suffix) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(full, suffix));
    } else if (entry.name.endsWith(suffix)) {
      results.push(full);
    }
  }
  return results.sort();
}

const scriptTests = collectFiles(path.join(desktopDir, 'scripts'), '.test.mjs');
execFileSync(process.execPath, ['--test', ...scriptTests], { cwd: desktopDir, stdio: 'inherit' });

const pnpmCmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
execFileSync(pnpmCmd, ['run', 'build:main'], { cwd: desktopDir, stdio: 'inherit', shell: process.platform === 'win32' });

const mainTests = collectFiles(path.join(desktopDir, 'dist', 'main'), '.test.js');
execFileSync(process.execPath, ['--test', ...mainTests], { cwd: desktopDir, stdio: 'inherit' });

execFileSync(pnpmCmd, ['run', 'test:renderer'], { cwd: desktopDir, stdio: 'inherit', shell: process.platform === 'win32' });
