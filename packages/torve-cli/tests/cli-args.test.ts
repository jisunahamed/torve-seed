import { describe, expect, it } from 'vitest';
import { CLI_VERSION, parseCliArgs, runCli } from '../src/cli.js';

describe('parseCliArgs', () => {
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
    const origLog = console.log;
    const lines: string[] = [];
    console.log = (msg?: unknown) => lines.push(String(msg ?? ''));
    try {
      expect(await runCli(['--version'])).toBe(0);
      expect(lines[0]).toBe(CLI_VERSION);

      lines.length = 0;
      expect(await runCli(['--help'])).toBe(0);
      expect(lines.join('\n')).toContain('Usage: torve <command>');
    } finally {
      console.log = origLog;
    }
  });
});
