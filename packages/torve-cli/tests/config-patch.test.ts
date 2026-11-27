import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { COMING_SOON_APPS, isAppPatched, listAppsStatus } from '../src/apps.js';
import { migrateCodexThreadsToTorve, restoreCodexThreadsFromTorve } from '../src/codex-threads.js';
import { disableApp, enableApp, MIN_CONTEXT_WINDOW_FLOOR, MIN_OUTPUT_TOKENS_FLOOR } from '../src/config-patch.js';
import { codexCatalogPath, codexMigratedThreadsPath } from '../src/state.js';

let tempRoot = '';
let prevHome: string | undefined;
let prevTorveHome: string | undefined;
let prevAppData: string | undefined;
let prevLocalAppData: string | undefined;

beforeEach(() => {
  tempRoot = mkdtempSync(path.join(tmpdir(), 'torve-cli-patch-'));
  prevHome = process.env['TORVE_TEST_HOME'];
  prevTorveHome = process.env['TORVE_HOME'];
  prevAppData = process.env['APPDATA'];
  prevLocalAppData = process.env['LOCALAPPDATA'];
  process.env['TORVE_TEST_HOME'] = tempRoot;
  process.env['TORVE_HOME'] = path.join(tempRoot, '.torve');
  process.env['APPDATA'] = path.join(tempRoot, 'AppData', 'Roaming');
  process.env['LOCALAPPDATA'] = path.join(tempRoot, 'AppData', 'Local');
});

afterEach(() => {
  if (prevHome === undefined) delete process.env['TORVE_TEST_HOME'];
  else process.env['TORVE_TEST_HOME'] = prevHome;
  if (prevTorveHome === undefined) delete process.env['TORVE_HOME'];
  else process.env['TORVE_HOME'] = prevTorveHome;
  if (prevAppData === undefined) delete process.env['APPDATA'];
  else process.env['APPDATA'] = prevAppData;
  if (prevLocalAppData === undefined) delete process.env['LOCALAPPDATA'];
  else process.env['LOCALAPPDATA'] = prevLocalAppData;
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
});

async function loadNodeSqlite(): Promise<{ DatabaseSync: new (p: string) => { exec: (sql: string) => void; prepare: (sql: string) => { run: (...args: unknown[]) => unknown; all: (...args: unknown[]) => unknown[] }; close: () => void } } | null> {
  try {
    const mod = (await import('node:sqlite' as string)) as {
      DatabaseSync?: new (p: string) => { exec: (sql: string) => void; prepare: (sql: string) => { run: (...args: unknown[]) => unknown; all: (...args: unknown[]) => unknown[] }; close: () => void };
    };
    return typeof mod.DatabaseSync === 'function' ? { DatabaseSync: mod.DatabaseSync } : null;
  } catch {
    return null;
  }
}

