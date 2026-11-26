import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isAppPatched, listAppsStatus } from '../src/apps.js';
import { disableApp, enableApp, MIN_CONTEXT_WINDOW_FLOOR, MIN_OUTPUT_TOKENS_FLOOR } from '../src/config-patch.js';
import { codexCatalogPath } from '../src/state.js';

let tempRoot = '';
let prevHome: string | undefined;
let prevTorveHome: string | undefined;

beforeEach(() => {
  tempRoot = mkdtempSync(path.join(tmpdir(), 'torve-cli-patch-'));
  prevHome = process.env['TORVE_TEST_HOME'];
  prevTorveHome = process.env['TORVE_HOME'];
  process.env['TORVE_TEST_HOME'] = tempRoot;
  process.env['TORVE_HOME'] = path.join(tempRoot, '.torve');
});

afterEach(() => {
  if (prevHome === undefined) delete process.env['TORVE_TEST_HOME'];
  else process.env['TORVE_TEST_HOME'] = prevHome;
  if (prevTorveHome === undefined) delete process.env['TORVE_HOME'];
  else process.env['TORVE_HOME'] = prevTorveHome;
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
});

describe('config patching and restoration', () => {
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

  it('patches Codex TOML with model_context_window = 1000000 and writes catalog, then restores cleanly', async () => {
    const codexDir = path.join(tempRoot, '.codex');
    mkdirSync(codexDir, { recursive: true });
    const tomlFile = path.join(codexDir, 'config.toml');
    const original = 'approval_policy = "on-request"\n\n[projects."/repo"]\ntrust_level = "trusted"\n';
    writeFileSync(tomlFile, original, 'utf8');
    writeFileSync(path.join(codexDir, 'models_cache.json'), '{}', 'utf8');

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

    await disableApp('codex');
    expect(readFileSync(tomlFile, 'utf8')).toBe(original);
    expect(existsSync(codexCatalogPath())).toBe(false);
  });

  it('patches and restores Claude Code, Gemini CLI, Aider, Continue YAML, and Hermes YAML', async () => {
    mkdirSync(path.join(tempRoot, '.claude'), { recursive: true });
    mkdirSync(path.join(tempRoot, '.gemini'), { recursive: true });
    mkdirSync(path.join(tempRoot, '.continue'), { recursive: true });
    mkdirSync(path.join(tempRoot, '.hermes'), { recursive: true });

    writeFileSync(path.join(tempRoot, '.claude', 'settings.json'), '{"model":"sonnet"}\n');
    writeFileSync(path.join(tempRoot, '.gemini', 'settings.json'), '{"theme":"Default"}\n');
    writeFileSync(path.join(tempRoot, '.aider.conf.yml'), 'auto-commits: false\n');
    writeFileSync(path.join(tempRoot, '.continue', 'config.yaml'), 'models:\n  - name: Local\n    provider: ollama\n');
    writeFileSync(path.join(tempRoot, '.hermes', 'config.yaml'), 'model:\n  provider: openai\n');

    const models = [{ id: 'claude-sonnet-4', name: 'Claude Sonnet 4' }];
    for (const app of ['claude-code', 'gemini-cli', 'aider', 'continue', 'hermes']) {
      await enableApp(app, { port: 8378, models });
    }

    const claudeCfg = JSON.parse(readFileSync(path.join(tempRoot, '.claude', 'settings.json'), 'utf8')) as {
      env: Record<string, string>;
      model: string;
    };
    expect(claudeCfg.env['ANTHROPIC_BASE_URL']).toBe('http://localhost:8378/app/claude-code');
    expect(claudeCfg.model).toBe('torve');

    const geminiEnv = readFileSync(path.join(tempRoot, '.gemini', '.env'), 'utf8');
    expect(geminiEnv).toContain('GOOGLE_GEMINI_BASE_URL=http://localhost:8378/app/gemini-cli');

    const continueYaml = readFileSync(path.join(tempRoot, '.continue', 'config.yaml'), 'utf8');
    expect(continueYaml).toContain('name: Local');
    expect(continueYaml).toContain('Torve · Auto');

    const hermesYaml = readFileSync(path.join(tempRoot, '.hermes', 'config.yaml'), 'utf8');
    expect(hermesYaml).toContain('http://localhost:8378/app/hermes/v1');

    for (const app of ['claude-code', 'gemini-cli', 'aider', 'continue', 'hermes']) {
      await disableApp(app);
    }

    expect(JSON.parse(readFileSync(path.join(tempRoot, '.claude', 'settings.json'), 'utf8'))).toEqual({ model: 'sonnet' });
    expect(readFileSync(path.join(tempRoot, '.aider.conf.yml'), 'utf8')).toBe('auto-commits: false\n');
    expect(readFileSync(path.join(tempRoot, '.continue', 'config.yaml'), 'utf8')).not.toContain('Torve · ');
    expect(readFileSync(path.join(tempRoot, '.hermes', 'config.yaml'), 'utf8')).toContain('provider: openai');
  });
});
