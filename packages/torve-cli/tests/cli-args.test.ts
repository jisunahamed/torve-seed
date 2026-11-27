import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLI_VERSION, parseCliArgs, runCli } from '../src/cli.js';

let tempRoot = '';
let prevTestHome: string | undefined;
let prevTorveHome: string | undefined;

beforeEach(() => {
  tempRoot = mkdtempSync(path.join(tmpdir(), 'torve-cli-args-'));
  prevTestHome = process.env['TORVE_TEST_HOME'];
  prevTorveHome = process.env['TORVE_HOME'];
  process.env['TORVE_TEST_HOME'] = tempRoot;
  process.env['TORVE_HOME'] = path.join(tempRoot, '.torve');
});

afterEach(() => {
  if (prevTestHome === undefined) delete process.env['TORVE_TEST_HOME'];
  else process.env['TORVE_TEST_HOME'] = prevTestHome;
  if (prevTorveHome === undefined) delete process.env['TORVE_HOME'];
  else process.env['TORVE_HOME'] = prevTorveHome;
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
});

async function captureLogs(fn: () => Promise<number>): Promise<{ code: number; output: string }> {
  const origLog = console.log;
  const lines: string[] = [];
  console.log = (msg?: unknown) => lines.push(String(msg ?? ''));
  try {
    const code = await fn();
    return { code, output: lines.join('\n') };
  } finally {
    console.log = origLog;
  }
}

describe('parseCliArgs and CLI commands', () => {
  it('parses command, positionals, and global flags', () => {
    const parsed = parseCliArgs(['on', 'codex', '--port', '9001', '--token=torve_abc123', '--json']);
    expect(parsed.command).toBe('on');
    expect(parsed.positionals).toEqual(['codex']);
    expect(parsed.port).toBe(9001);
    expect(parsed.portExplicit).toBe(true);
    expect(parsed.token).toBe('torve_abc123');
    expect(parsed.json).toBe(true);
  });

  it('parses start flags (--foreground / --daemon)', () => {
    const fg = parseCliArgs(['start', '--foreground', '--port=8379']);
    expect(fg.command).toBe('start');
    expect(fg.foreground).toBe(true);
    expect(fg.port).toBe(8379);

    const bg = parseCliArgs(['start', '--daemon']);
    expect(bg.daemon).toBe(true);
    expect(bg.foreground).toBe(false);
  });

  it('rejects invalid ports and unknown flags', () => {
    expect(() => parseCliArgs(['start', '--port', '99999'])).toThrow(/Invalid port/);
    expect(() => parseCliArgs(['apps', '--bogus'])).toThrow(/Unknown flag/);
  });

  it('handles --version and --help cleanly', async () => {
    const ver = await captureLogs(() => runCli(['--version']));
    expect(ver.code).toBe(0);
    expect(ver.output).toBe(CLI_VERSION);

    const help = await captureLogs(() => runCli(['--help']));
    expect(help.code).toBe(0);
    expect(help.output).toContain('Usage: torve <command>');
  });

  it('lists the 6 active apps with exact labels and Coming Soon section in `torve apps`', async () => {
    const textRun = await captureLogs(() => runCli(['apps']));
    expect(textRun.code).toBe(0);
    expect(textRun.output).toContain('Google Antigravity');
    expect(textRun.output).toContain('Codex');
    expect(textRun.output).toContain('OpenCode');
    expect(textRun.output).toContain('Claude Desktop');
    expect(textRun.output).toContain('Claude Code CLI');
    expect(textRun.output).toContain('Gemini CLI');
    expect(textRun.output).toContain('Coming Soon:');
    expect(textRun.output).toContain('Cursor');
    expect(textRun.output).toContain('Cline / Roo Code');
    expect(textRun.output).toContain('Aider');
    expect(textRun.output).toContain('Continue');

    const jsonRun = await captureLogs(() => runCli(['apps', '--json']));
    expect(jsonRun.code).toBe(0);
    const parsed = JSON.parse(jsonRun.output) as {
      apps: Array<{ name: string; displayName: string }>;
      comingSoon: Array<{ id: string; displayName: string }>;
    };
    expect(parsed.apps.map((a) => [a.name, a.displayName])).toEqual([
      ['antigravity', 'Google Antigravity'],
      ['codex', 'Codex'],
      ['opencode', 'OpenCode'],
      ['claude-desktop', 'Claude Desktop'],
      ['claude-code', 'Claude Code CLI'],
      ['gemini-cli', 'Gemini CLI'],
    ]);
    expect(parsed.comingSoon.map((a) => [a.id, a.displayName])).toEqual([
      ['cursor', 'Cursor'],
      ['cline', 'Cline / Roo Code'],
      ['aider', 'Aider'],
      ['continue', 'Continue'],
    ]);
  });

  it('exits cleanly with supported apps list when running `torve on <coming-soon-id>`', async () => {
    for (const [id, label] of [
      ['cursor', 'Cursor'],
      ['cline', 'Cline / Roo Code'],
      ['roo-code', 'Cline / Roo Code'],
      ['aider', 'Aider'],
      ['continue', 'Continue'],
    ] as const) {
      const res = await captureLogs(() => runCli(['on', id]));
      expect(res.code).toBe(0);
      expect(res.output).toContain(`${label} is coming soon`);
      expect(res.output).toContain('Supported apps (6):');
      expect(res.output).toContain('Google Antigravity');
      expect(res.output).toContain('Claude Desktop');
      expect(res.output).toContain('Claude Code CLI');
    }

    const jsonRes = await captureLogs(() => runCli(['on', 'cursor', '--json']));
    expect(jsonRes.code).toBe(0);
    const parsed = JSON.parse(jsonRes.output) as {
      ok: boolean;
      comingSoon: boolean;
      app: string;
      supportedApps: Array<{ name: string; displayName: string }>;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.comingSoon).toBe(true);
    expect(parsed.app).toBe('cursor');
    expect(parsed.supportedApps).toHaveLength(6);
  });

  it('reports totalSupported = 6 in `torve status --json`', async () => {
    const res = await captureLogs(() => runCli(['status', '--port', '59991', '--json']));
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.output) as { apps: { totalSupported: number } };
    expect(parsed.apps.totalSupported).toBe(6);
  });
});
