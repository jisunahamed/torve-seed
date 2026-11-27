import { homedir } from 'node:os';
import path from 'node:path';

/**
 * Built-in "Connected apps" catalog for the AI VPN Connected apps screen.
 *
 * These are the 6 active supported tools with natively configurable API
 * endpoints, so they ship publicly with the app and show by default.
 */

/**
 * Per-platform config path for tools that follow Windows conventions instead
 * of `~/.config`. `~/`-style paths expand against homedir() everywhere, which
 * is right for home-rooted tools (codex `~/.codex`, opencode
 * `~/.config/opencode` — verified home-based even on Windows) but wrong for
 * tools whose Windows builds read from the known folders. Resolved here, at
 * definition time, so the patcher keeps a single path string per profile.
 */
export function platformConfigPath(
  posixPath: string,
  windowsFolder: { base: 'APPDATA' | 'LOCALAPPDATA'; segments: readonly string[] } | null,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform !== 'win32' || !windowsFolder) return posixPath;
  const fallback = windowsFolder.base === 'APPDATA' ? ['AppData', 'Roaming'] : ['AppData', 'Local'];
  const root = env[windowsFolder.base] || path.join(homedir(), ...fallback);
  return path.join(root, ...windowsFolder.segments);
}

export const DEFAULT_APP_PROFILES: readonly Record<string, unknown>[] = [
  {
    name: 'antigravity',
    displayName: 'Google Antigravity',
    kind: 'config-patch',
    method: 'MCP fallback (native picker requires VS Code edition)',
    toolSlugs: ['antigravity'],
    domains: [],
    pathPrefixes: [],
    configPatch: {
      format: 'antigravity-ide',
      configPath: 'auto',
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
    toolSlugs: ['codex'],
    domains: [],
    pathPrefixes: [],
    configPatch: {
      format: 'codex',
      configPath: '~/.codex/config.toml',
      providerKey: 'torve',
      providerName: 'Torve AI',
      baseURL: 'http://127.0.0.1:{buyerPort}/v1',
      modelCatalogJson: '~/.torve/codex-model-catalog.json',
      bearerToken: 'torve-local-proxy',
      installProbe: 'codex',
    },
  },
  {
    name: 'opencode',
    displayName: 'OpenCode',
    kind: 'config-patch',
    method: 'Config patch',
    // Client names this tool stamps on its requests (User-Agent product /
    // session-header slug) — how conversations are attributed to the app.
    toolSlugs: ['opencode'],
    domains: [],
    pathPrefixes: [],
    configPatch: {
      format: 'opencode',
      configPath: '~/.config/opencode/opencode.jsonc',
      providerKey: 'torve',
      npm: '@ai-sdk/openai-compatible',
      providerName: 'Torve',
      baseURL: 'http://localhost:{buyerPort}/v1',
      // Patch actual installations (native and, on Windows, WSL distros)
      // instead of blindly writing the one path above; fail the connect when
      // the tool is found nowhere. Set on every built-in CLI tool below;
      // see applyWithInstallProbe.
      installProbe: 'opencode',
    },
  },
  {
    name: 'claude-desktop',
    displayName: 'Claude Desktop',
    kind: 'config-patch',
    method: 'Config patch',
    // The gateway stamps every forwarded request with the claude-desktop
    // source marker, so this exact slug is the whole identity.
    toolSlugs: ['claude-desktop'],
    domains: [],
    pathPrefixes: [],
    // 'open-tool' opens Claude after connect even when it was not running
    // (restartAppName is both the restart target for a running Claude and
    // the open-tool launch fallback).
    appAction: 'open-tool',
    restartAppName: 'Claude',
    configPatch: {
      format: 'claude-desktop',
      // Claude's normal-profile config: the patch flips deploymentMode to
      // "3p" here, which makes Claude boot against the Claude-3p profile
      // directory below, where the Torve gateway profile is written.
      // Windows paths are NOT resolved here — Claude has several install
      // layouts there (classic, MSIX, Nest), so claudeDesktopPatchTargets
      // derives its own candidate roots on win32 and these apply elsewhere.
      configPath: '~/Library/Application Support/Claude/claude_desktop_config.json',
      thirdPartyDir: '~/Library/Application Support/Claude-3p',
      // Claude talks to the desktop's local Claude gateway (Anthropic-native
      // model catalog + forwarding to the buyer proxy), not the buyer proxy
      // directly — see connected-apps/claude-desktop-gateway.ts.
      baseURL: 'http://127.0.0.1:{claudeGatewayPort}',
    },
  },
  {
    name: 'claude-code',
    displayName: 'Claude Code CLI',
    kind: 'config-patch',
    method: 'Config patch',
    toolSlugs: ['claude-code'],
    domains: [],
    pathPrefixes: [],
    configPatch: {
      format: 'claude-code',
      configPath: '~/.claude/settings.json',
      providerKey: 'torve',
      baseURL: 'http://localhost:{buyerPort}',
      installProbe: 'claude',
    },
  },
  {
    name: 'gemini-cli',
    displayName: 'Gemini CLI',
    kind: 'config-patch',
    method: 'Config patch',
    toolSlugs: ['gemini', 'gemini-cli'],
    domains: [],
    pathPrefixes: [],
    configPatch: {
      format: 'gemini-cli',
      configPath: '~/.gemini/settings.json',
      envPath: '~/.gemini/.env',
      baseURL: 'http://localhost:{buyerPort}',
    },
  },
];

/**
 * Combine the packaged/env profile list with the built-in defaults: external
 * entries keep their order and override same-name defaults; the remaining
 * defaults follow.
 */
export function mergeWithDefaultAppProfiles(external: readonly unknown[]): unknown[] {
  const externalNames = new Set(
    external
      .map((profile) => (profile && typeof profile === 'object' && !Array.isArray(profile))
        ? (profile as Record<string, unknown>)['name']
        : undefined)
      .filter((name): name is string => typeof name === 'string'),
  );
  return [
    ...external,
    ...DEFAULT_APP_PROFILES.filter((profile) => !externalNames.has(profile['name'] as string)),
  ];
}
