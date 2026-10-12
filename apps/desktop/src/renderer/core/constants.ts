export const DEFAULT_DASHBOARD_PORT = 3117;
export const POLL_INTERVAL_MS = 5000;

export const DEFAULT_ROUTER_RUNTIME = 'local';

export const ROUTER_PACKAGE_ALIASES: Record<string, string> = {
  local: '@torveai/router-local',
  'claude-code': '@torveai/router-local',
  'router-local': '@torveai/router-local',
  'torve-router-claude-code': '@torveai/router-local',
  'torve-router-local': '@torveai/router-local',
  '@torveai/router-local': '@torveai/router-local',
};

export const UI_MESSAGES = {
  desktopBridgeUnavailable:
    'Desktop bridge unavailable: preload failed to inject API. Restart app after main/preload compile.',
  localServicePortInUse: 'Local data service port already in use; reusing the existing service.',
  buyerAutoStarted: 'Buyer runtime auto-started for local proxy chat.',
} as const;
