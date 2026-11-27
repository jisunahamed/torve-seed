import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expandHomePath, getHomeDir } from './state.js';
import type { AppDefinition, AppStatusItem, ComingSoonApp, ConfigPatchDef } from './types.js';

export const COMING_SOON_APPS: readonly ComingSoonApp[] = [
  { id: 'cursor', displayName: 'Cursor' },
  { id: 'cline', displayName: 'Cline / Roo Code', aliases: ['roo', 'roo-code', 'cline-roo-code', 'cline/roo-code'] },
  { id: 'aider', displayName: 'Aider' },
  { id: 'continue', displayName: 'Continue' },
];

export function antigravityIdeSettingsPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const home = getHomeDir();
  if (platform === 'win32') return path.join(env['APPDATA'] || path.join(home, 'AppData', 'Roaming'), 'Antigravity', 'User', 'settings.json');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Antigravity', 'User', 'settings.json');
  return path.join(home, '.config', 'Antigravity', 'User', 'settings.json');
}

export function claudeDesktopDefaultPaths(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): {
  configPath: string;
  thirdPartyDir: string;
} {
  const home = getHomeDir();
  if (platform === 'win32') {
    const roaming = env['APPDATA'] || path.join(home, 'AppData', 'Roaming');
    const local = env['LOCALAPPDATA'] || path.join(home, 'AppData', 'Local');
    const root = existsSync(path.join(roaming, 'Claude')) ? path.join(roaming, 'Claude') : path.join(local, 'Claude');
    return {
      configPath: path.join(root, 'claude_desktop_config.json'),
      thirdPartyDir: `${root}-3p`,
    };
  }
  if (platform === 'darwin') {
    return {
      configPath: '~/Library/Application Support/Claude/claude_desktop_config.json',
      thirdPartyDir: '~/Library/Application Support/Claude-3p',
    };
  }
  return {
    configPath: '~/.config/Claude/claude_desktop_config.json',
    thirdPartyDir: '~/.config/Claude-3p',
  };
}

export function getAppDefinitions(): readonly AppDefinition[] {
  const claudeDesktopPaths = claudeDesktopDefaultPaths();
  return [
    {
      name: 'antigravity',
      displayName: 'Google Antigravity',
      kind: 'config-patch',
      method: 'IDE settings + MCP fallback',
      binary: 'antigravity',
      detectPaths: [path.dirname(antigravityIdeSettingsPath()), '~/.gemini/antigravity'],
      configPatch: {
        format: 'antigravity-ide',
        configPath: antigravityIdeSettingsPath(),
        baseURL: 'http://127.0.0.1:{buyerPort}',
        mcpFallback: true,
        mcpConfigPath: '~/.gemini/config/mcp_config.json',
        serverPath: '~/.torve/mcp/torve-local.mjs',
      },
    },
    {
      name: 'codex',
      displayName: 'Codex',
      kind: 'config-patch',
      method: 'Config patch',
      binary: 'codex',
      detectPaths: ['~/.codex', '~/.local/bin/codex'],
      configPatch: {
        format: 'codex',
        configPath: '~/.codex/config.toml',
        providerKey: 'torve',
        providerName: 'Torve AI',
        baseURL: 'http://127.0.0.1:{buyerPort}/v1',
        modelCatalogJson: '~/.torve/codex-model-catalog.json',
        bearerToken: 'torve-local-proxy',
      },
    },
    {
      name: 'opencode',
      displayName: 'OpenCode',
      kind: 'config-patch',
      method: 'Config patch',
      binary: 'opencode',
      detectPaths: [
        '~/.config/opencode',
        '~/.opencode/bin/opencode',
        '~/.local/share/opencode',
        ...(process.platform === 'win32'
          ? [path.join(process.env['APPDATA'] || path.join(getHomeDir(), 'AppData', 'Roaming'), 'opencode')]
          : []),
      ],
      configPatch: {
        format: 'opencode',
        configPath: '~/.config/opencode/opencode.jsonc',
        providerKey: 'torve',
        npm: '@ai-sdk/openai-compatible',
        providerName: 'Torve',
        baseURL: 'http://localhost:{buyerPort}/v1',
      },
    },
    {
      name: 'claude-desktop',
      displayName: 'Claude Desktop',
      kind: 'config-patch',
      method: 'Config patch (3P gateway)',
      detectPaths: [
        claudeDesktopPaths.configPath,
        path.dirname(expandHomePath(claudeDesktopPaths.configPath)),
      ],
      configPatch: {
        format: 'claude-desktop',
        configPath: claudeDesktopPaths.configPath,
        thirdPartyDir: claudeDesktopPaths.thirdPartyDir,
        baseURL: 'http://127.0.0.1:{claudeGatewayPort}',
      },
    },
    {
      name: 'claude-code',
      displayName: 'Claude Code CLI',
      kind: 'config-patch',
      method: 'Config patch',
      binary: 'claude',
      detectPaths: ['~/.claude', '~/.local/bin/claude', '~/.claude/local/claude'],
      configPatch: {
        format: 'claude-code',
        configPath: '~/.claude/settings.json',
        providerKey: 'torve',
        baseURL: 'http://localhost:{buyerPort}',
      },
    },
    {
      name: 'gemini-cli',
      displayName: 'Gemini CLI',
      kind: 'config-patch',
      method: 'Config patch',
      binary: 'gemini',
      detectPaths: ['~/.gemini'],
      configPatch: {
        format: 'gemini-cli',
        configPath: '~/.gemini/settings.json',
        envPath: '~/.gemini/.env',
        baseURL: 'http://localhost:{buyerPort}',
      },
    },
  ];
}