describe('6-app inventory and config patching', () => {
  it('exposes strictly the 6 active apps with distinct labels and 4 coming-soon apps', () => {
    const statuses = listAppsStatus();
    expect(statuses.map((s) => [s.name, s.displayName])).toEqual([
      ['antigravity', 'Google Antigravity'],
      ['codex', 'Codex'],
      ['opencode', 'OpenCode'],
      ['claude-desktop', 'Claude Desktop'],
      ['claude-code', 'Claude Code CLI'],
      ['gemini-cli', 'Gemini CLI'],
    ]);
    expect(COMING_SOON_APPS.map((a) => [a.id, a.displayName])).toEqual([
      ['cursor', 'Cursor'],
      ['cline', 'Cline / Roo Code'],
      ['aider', 'Aider'],
      ['continue', 'Continue'],
    ]);
  });

  it('rejects removed legacy/niche apps and coming-soon apps in enableApp', async () => {
    for (const removed of ['zed', 'goose', 'hermes', 'droid', 'crush', 'pi', 'gooeypi', 't3code', 'aider', 'continue', 'cursor']) {
      await expect(enableApp(removed, { port: 8378, models: [] })).rejects.toThrow(/Unknown app/);
    }
  });

  it('patches OpenCode with singular provider, 1M context floor, and 32K output floor, then restores backup', async () => {
    const ocDir = path.join(tempRoot, '.config', 'opencode');
    mkdirSync(ocDir, { recursive: true });
    const ocFile = path.join(ocDir, 'opencode.jsonc');
    const original = '{\n  // user comment\n  "providers": { "legacy": {} },\n  "theme": "dark",\n}\n';
    writeFileSync(ocFile, original, 'utf8');

    await enableApp('opencode', {
      port: 8378,
      models: [{ id: 'glm-5-flash', name: 'GLM 5 Flash', context_window: 128_000, max_output_tokens: 4096 }],
    });

    const patched = JSON.parse(readFileSync(ocFile, 'utf8')) as Record<string, unknown>;
    expect(patched['providers']).toBeUndefined();
    expect(patched['theme']).toBe('dark');
    expect(patched['model']).toBe('torve/auto');

    const provider = (patched['provider'] as Record<string, Record<string, unknown>>)['torve']!;
    expect(provider['npm']).toBe('@ai-sdk/openai-compatible');
    expect((provider['options'] as Record<string, unknown>)['baseURL']).toBe('http://localhost:8378/app/opencode/v1');
    const models = provider['models'] as Record<string, { limit: { context: number; output: number } }>;
    expect(models['auto']!.limit.context).toBe(MIN_CONTEXT_WINDOW_FLOOR);
    expect(models['auto']!.limit.output).toBe(MIN_OUTPUT_TOKENS_FLOOR);
    expect(models['glm-5-flash']!.limit.context).toBe(MIN_CONTEXT_WINDOW_FLOOR);
    expect(models['glm-5-flash']!.limit.output).toBe(MIN_OUTPUT_TOKENS_FLOOR);

    const opencodeStatus = listAppsStatus().find((a) => a.name === 'opencode')!;
    expect(opencodeStatus.status).toBe('ON');
    expect(isAppPatched({
      name: 'opencode', displayName: 'OpenCode', kind: 'config-patch', method: 'Config patch', detectPaths: [],
      configPatch: { format: 'opencode', configPath: '~/.config/opencode/opencode.jsonc', providerKey: 'torve', npm: '@ai-sdk/openai-compatible', providerName: 'Torve', baseURL: 'http://localhost:{buyerPort}/v1' },
    })).toBe(true);

    await disableApp('opencode');
    expect(readFileSync(ocFile, 'utf8')).toBe(original);
    expect(listAppsStatus().find((a) => a.name === 'opencode')!.status).toBe('OFF');
  });

  it('patches Codex TOML, writes catalog, migrates/restores state_5.sqlite threads, and restores cleanly', async () => {
    const codexDir = path.join(tempRoot, '.codex');
    mkdirSync(codexDir, { recursive: true });
    const tomlFile = path.join(codexDir, 'config.toml');
    const original = 'approval_policy = "on-request"\n\n[projects."/repo"]\ntrust_level = "trusted"\n';
    writeFileSync(tomlFile, original, 'utf8');
    writeFileSync(path.join(codexDir, 'models_cache.json'), '{}', 'utf8');

    const sqlite = await loadNodeSqlite();
    const dbPath = path.join(codexDir, 'state_5.sqlite');
    const rolloutPath = path.join(codexDir, 'rollout-1.jsonl');
    if (sqlite) {
      writeFileSync(
        rolloutPath,
        [
          JSON.stringify({ timestamp: '2026-01-01T00:00:00Z', type: 'session_meta', payload: { id: 't-openai', model_provider: 'openai' } }),
          JSON.stringify({ timestamp: '2026-01-01T00:00:01Z', type: 'response_item', payload: { text: 'hello' } }),
        ].join('\n') + '\n',
        'utf8',
      );
      const db = new sqlite.DatabaseSync(dbPath);
      try {
        db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, model_provider TEXT, rollout_path TEXT);');
        const insert = db.prepare('INSERT INTO threads (id, model_provider, rollout_path) VALUES (?, ?, ?)');
        const extendedRolloutPath = process.platform === 'win32' ? `\\\\?\\${rolloutPath}` : rolloutPath;
        insert.run('t-openai', 'openai', extendedRolloutPath);
        insert.run('t-router', 'codex-router', null);
        insert.run('t-ollama', 'ollama', null);
      } finally {
        db.close();
      }
    }

    await enableApp('codex', {
      port: 8378,
      models: [{ id: 'gpt-5.4', display_name: 'GPT-5.4', context_window: 200_000 }],
    });

    const patchedToml = readFileSync(tomlFile, 'utf8');
    expect(patchedToml).toContain('model_provider = "torve"');
    expect(patchedToml).toContain('model = "gpt-5.4"');
    expect(patchedToml).toContain('model_context_window = 1000000');
    expect(patchedToml).toContain('[model_providers.torve]');
    expect(patchedToml).toContain('base_url = "http://127.0.0.1:8378/app/codex/v1"');
    expect(patchedToml).toContain('wire_api = "responses"');
    expect(existsSync(codexCatalogPath())).toBe(true);
    expect(existsSync(path.join(codexDir, 'models_cache.json'))).toBe(false);

    if (sqlite) {
      expect(existsSync(codexMigratedThreadsPath())).toBe(true);
      const db = new sqlite.DatabaseSync(dbPath);
      try {
        const rows = db.prepare('SELECT id, model_provider FROM threads').all() as Array<{ id: string; model_provider: string }>;
        expect(Object.fromEntries(rows.map((r) => [r.id, r.model_provider]))).toEqual({
          't-openai': 'torve',
          't-router': 'torve',
          't-ollama': 'ollama',
        });
      } finally {
        db.close();
      }
      const sessionMeta = JSON.parse(readFileSync(rolloutPath, 'utf8').trim().split('\n')[0]!) as { payload: { model_provider: string } };
      expect(sessionMeta.payload.model_provider).toBe('torve');
    }

    await disableApp('codex');
    expect(readFileSync(tomlFile, 'utf8')).toBe(original);
    expect(existsSync(codexCatalogPath())).toBe(false);
    expect(existsSync(codexMigratedThreadsPath())).toBe(false);

    if (sqlite) {
      const db = new sqlite.DatabaseSync(dbPath);
      try {
        const rows = db.prepare('SELECT id, model_provider FROM threads').all() as Array<{ id: string; model_provider: string }>;
        expect(Object.fromEntries(rows.map((r) => [r.id, r.model_provider]))).toEqual({
          't-openai': 'openai',
          't-router': 'codex-router',
          't-ollama': 'ollama',
        });
      } finally {
        db.close();
      }
    }
  });

  it('handles Codex thread migration safely when state_5.sqlite is missing', async () => {
    const dbPath = path.join(tempRoot, 'missing-state_5.sqlite');
    const manifestPath = path.join(tempRoot, 'codex-migrated-threads.json');
    expect(await migrateCodexThreadsToTorve({ dbPath, manifestPath })).toEqual({ migratedCount: 0 });
    expect(existsSync(manifestPath)).toBe(false);
    expect(await restoreCodexThreadsFromTorve({ dbPath, manifestPath })).toEqual({ restoredCount: 0 });
  });

  it('patches and restores Claude Code CLI, Gemini CLI, Google Antigravity, and Claude Desktop', async () => {
    mkdirSync(path.join(tempRoot, '.claude'), { recursive: true });
    mkdirSync(path.join(tempRoot, '.gemini'), { recursive: true });
    writeFileSync(path.join(tempRoot, '.claude', 'settings.json'), '{"model":"sonnet"}\n');
    writeFileSync(path.join(tempRoot, '.gemini', 'settings.json'), '{"theme":"Default"}\n');

    const models = [{ id: 'claude-sonnet-4', name: 'Claude Sonnet 4' }];
    for (const app of ['claude-code', 'gemini-cli', 'antigravity', 'claude-desktop']) {
      await enableApp(app, { port: 8378, models });
    }

    const claudeCfg = JSON.parse(readFileSync(path.join(tempRoot, '.claude', 'settings.json'), 'utf8')) as {
      env: Record<string, string>;
      model: string;
    };
    expect(claudeCfg.env['ANTHROPIC_BASE_URL']).toBe('http://127.0.0.1:8378/app/claude-desktop');
    expect(claudeCfg.model).toBe('torve');

    const geminiEnv = readFileSync(path.join(tempRoot, '.gemini', '.env'), 'utf8');
    expect(geminiEnv).toContain('GOOGLE_GEMINI_BASE_URL=http://localhost:8378/app/gemini-cli');

    const statuses = listAppsStatus();
    expect(statuses.find((s) => s.name === 'antigravity')?.status).toBe('ON');
    expect(statuses.find((s) => s.name === 'claude-desktop')?.status).toBe('ON');
    expect(statuses.find((s) => s.name === 'claude-code')?.status).toBe('ON');
    expect(statuses.find((s) => s.name === 'gemini-cli')?.status).toBe('ON');

    for (const app of ['claude-desktop', 'antigravity', 'gemini-cli', 'claude-code']) {
      await disableApp(app);
    }

    expect(JSON.parse(readFileSync(path.join(tempRoot, '.claude', 'settings.json'), 'utf8'))).toEqual({ model: 'sonnet' });
    expect(listAppsStatus().every((s) => s.status === 'OFF')).toBe(true);
  });
});
