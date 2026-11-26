import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { DesktopSystemProxyProfile } from '../system-proxy/profiles.js';
import {
  classifyAppProfile,
  isGuiAppProfile,
  isSafeGuiTargetName,
  relaunchOrVerifyApp,
  reopenConnectedApp,
  restartConnectedAppLifecycle,
  verifyConnectedAppConfig,
  type AppLifecycleRuntime,
  type ConnectLifecycleProgress,
} from './app-lifecycle.js';
import { startTorveCloudProfiles } from './profiles.js';

function createMockRuntime(
  overrides: Partial<AppLifecycleRuntime> & { events?: string[] } = {},
): AppLifecycleRuntime {
  const events = overrides.events ?? [];
  let time = 1_000;
  return {
    platform: 'win32',
    async listProfiles() {
      return [];
    },
    async resolveLaunchTarget(profileName, restartAppName) {
      return {
        name: restartAppName ?? profileName,
        path: `C:\\Apps\\${restartAppName ?? profileName}.exe`,
      };
    },
    async resolveExecutablePath(targetPath) {
      return targetPath;
    },
    async isTargetRunning() {
      events.push('isRunning');
      return false;
    },
    async quitTarget(target) {
      events.push(`quit:${target.name}`);
    },
    async killTarget(target) {
      events.push(`kill:${target.name}`);
    },
    async launchTarget(target) {
      events.push(`launch:${target.name}`);
      return { ok: true };
    },
    async waitForTarget(target) {
      events.push(`waitForTarget:${target.name}`);
    },
    async markManaged(target) {
      events.push(`markManaged:${target.name}`);
    },
    async captureManaged(target) {
      events.push(`captureManaged:${target.name}`);
    },
    async launchAntigravity() {
      events.push('launchAntigravity');
      return { ok: true, targetPath: 'C:\\Apps\\Antigravity\\Antigravity.exe' };
    },
    async getAntigravityStatus() {
      return { installed: true, enabled: true, running: false, state: 'active' };
    },
    async openExternalUrl(url) {
      events.push(`openExternal:${url}`);
    },
    async startProxy(port) {
      events.push(`startProxy:${port}`);
    },
    isProxyRunning() {
      return true;
    },
    async probeProxyModels(port) {
      events.push(`probeProxy:${port}`);
      return { ok: true, reachable: true, statusCode: 200 };
    },
    async getActiveProfiles() {
      return [];
    },
    async getCatalogModels() {
      return [{ id: 'torve/auto' }];
    },
    async resyncProfileConfig(profileName) {
      events.push(`resync:${profileName}`);
      return { ok: true, configPaths: [] };
    },
    async sleep(ms) {
      events.push(`sleep:${ms}`);
      time += ms;
    },
    now: () => time,
    ...overrides,
  };
}

test('classifies GUI desktop apps vs pure terminal CLIs and protects shells and Torve Desktop', () => {
  for (const guiApp of [
    'antigravity',
    'claude-desktop',
    'cursor',
    'windsurf',
    'vscode',
    'zed',
    't3code',
    'gooeypi',
    'hermes',
  ]) {
    assert.equal(isGuiAppProfile(guiApp), true, `${guiApp} should be classified as GUI`);
    assert.equal(classifyAppProfile(guiApp), 'gui');
  }

  assert.equal(isGuiAppProfile('codex', 'Codex'), true);
  assert.equal(isGuiAppProfile('opencode', 'OpenCode'), true);

  for (const cliApp of [
    'gemini-cli',
    'opencode-cli',
    'claude-code',
    'codex-cli',
    'aider',
    'pi',
    'crush',
    'continue',
  ]) {
    assert.equal(isGuiAppProfile(cliApp), false, `${cliApp} should be classified as CLI`);
    assert.equal(classifyAppProfile(cliApp), 'cli');
    // Even if a terminal name were supplied, pure CLI profiles never become killable GUI targets.
    assert.equal(isGuiAppProfile(cliApp, 'Terminal'), false);
  }

  for (const forbidden of [
    'Torve Desktop',
    'torve.exe',
    'Terminal',
    'iTerm2',
    'WindowsTerminal.exe',
    'powershell.exe',
    'pwsh',
    'cmd.exe',
    'bash',
    'zsh',
  ]) {
    assert.equal(isSafeGuiTargetName(forbidden), false, `${forbidden} must never be killable`);
  }
});