export function findAppDefinition(name: string): AppDefinition | undefined {
  const normalized = name.trim().toLowerCase();
  return getAppDefinitions().find((a) => a.name === normalized);
}

export function findComingSoonApp(name: string): ComingSoonApp | undefined {
  const normalized = name.trim().toLowerCase();
  return COMING_SOON_APPS.find(
    (app) => app.id === normalized
      || app.displayName.toLowerCase() === normalized
      || app.aliases?.includes(normalized),
  );
}

function binaryOnPath(binary: string): boolean {
  try {
    if (process.platform === 'win32') {
      execFileSync('where.exe', [binary], { stdio: 'ignore', windowsHide: true, timeout: 800 });
    } else {
      execFileSync('/bin/sh', ['-c', `command -v ${binary}`], { stdio: 'ignore', timeout: 800 });
    }
    return true;
  } catch {
    return false;
  }
}

export function isAppDetected(app: AppDefinition): boolean {
  for (const rawPath of app.detectPaths) {
    const resolved = expandHomePath(rawPath);
    if (existsSync(resolved)) return true;
  }
  if (app.binary && binaryOnPath(app.binary)) return true;
  return false;
}

export function stripJsoncComments(raw: string): string {
  let result = '';
  let inString = false;
  let quote = '';
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    const next = raw[i + 1];
    if (inString) {
      result += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) {
        inString = false;
        quote = '';
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      result += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < raw.length && raw[i] !== '\n') i++;
      if (i < raw.length) result += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < raw.length && !(raw[i] === '*' && raw[i + 1] === '/')) {
        result += raw[i] === '\n' ? '\n' : ' ';
        i++;
      }
      i++;
      continue;
    }
    result += ch;
  }
  return result;
}

export function stripJsoncTrailingCommas(raw: string): string {
  let result = '';
  let inString = false;
  let quote = '';
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (inString) {
      result += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) {
        inString = false;
        quote = '';
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      result += ch;
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (j < raw.length && /\s/.test(raw[j]!)) j++;
      if (raw[j] === '}' || raw[j] === ']') continue;
    }
    result += ch;
  }
  return result;
}

