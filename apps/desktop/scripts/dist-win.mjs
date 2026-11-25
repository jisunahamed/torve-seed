import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const env = { ...process.env };
const hasCert = Boolean(env['CSC_LINK'] || (env['WIN_SIGN_EMAIL'] && env['WIN_SIGN_OTP']));
const userArgs = process.argv.slice(2);
const hasPublishFlag = userArgs.some((arg) => arg === '--publish' || arg === '-p' || arg.startsWith('--publish='));
const args = ['--win', ...(hasPublishFlag ? [] : ['--publish', 'never']), ...userArgs];

if (!hasCert && env['CSC_IDENTITY_AUTO_DISCOVERY'] === undefined) {
  env['CSC_IDENTITY_AUTO_DISCOVERY'] = 'false';
}

// Local Windows machines without Developer Mode fail extracting macOS symlinks
// inside electron-builder's winCodeSign archive during unsigned builds.
// On CI runners (or when signing credentials are present), keep resource
// editing and signing enabled so PE metadata and icons are embedded in release builds.
if (!hasCert && !env['CI'] && !env['GITHUB_ACTIONS']) {
  args.push('-c.win.signAndEditExecutable=false');
}

execFileSync(
  process.execPath,
  [require.resolve('electron-builder/cli.js'), ...args],
  { cwd: desktopDir, env, stdio: 'inherit' },
);
