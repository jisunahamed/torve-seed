import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  FRIENDLY_UPDATE_CHECK_ERROR,
  GITHUB_RELEASES_LIST_URL,
  TORVE_UPDATES_URL,
  TorveUpdater,
  compareSemver,
  selectBestReleaseCandidate,
  selectWindowsExeAsset,
  verifyPeHeader,
} from './updater.js';

test('compareSemver handles v-prefix, newer, equal, older, and prerelease versions', () => {
  assert.equal(compareSemver('0.2.58', '0.2.57'), 1);
  assert.equal(compareSemver('v0.2.58', '0.2.57'), 1);
  assert.equal(compareSemver('v0.2.58', 'v0.2.57'), 1);
  assert.equal(compareSemver('1.0.0', '0.99.99'), 1);
  assert.equal(compareSemver('0.3.0', '0.2.99'), 1);

  assert.equal(compareSemver('0.2.57', '0.2.57'), 0);
  assert.equal(compareSemver('v0.2.57', '0.2.57'), 0);

  assert.equal(compareSemver('0.2.56', '0.2.57'), -1);
  assert.equal(compareSemver('v0.2.56', 'v0.2.57'), -1);
  assert.equal(compareSemver('0.2.58-beta.1', '0.2.58'), -1);
  assert.equal(compareSemver('0.2.58', '0.2.58-beta.1'), 1);
});

test('selectWindowsExeAsset selects Torve-Desktop-Setup-*.exe and ignores other assets', () => {
  const assets = [
    {
      name: 'Torve-Desktop-Setup-0.2.58.exe.blockmap',
      browser_download_url: 'https://example.com/Torve-Desktop-Setup-0.2.58.exe.blockmap',
      size: 1024,
    },
    {
      name: 'Torve-Desktop-0.2.58-arm64.dmg',
      browser_download_url: 'https://example.com/Torve-Desktop-0.2.58-arm64.dmg',
      size: 90000000,
    },
    {
      name: 'Torve-Desktop-Setup-0.2.58.exe',
      browser_download_url: 'https://example.com/Torve-Desktop-Setup-0.2.58.exe',
      size: 85000000,
      digest: 'sha256:abcdef1234',
    },
  ];

  const selected = selectWindowsExeAsset(assets);
  assert.ok(selected);
  assert.equal(selected.name, 'Torve-Desktop-Setup-0.2.58.exe');
  assert.equal(selected.digest, 'sha256:abcdef1234');

  assert.equal(
    selectWindowsExeAsset([
      { name: 'latest.yml', browser_download_url: 'https://example.com/latest.yml' },
    ]),
    null,
  );
  assert.equal(selectWindowsExeAsset(undefined), null);
});

test('selectBestReleaseCandidate picks highest valid semver non-draft release with .exe including prereleases', () => {
  const picked = selectBestReleaseCandidate([
    {
      tag_name: 'v0.2.99-draft',
      draft: true,
      assets: [{ name: 'Torve-Desktop-Setup-0.2.99.exe', browser_download_url: 'https://downloads.example.com/draft.exe' }],
    },
    {
      tag_name: 'v0.2.65-beta.2',
      prerelease: true,
      assets: [{ name: 'Torve-Desktop-Setup-0.2.65-beta.2.exe', browser_download_url: 'https://downloads.example.com/beta2.exe' }],
    },
    {
      tag_name: 'v0.2.64',
      prerelease: false,
      assets: [{ name: 'Torve-Desktop-Setup-0.2.64.exe', browser_download_url: 'https://downloads.example.com/0.2.64.exe' }],
    },
  ]);

  assert.ok(picked);
  assert.equal(picked.version, '0.2.65-beta.2');
  assert.equal(picked.asset?.name, 'Torve-Desktop-Setup-0.2.65-beta.2.exe');
});