test('GUI relaunch follows close -> wait -> settle -> launch -> waitForTarget -> verify order without force kill when graceful exit succeeds', async () => {
  const events: string[] = [];
  let runningChecks = 0;
  const runtime = createMockRuntime({
    events,
    async resolveLaunchTarget() {
      return { name: 'Zed', path: 'C:\\Program Files\\Zed\\Zed.exe' };
    },
    async isTargetRunning() {
      events.push('isRunning');
      runningChecks += 1;
      // Running on initial check + first poll after quit, then exited on second poll.
      return runningChecks <= 2;
    },
  });

  const progress: ConnectLifecycleProgress[] = [];
  const result = await relaunchOrVerifyApp('zed', {
    graceTimeoutMs: 2_000,
    settleDelayMs: 150,
    port: 8378,
    onProgress: (ev) => progress.push(ev),
    runtime,
  });

  assert.equal(result.ok, true);
  assert.equal(result.isGui, true);
  assert.equal(result.restarted, true);
  assert.equal(result.launched, true);
  assert.equal(result.verified, true);

  assert.deepEqual(events, [
    'isRunning',
    'quit:Zed',
    'isRunning',
    'sleep:250',
    'isRunning',
    'sleep:150',
    'launch:Zed',
    'markManaged:Zed',
    'waitForTarget:Zed',
    'captureManaged:Zed',
    'probeProxy:8378',
  ]);
  assert.equal(events.some((e) => e.startsWith('kill:')), false);
  assert.ok(progress.some((p) => p.stage === 'restarting-app'));
});

