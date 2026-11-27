import test from 'node:test';
import assert from 'node:assert/strict';

import path from 'node:path';
import { homedir } from 'node:os';

import { DEFAULT_APP_PROFILES, mergeWithDefaultAppProfiles, platformConfigPath } from './defaults.js';

function names(profiles: readonly unknown[]): string[] {
  return profiles.map((profile) => (profile as Record<string, unknown>)['name'] as string);
}

const DEFAULT_NAMES = ['antigravity', 'codex', 'opencode', 'claude-desktop', 'claude-code', 'gemini-cli'];

test('default app profiles are config-patch entries with exact display names', () => {
  assert.deepEqual(names(DEFAULT_APP_PROFILES), DEFAULT_NAMES);
  assert.deepEqual(
    DEFAULT_APP_PROFILES.map((profile) => [profile['name'], profile['displayName']]),
    [
      ['antigravity', 'Google Antigravity'],
      ['codex', 'Codex'],
      ['opencode', 'OpenCode'],
      ['claude-desktop', 'Claude Desktop'],
      ['claude-code', 'Claude Code CLI'],
      ['gemini-cli', 'Gemini CLI'],
    ],
  );
  for (const profile of DEFAULT_APP_PROFILES) {
    assert.equal(profile['kind'], 'config-patch');
    const patch = profile['configPatch'] as Record<string, unknown>;
    assert.equal(typeof patch['configPath'], 'string');
    if (!['gemini-cli', 'antigravity-ide', 'claude-desktop'].includes(patch['format'] as string)) {
      assert.equal(typeof patch['providerKey'], 'string');
    }
    const portPlaceholder = patch['format'] === 'claude-desktop' ? '{claudeGatewayPort}' : '{buyerPort}';
    assert.ok((patch['baseURL'] as string).includes(portPlaceholder));
    const slugs = profile['toolSlugs'] as string[];
    assert.ok(Array.isArray(slugs) && slugs.length > 0);
  }
});

test('Claude Desktop patches the third-party profile and opens Claude on connect', () => {
  const profile = DEFAULT_APP_PROFILES.find((entry) => entry['name'] === 'claude-desktop');
  assert.ok(profile);
  // 'open-tool' launches Claude after connect even when it was not running;
  // restartAppName doubles as the restart target and the launch fallback.
  assert.equal(profile['appAction'], 'open-tool');
  assert.equal(profile['restartAppName'], 'Claude');
  const patch = profile['configPatch'] as Record<string, unknown>;
  assert.equal(patch['format'], 'claude-desktop');
  assert.equal(typeof patch['thirdPartyDir'], 'string');
});

test('Claude Code CLI configures claude-code format and distinct conversation source', () => {
  const claudeCode = DEFAULT_APP_PROFILES.find((entry) => entry['name'] === 'claude-code');
  assert.deepEqual(claudeCode?.['toolSlugs'], ['claude-code']);
  assert.deepEqual(claudeCode?.['configPatch'], {
    format: 'claude-code',
    configPath: '~/.claude/settings.json',
    providerKey: 'torve',
    baseURL: 'http://localhost:{buyerPort}',
    installProbe: 'claude',
  });
});

test('platformConfigPath keeps the posix path off Windows and for home-rooted tools', () => {
  const winFolder = { base: 'APPDATA', segments: ['Zed', 'settings.json'] } as const;
  assert.equal(platformConfigPath('~/.config/zed/settings.json', winFolder, 'darwin'), '~/.config/zed/settings.json');
  assert.equal(platformConfigPath('~/.config/zed/settings.json', winFolder, 'linux'), '~/.config/zed/settings.json');
  // Home-rooted tools pass no Windows folder — same path everywhere.
  assert.equal(platformConfigPath('~/.codex/config.toml', null, 'win32'), '~/.codex/config.toml');
});

test('platformConfigPath resolves Windows known folders from the environment', () => {
  const env = { APPDATA: 'C:\\Users\\jo\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\jo\\AppData\\Local' };
  assert.equal(
    platformConfigPath('~/.config/zed/settings.json', { base: 'APPDATA', segments: ['Zed', 'settings.json'] }, 'win32', env),
    path.join('C:\\Users\\jo\\AppData\\Roaming', 'Zed', 'settings.json'),
  );
  assert.equal(
    platformConfigPath('~/.config/crush/crush.json', { base: 'LOCALAPPDATA', segments: ['crush', 'crush.json'] }, 'win32', env),
    path.join('C:\\Users\\jo\\AppData\\Local', 'crush', 'crush.json'),
  );
});

test('platformConfigPath falls back to the conventional folder when the env var is unset', () => {
  assert.equal(
    platformConfigPath('~/.config/goose/config.yaml', { base: 'APPDATA', segments: ['Block', 'goose', 'config', 'config.yaml'] }, 'win32', {}),
    path.join(homedir(), 'AppData', 'Roaming', 'Block', 'goose', 'config', 'config.yaml'),
  );
});

test('mergeWithDefaultAppProfiles returns the defaults when no external profiles are configured', () => {
  assert.deepEqual(names(mergeWithDefaultAppProfiles([])), DEFAULT_NAMES);
});

test('mergeWithDefaultAppProfiles lets external profiles override same-name defaults and keep their order', () => {
  const external = [
    { name: 'acme', displayName: 'Acme Desktop' },
    { name: 'opencode', displayName: 'OpenCode (private override)' },
  ];
  const merged = mergeWithDefaultAppProfiles(external);
  assert.deepEqual(names(merged), ['acme', 'opencode', 'antigravity', 'codex', 'claude-desktop', 'claude-code', 'gemini-cli']);
  assert.equal((merged[1] as Record<string, unknown>)['displayName'], 'OpenCode (private override)');
});