export function tryReadJsonc(filePath: string): Record<string, unknown> | null {
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(stripJsoncTrailingCommas(stripJsoncComments(raw))) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function isLoopbackUrl(value: unknown): boolean {
  return typeof value === 'string' && /^https?:\/\/(localhost|127\.0\.0\.1):\d+/.test(value);
}

export function opencodeTargets(patch: Extract<ConfigPatchDef, { format: 'opencode' }>): string[] {
  const configured = expandHomePath(patch.configPath);
  const configuredDir = path.dirname(configured);
  const configuredName = path.basename(configured).toLowerCase();
  const siblingName = configuredName === 'opencode.json' ? 'opencode.jsonc' : 'opencode.json';
  const candidates = [configured, path.join(configuredDir, siblingName)];
  if (process.platform === 'win32') {
    const roaming = process.env['APPDATA'] || path.join(getHomeDir(), 'AppData', 'Roaming');
    for (const name of ['opencode.jsonc', 'opencode.json']) {
      candidates.push(path.join(roaming, 'opencode', name));
    }
  }
  const unique = [...new Set(candidates.map((c) => path.resolve(c)))];
  const existing = unique.filter((p) => existsSync(p));
  return existing.length > 0 ? existing : [path.resolve(configured)];
}

export function isAppPatched(app: AppDefinition): boolean {
  const patch = app.configPatch;

  switch (patch.format) {
    case 'opencode': {
      for (const target of opencodeTargets(patch)) {
        const cfg = tryReadJsonc(target);
        const provider = cfg?.['provider'];
        if (provider && typeof provider === 'object' && !Array.isArray(provider) && patch.providerKey in provider) {
          return true;
        }
      }
      return false;
    }
    case 'codex': {
      const filePath = expandHomePath(patch.configPath);
      if (!existsSync(filePath)) return false;
      const raw = readFileSync(filePath, 'utf8');
      return new RegExp(`^\\s*\\[\\s*model_providers\\s*\\.\\s*("?)${patch.providerKey}\\1\\s*\\]`, 'm').test(raw)
        && /^\s*model_provider\s*=\s*"torve"/m.test(raw);
    }
    case 'claude-code': {
      const cfg = tryReadJsonc(expandHomePath(patch.configPath));
      const env = cfg?.['env'];
      if (!env || typeof env !== 'object' || Array.isArray(env)) return false;
      return isLoopbackUrl((env as Record<string, unknown>)['ANTHROPIC_BASE_URL'])
        && (env as Record<string, unknown>)['ANTHROPIC_AUTH_TOKEN'] === 'torve-local-proxy';
    }
    case 'claude-desktop': {
      const cfg = tryReadJsonc(expandHomePath(patch.configPath));
      const meta = tryReadJsonc(path.join(expandHomePath(patch.thirdPartyDir), 'configLibrary', '_meta.json'));
      return cfg?.['deploymentMode'] === '3p' && meta?.['appliedId'] === '00000000-0000-4000-8000-0000a4753eed';
    }
    case 'gemini-cli': {
      const envPath = expandHomePath(patch.envPath);
      if (!existsSync(envPath)) return false;
      const raw = readFileSync(envPath, 'utf8');
      return /^GOOGLE_GEMINI_BASE_URL=https?:\/\/(localhost|127\.0\.0\.1):\d+/m.test(raw)
        && /^GEMINI_API_KEY=torve-local-proxy$/m.test(raw);
    }
    case 'antigravity-ide': {
      const cfg = tryReadJsonc(expandHomePath(patch.configPath));
      if (isLoopbackUrl(cfg?.['jetski.cloudCodeUrl'])) return true;
      if (patch.mcpConfigPath) {
        const mcp = tryReadJsonc(expandHomePath(patch.mcpConfigPath));
        const servers = mcp?.['mcpServers'];
        if (servers && typeof servers === 'object' && !Array.isArray(servers) && 'torve' in servers) return true;
      }
      return false;
    }
  }
}

export function listAppsStatus(): AppStatusItem[] {
  return getAppDefinitions().map((app) => {
    const detected = isAppDetected(app);
    const patched = isAppPatched(app);
    const configPath = expandHomePath(app.configPatch.configPath);
    return {
      name: app.name,
      displayName: app.displayName,
      kind: app.kind,
      detected,
      patched,
      status: patched ? 'ON' : 'OFF',
      configPath,
    };
  });
}
