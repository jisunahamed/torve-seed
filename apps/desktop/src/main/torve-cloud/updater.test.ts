import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  TorveUpdater,
  compareSemver,
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

test('TorveUpdater checks, stream-downloads with progress, verifies PE/sha256, and spawns detached installer', async () => {
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

    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith('/releases/latest')) {
        return new Response(
          JSON.stringify({
            tag_name: 'v0.2.58',
            name: 'Torve Desktop v0.2.58',
            html_url: 'https://github.com/jisunahamed/torve-seed/releases/tag/v0.2.58',
            assets: [
              {
                name: 'Torve-Desktop-Setup-0.2.58.exe',
                browser_download_url: 'https://downloads.example.com/Torve-Desktop-Setup-0.2.58.exe',
                size: exeBytes.length,
                digest: `sha256:${sha256}`,
              },
            ],
          }),
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
      currentVersion: '0.2.57',
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
    assert.equal(checkState.latestVersion, '0.2.58');
    assert.equal(checkState.assetName, 'Torve-Desktop-Setup-0.2.58.exe');

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