test('verifyPeHeader accepts valid MZ header and rejects empty, corrupt, or missing files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'torve-pe-test-'));
  try {
    const validFile = path.join(dir, 'valid.exe');
    await writeFile(validFile, Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]));
    const validResult = await verifyPeHeader(validFile);
    assert.equal(validResult.ok, true);
    assert.equal(validResult.size, 6);

    const emptyFile = path.join(dir, 'empty.exe');
    await writeFile(emptyFile, Buffer.alloc(0));
    const emptyResult = await verifyPeHeader(emptyFile);
    assert.equal(emptyResult.ok, false);

    const corruptFile = path.join(dir, 'corrupt.exe');
    await writeFile(corruptFile, Buffer.from('<!DOCTYPE html><html>not an exe</html>'));
    const corruptResult = await verifyPeHeader(corruptFile);
    assert.equal(corruptResult.ok, false);

    const missingResult = await verifyPeHeader(path.join(dir, 'does-not-exist.exe'));
    assert.equal(missingResult.ok, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('TorveUpdater falls back from Torve updates API to prerelease list, auto-downloads, verifies PE/sha256, and spawns installer', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'torve-updater-flow-'));
  try {
    const exeBytes = Buffer.concat([
      Buffer.from([0x4d, 0x5a, 0x90, 0x00]),
      Buffer.alloc(4096, 0x41),
    ]);
    const sha256 = createHash('sha256').update(exeBytes).digest('hex');

    let spawnedCmd = '';
    let spawnedOpts: Record<string, unknown> | undefined;
    let unrefCalled = false;
    let quitCalled = false;
    const requestedUrls: string[] = [];

    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      requestedUrls.push(url);
      if (url === TORVE_UPDATES_URL) {
        return new Response('Not Found', { status: 404, statusText: 'Not Found' });
      }
      if (url === GITHUB_RELEASES_LIST_URL) {
        return new Response(
          JSON.stringify([
            {
              tag_name: 'v0.2.65-rc.1',
              name: 'Torve Desktop v0.2.65-rc.1',
              prerelease: true,
              assets: [
                {
                  name: 'Torve-Desktop-Setup-0.2.65-rc.1.exe',
                  browser_download_url: 'https://downloads.example.com/Torve-Desktop-Setup-0.2.65-rc.1.exe',
                  size: exeBytes.length,
                  digest: `sha256:${sha256}`,
                },
              ],
            },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      const stream = new ReadableStream({
        start(controller) {
          const mid = Math.floor(exeBytes.length / 2);
          controller.enqueue(exeBytes.subarray(0, mid));
          controller.enqueue(exeBytes.subarray(mid));
          controller.close();
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-length': String(exeBytes.length) },
      });
    };

    const updater = new TorveUpdater({
      currentVersion: '0.2.64',
      tempDir: dir,
      fetchFn: mockFetch,
      spawnFn: (cmd, _args, opts) => {
        spawnedCmd = cmd;
        spawnedOpts = opts as Record<string, unknown>;
        return {
          unref: () => {
            unrefCalled = true;
          },
        };
      },
      onQuit: () => {
        quitCalled = true;
      },
    });

    const observedPhases: string[] = [];
    const observedPercents: number[] = [];
    updater.onStateChange((state) => {
      observedPhases.push(state.phase);
      if (state.phase === 'downloading') {
        observedPercents.push(state.downloadPercent);
      }
    });

    const checkState = await updater.checkForUpdates();
    assert.equal(checkState.phase, 'available');
    assert.equal(checkState.latestVersion, '0.2.65-rc.1');
    assert.equal(checkState.releaseUrl, null);
    assert.deepEqual(requestedUrls.slice(0, 2), [TORVE_UPDATES_URL, GITHUB_RELEASES_LIST_URL]);

    // Auto-download was triggered automatically and deduplicates with explicit downloadUpdate().
    const dlResult = await updater.downloadUpdate();
    assert.equal(dlResult.ok, true);
    assert.ok(dlResult.filePath);
    assert.deepEqual(await readFile(dlResult.filePath), exeBytes);
    assert.equal(updater.getState().phase, 'ready');
    assert.equal(updater.getState().downloadPercent, 100);
    assert.ok(observedPercents.some((p) => p > 0));

    const installResult = await updater.installDownloadedUpdate();
    assert.equal(installResult.ok, true);
    assert.equal(spawnedCmd, dlResult.filePath);
    assert.equal(spawnedOpts?.detached, true);
    assert.equal(unrefCalled, true);

    await new Promise((r) => setTimeout(r, 200));
    assert.equal(quitCalled, true);
    assert.ok(observedPhases.includes('available'));
    assert.ok(observedPhases.includes('downloading'));
    assert.ok(observedPhases.includes('ready'));
    assert.ok(observedPhases.includes('installing'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('TorveUpdater uses friendly Torve error messages without GitHub/404/URLs and handles up-to-date and PE checks', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'torve-updater-silent-'));
  try {
    // 1. Offline silent check must not transition phase to 'error', and manual check shows Torve-branded friendly error
    const offlineUpdater = new TorveUpdater({
      currentVersion: '0.2.64',
      tempDir: dir,
      fetchFn: async () => {
        throw new Error('ENOTFOUND api.github.com 404 Not Found https://api.github.com');
      },
    });
    const silentRes = await offlineUpdater.checkForUpdates({ silent: true });
    assert.equal(silentRes.phase, 'idle');
    assert.ok(typeof silentRes.lastCheckedAt === 'number');
    assert.equal(silentRes.error, FRIENDLY_UPDATE_CHECK_ERROR);
    assert.doesNotMatch(silentRes.error ?? '', /github|404|http/i);

    const manualRes = await offlineUpdater.checkForUpdates({ silent: false });
    assert.equal(manualRes.phase, 'error');
    assert.equal(manualRes.error, FRIENDLY_UPDATE_CHECK_ERROR);
    assert.doesNotMatch(manualRes.error ?? '', /github|404|http/i);

    // 2. Up-to-date check when highest published <= currentVersion
    const upToDateUpdater = new TorveUpdater({
      currentVersion: '0.2.64',
      tempDir: dir,
      fetchFn: async () =>
        new Response(
          JSON.stringify([
            {
              tag_name: 'v0.2.64',
              prerelease: true,
              assets: [
                {
                  name: 'Torve-Desktop-Setup-0.2.64.exe',
                  browser_download_url: 'https://downloads.example.com/Torve-Desktop-Setup-0.2.64.exe',
                },
              ],
            },
          ]),
          { status: 200 },
        ),
    });
    const upToDateState = await upToDateUpdater.checkForUpdates();
    assert.equal(upToDateState.phase, 'up-to-date');
    assert.equal(upToDateState.latestVersion, '0.2.64');
    assert.equal(upToDateState.error, null);

    // 3. Unsigned .exe (no digest) succeeds if valid MZ PE, and rejects corrupt non-MZ payload
    const exeBytes = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
    let returnCorrupt = true;
    const unsignedUpdater = new TorveUpdater({
      currentVersion: '0.2.64',
      tempDir: dir,
      autoDownload: false,
      releaseUrl: 'https://example.invalid/releases',
      fetchFn: async (input) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url === 'https://example.invalid/releases') {
          return new Response(
            JSON.stringify({
              tag_name: 'v0.2.65',
              assets: [
                {
                  name: 'Torve-Desktop-Setup-0.2.65.exe',
                  browser_download_url: 'https://downloads.example.com/Torve-Desktop-Setup-0.2.65.exe',
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(returnCorrupt ? '<html>bad gateway</html>' : exeBytes, { status: 200 });
      },
      spawnFn: () => ({ unref: () => {} }),
      onQuit: () => {},
    });

    await unsignedUpdater.checkForUpdates();
    const corruptDl = await unsignedUpdater.downloadUpdate();
    assert.equal(corruptDl.ok, false);
    assert.match(corruptDl.error ?? '', /PE \(MZ\)/);
    assert.equal(unsignedUpdater.getState().phase, 'error');

    returnCorrupt = false;
    const validDl = await unsignedUpdater.downloadUpdate();
    assert.equal(validDl.ok, true);
    assert.equal(unsignedUpdater.getState().phase, 'ready');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
