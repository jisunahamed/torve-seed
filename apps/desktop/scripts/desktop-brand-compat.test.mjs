import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Torve Desktop branding and Electron identity remain intact', () => {
  const packageJson = JSON.parse(readFileSync(path.join(desktopDir, 'package.json'), 'utf8'));
  const builderConfig = parse(readFileSync(path.join(desktopDir, 'electron-builder.yml'), 'utf8'));
  const appContext = readFileSync(path.join(desktopDir, 'src/main/app-context.ts'), 'utf8');

  assert.equal(packageJson.productName, 'Torve Desktop');
  assert.equal(builderConfig.productName, 'Torve Desktop');
  assert.equal(builderConfig.appId, 'com.torveai.desktop');
  assert.equal(builderConfig.executableName, 'Torve Desktop');
  assert.equal(builderConfig.win?.icon, 'assets/torve-icon.ico');
  assert.equal(builderConfig.nsis?.artifactName, 'Torve-Desktop-Setup-${version}.${ext}');
  assert.equal(builderConfig.publish?.provider, 'github');
  assert.equal(builderConfig.publish?.owner, 'jisunahamed');
  assert.equal(builderConfig.publish?.repo, 'torve-seed');
  assert.match(appContext, /INTERNAL_APP_NAME = 'AntStation Desktop'/);
});