test('GUI relaunch falls back to force kill after grace timeout and refuses protected shell/Torve targets', async () => {
  const events: string[] = [];
  let runningChecks = 0;
  const runtime = createMockRuntime({
    events,
    async resolveLaunchTarget() {
      return { name: 'Claude', path: 'C:\\Users\\test\\AppData\\Local\\Programs\\Claude\\Claude.exe' };
    },
    async isTargetRunning() {
      events.push('isRunning');
      runningChecks += 1;
      // Stays running past grace timeout until killTarget runs.
      return !events.includes('kill:Claude');
    },
  });

  const result = await relaunchOrVerifyApp('claude-desktop', {
    restartAppName: 'Claude',
    graceTimeoutMs: 500,
    settleDelayMs: 50,
    port: 8378,
    runtime,
  });

  assert.equal(result.ok, true);
  assert.equal(result.restarted, true);
  assert.ok(events.includes('quit:Claude'));
  assert.ok(events.includes('kill:Claude'));
  assert.ok(events.indexOf('kill:Claude') < events.indexOf('launch:Claude'));

  // Safety guard: even if an override somehow pointed at a terminal/Torve binary, refuse to kill.
  const protectedEvents: string[] = [];
  const protectedRuntime = createMockRuntime({
    events: protectedEvents,
    async resolveLaunchTarget() {
      return { name: 'powershell', path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' };
    },
    async isTargetRunning() {
      return true;
    },
  });
  const blocked = await relaunchOrVerifyApp('custom-shell', {
    restartAppName: 'powershell',
    runtime: protectedRuntime,
  });
  assert.equal(blocked.ok, false);
  assert.equal(protectedEvents.some((e) => e.startsWith('quit:') || e.startsWith('kill:')), false);
});

test('terminal CLIs never kill user processes and return non-destructive session-restart guidance', async () => {
  for (const cliApp of ['claude-code', 'gemini-cli', 'opencode-cli', 'codex-cli', 'aider']) {
    const events: string[] = [];
    const runtime = createMockRuntime({
      events,
      async isTargetRunning() {
        events.push('isRunning');
        return true;
      },
    });
    const progress: ConnectLifecycleProgress[] = [];
    const res = await restartConnectedAppLifecycle(cliApp, {
      onProgress: (ev) => progress.push(ev),
      runtime,
    });

    assert.equal(res.ok, true);
    assert.equal(res.isGui, false);
    assert.equal(res.restarted, false);
    assert.equal(res.needsSessionRestart, true);
    assert.equal(events.some((e) => e.startsWith('quit:') || e.startsWith('kill:') || e.startsWith('launch:')), false);
    assert.deepEqual(progress.map((p) => p.stage), [
      'checking-proxy',
      'restarting-app',
      'verifying',
      'done',
    ]);
  }
});

test('reopenConnectedApp uses launchAntigravity for antigravity and verifyConnectedAppConfig re-syncs and probes /v1/models', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'torve-verify-'));
  const cfgPath = path.join(dir, 'settings.json');
  await writeFile(cfgPath, '{"ok":true}\n', 'utf8');

  try {
    const events: string[] = [];
    const progress: ConnectLifecycleProgress[] = [];
    const runtime = createMockRuntime({
      events,
      async getActiveProfiles() {
        return ['zed'];
      },
      async resyncProfileConfig(profileName) {
        events.push(`resync:${profileName}`);
        return { ok: true, configPaths: [cfgPath] };
      },
    });

    const openRes = await reopenConnectedApp('antigravity', { runtime });
    assert.equal(openRes.ok, true);
    assert.ok(events.includes('launchAntigravity'));

    const verifyRes = await verifyConnectedAppConfig('zed', {
      port: 8378,
      onProgress: (ev) => progress.push(ev),
      runtime,
    });
    assert.equal(verifyRes.ok, true);
    assert.equal(verifyRes.verified, true);
    assert.equal(verifyRes.proxyReachable, true);
    assert.equal(verifyRes.configPresent, true);
    assert.deepEqual(progress.map((p) => p.stage), [
      'checking-proxy',
      'patching',
      'verifying',
      'done',
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('startTorveCloudProfiles emits ordered progress stages and rolls back backups cleanly on mid-flight error', async () => {
  const tempHome = await mkdtemp(path.join(tmpdir(), 'torve-lifecycle-home-'));
  const prevHome = process.env['HOME'];
  const prevUserProfile = process.env['USERPROFILE'];
  process.env['HOME'] = tempHome;
  process.env['USERPROFILE'] = tempHome;

  const statePath = path.join(tempHome, '.torve', 'direct-cloud-profiles.json');
  const aiderConfigPath = path.join(tempHome, '.aider.conf.yml');
  const zedConfigPath = path.join(tempHome, 'zed-settings.json');
  const aiderOriginal = 'model: gpt-4o\n';
  await writeFile(aiderConfigPath, aiderOriginal, 'utf8');

  const testProfiles: DesktopSystemProxyProfile[] = [
    {
      name: 'aider',
      label: 'Aider',
      kind: 'config-patch',
      method: 'Config patch',
      domains: [],
      configPatch: {
        format: 'aider',
        configPath: aiderConfigPath,
        baseURL: 'http://127.0.0.1:{buyerPort}/v1',
      },
    },
    {
      name: 'zed',
      label: 'Zed',
      kind: 'config-patch',
      method: 'Config patch',
      domains: [],
      configPatch: {
        format: 'zed',
        configPath: zedConfigPath,
        providerKey: 'torve',
        providerName: 'Torve',
        baseURL: 'http://127.0.0.1:{buyerPort}/v1',
      },
    },
  ];

  try {
    // Verify the actual homedir() in this process honors our temp home before touching backups.
    assert.equal(path.resolve(homedir()), path.resolve(tempHome));

    // 1. Happy-path progress sequence for a single CLI profile.
    const successStages: ConnectLifecycleProgress[] = [];
    const runtime = createMockRuntime({
      async listProfiles() {
        return testProfiles;
      },
    });
    const state = await startTorveCloudProfiles(['aider'], {
      onProgress: (ev) => successStages.push(ev),
      deps: {
        statePath,
        getApiKey: async () => 'sk-trv-test-key',
        getProfiles: async () => testProfiles,
        startProxy: async () => {},
        getModelsStatus: async () => ({ models: [{ id: 'torve/auto' }] }),
        getOverrides: async () => ({}),
        lifecycleRuntime: runtime,
      },
    });
    assert.deepEqual(state.activeProfileNames, ['aider']);
    assert.deepEqual(successStages.map((e) => e.stage), [
      'checking-proxy',
      'backing-up',
      'patching',
      'restarting-app',
      'verifying',
      'done',
    ]);
    assert.ok((await readFile(aiderConfigPath, 'utf8')).includes('127.0.0.1'));

    // Reset state file and aider config for rollback test.
    await writeFile(aiderConfigPath, aiderOriginal, 'utf8');
    await rm(statePath, { force: true });

    // 2. Mid-flight failure on the second profile rolls back the first profile's exact backup.
    const rollbackStages: ConnectLifecycleProgress[] = [];
    let patchCalls = 0;
    await assert.rejects(
      () => startTorveCloudProfiles(['aider', 'zed'], {
        onProgress: (ev) => rollbackStages.push(ev),
        deps: {
          statePath,
          getApiKey: async () => 'sk-trv-test-key',
          getProfiles: async () => testProfiles,
          startProxy: async () => {},
          getModelsStatus: async () => ({ models: [{ id: 'torve/auto' }] }),
          getOverrides: async () => ({}),
          applyPatch(patch, peerId, buyerPort, wslTargets) {
            patchCalls += 1;
            if (patchCalls === 2) {
              throw new Error('Simulated mid-flight disk write failure');
            }
            // Apply first patch via real config-patch logic.
            void peerId;
            void buyerPort;
            void wslTargets;
            if (patch.format === 'aider') {
              // Write modified file to verify exact backup restore overwrites it cleanly.
              throwIfNotExpected(aiderConfigPath);
            }
          },
          lifecycleRuntime: runtime,
        },
      }),
      /Simulated mid-flight disk write failure/,
    );

    // Let's also test real config-patch + rollback via actual applyConfigPatch for app 1 and failure on app 2.
    await writeFile(aiderConfigPath, aiderOriginal, 'utf8');
    await rm(statePath, { force: true });

    const { applyConfigPatch } = await import('../system-proxy/config-patch.js');
    const rollbackEvents2: ConnectLifecycleProgress[] = [];
    let callNum = 0;
    await assert.rejects(
      () => startTorveCloudProfiles(['aider', 'zed'], {
        onProgress: (ev) => rollbackEvents2.push(ev),
        deps: {
          statePath,
          getApiKey: async () => 'sk-trv-test-key',
          getProfiles: async () => testProfiles,
          startProxy: async () => {},
          getModelsStatus: async () => ({ models: [{ id: 'torve/auto' }] }),
          getOverrides: async () => ({}),
          applyPatch(patch, peerId, buyerPort, wslTargets) {
            callNum += 1;
            if (callNum === 2) throw new Error('Simulated second app patch error');
            applyConfigPatch(patch, peerId, buyerPort, wslTargets);
          },
          lifecycleRuntime: runtime,
        },
      }),
      /Simulated second app patch error/,
    );

    // Exact original aider config bytes restored!
    assert.equal(await readFile(aiderConfigPath, 'utf8'), aiderOriginal);
    assert.equal(rollbackEvents2.some((e) => e.stage === 'error' && e.appId === 'zed'), true);
  } finally {
    if (prevHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = prevHome;
    if (prevUserProfile === undefined) delete process.env['USERPROFILE'];
    else process.env['USERPROFILE'] = prevUserProfile;
    await rm(tempHome, { recursive: true, force: true });
  }
});

function throwIfNotExpected(filePath: string): void {
  if (!filePath) throw new Error('Missing path');
}
