import { Children, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AntigravityStandalonePatchStatus, SystemProxyProfileSummary, TorveAccountStatus } from '../../../types/bridge';
import { BrandBridge } from '../../../components/motion-brew/brand-bridge';
import { systemProxyResource } from '../../../modules/app/vpr-resources';
import {
  BRIDGE_HARNESSES,
  COMING_SOON_APPS,
  VprToolsView,
  partitionActiveProfiles,
} from './VprToolsView';
import stylesTools from './VprToolsView.module.scss';
import {
  ActionRequiredSection,
  VprHomeView,
  buildActionRequiredItems,
} from './VprHomeView';
import { SidebarDiagnostics } from '../torve/SidebarDiagnostics';
import { SearchModal } from '../../../components/motion-brew/search-modal';

function makeProfile(overrides: Partial<SystemProxyProfileSummary> & Pick<SystemProxyProfileSummary, 'name' | 'displayName'>): SystemProxyProfileSummary {
  return {
    kind: 'config-patch',
    method: 'config-patch',
    domains: [],
    installed: true,
    ...overrides,
  };
}

function makeAccount(connected: boolean): TorveAccountStatus {
  return {
    connected,
    authMode: connected ? 'oauth' : null,
    email: connected ? 'dev@torveai.com' : null,
    keyHint: connected ? 'sk-trv-••••' : null,
    keyMeta: null,
    userMeta: connected ? { id: 'u1', email: 'dev@torveai.com', name: 'Dev', plan: 'pro', status: 'active' } : null,
    updatedAt: null,
    secureStorage: true,
  };
}

function collectButtonHandlers(node: ReactNode, out: Map<string, () => void> = new Map()): Map<string, () => void> {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(child)) continue;
    if (child.type === 'button' && typeof child.props.onClick === 'function') {
      const label = renderToStaticMarkup(child)
        .replace(/<[^>]+>/g, '')
        .replaceAll('&amp;', '&')
        .trim();
      out.set(label, child.props.onClick);
    }
    if (child.props.children) {
      collectButtonHandlers(child.props.children, out);
    }
  }
  return out;
}

beforeEach(() => {
  systemProxyResource.setData({ profiles: [], state: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('VprToolsView & BrandBridge 6-app UX', () => {
  it('exposes ONLY the 6 active apps with exact distinct labels in BRIDGE_HARNESSES', () => {
    expect(BRIDGE_HARNESSES.map((h) => ({ id: h.id, name: h.name }))).toEqual([
      { id: 'antigravity', name: 'Google Antigravity' },
      { id: 'codex', name: 'Codex' },
      { id: 'opencode', name: 'OpenCode' },
      { id: 'claude-desktop', name: 'Claude Desktop' },
      { id: 'claude-code', name: 'Claude Code CLI' },
      { id: 'gemini-cli', name: 'Gemini CLI' },
    ]);
  });

  it('dims and disables not-installed harnesses in BrandBridge with "Not installed" tooltip', () => {
    const brands = BRIDGE_HARNESSES.map((h) => ({
      ...h,
      installed: h.id === 'codex' || h.id === 'opencode',
    }));

    const markup = renderToStaticMarkup(
      <BrandBridge brands={brands} connectedIds={['codex']} autoplay={false} />,
    );

    expect(markup).toContain('aria-label="Codex, connected"');
    expect(markup).toContain('aria-label="OpenCode, not connected"');
    expect(markup).toContain('aria-label="Gemini CLI, not installed"');
    expect(markup).toContain('title="Not installed"');
    expect(markup).toContain('cursor-not-allowed');
    expect(markup).toContain('opacity-40');
  });

  it('partitions installed vs Not Installed profiles and disables controls on Not Installed cards', () => {
    const profiles: SystemProxyProfileSummary[] = [
      makeProfile({ name: 'antigravity', displayName: 'Antigravity', installed: false }),
      makeProfile({ name: 'codex', displayName: 'Codex', installed: true }),
      makeProfile({ name: 'opencode', displayName: 'OpenCode', installed: true }),
      makeProfile({ name: 'claude-desktop', displayName: 'Claude Desktop', installed: true }),
      makeProfile({ name: 'claude-code', displayName: 'Claude Code', installed: false }),
      makeProfile({ name: 'gemini-cli', displayName: 'Gemini CLI', installed: false }),
      // Legacy profiles must be excluded completely
      makeProfile({ name: 'zed', displayName: 'Zed', installed: true }),
      makeProfile({ name: 'goose', displayName: 'Goose', installed: true }),
      makeProfile({ name: 'hermes', displayName: 'Hermes Agent', installed: true }),
      makeProfile({ name: 'droid', displayName: 'Droid', installed: true }),
      makeProfile({ name: 'crush', displayName: 'Crush', installed: true }),
      makeProfile({ name: 'pi', displayName: 'Pi', installed: true }),
      makeProfile({ name: 'gooeypi', displayName: 'GooeyPi', installed: true }),
      makeProfile({ name: 't3code', displayName: 'T3 Code', installed: true }),
    ];

    const { installedProfiles, notInstalledProfiles } = partitionActiveProfiles(
      profiles,
      new Set(['opencode']),
    );
    expect(installedProfiles.map((p) => p.name)).toEqual(['opencode', 'codex', 'claude-desktop']);
    expect(notInstalledProfiles.map((p) => p.name)).toEqual(['antigravity', 'claude-code', 'gemini-cli']);

    const markup = renderToStaticMarkup(
      <VprToolsView
        initialSnapshot={{
          profiles,
          activeProfileNames: ['opencode'],
          cloudConnected: true,
          cloudModels: [{ id: 'claude-sonnet-4-5' }],
        }}
      />,
    );

    // Distinct active labels & preserved </> Code badge
    expect(markup).toContain('Google Antigravity');
    expect(markup).toContain('Claude Desktop');
    expect(markup).toContain('&lt;/&gt; Code');
    expect(markup).toContain('Claude Code CLI');
    expect(markup).toContain('Gemini CLI');

    // Legacy niche apps & custom MITM / Add custom app UI are absent
    for (const legacy of ['Zed', 'Goose', 'Hermes Agent', 'Droid', 'Crush', 'GooeyPi', 'T3 Code', 'Add custom app', 'HTTPS certificate']) {
      expect(markup).not.toContain(legacy);
    }

    // Collapsible Not Installed section & unavailable styling/disabled tooltips
    expect(markup).toContain('Not Installed (3)');
    expect(markup).toContain(stylesTools.appPillUnavailable);
    expect(markup).toContain('Not Installed</span>');
    expect(markup).toContain('title="Install Claude Code CLI first, then click Refresh Apps"');
    expect(markup).toContain('title="Install Gemini CLI first, then click Refresh Apps"');
    expect(markup).toContain('title="Install Google Antigravity first, then click Refresh Apps"');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*title="Install Claude Code CLI first, then click Refresh Apps"[^>]*>Connect<\/button>/);

    // Compact Coming Soon section with exact 4 apps
    expect(COMING_SOON_APPS.map((a) => a.name)).toEqual([
      'Cursor',
      'Cline / Roo Code',
      'Aider',
      'Continue',
    ]);
    expect(markup).toContain('Coming Soon');
    expect(markup).toContain('Cursor');
    expect(markup).toContain('Cline / Roo Code');
    expect(markup).toContain('Aider');
    expect(markup).toContain('Continue');
  });
});

describe('VprHomeView Action Required notification center', () => {
  it('shows "All systems healthy" pill and hides Action Required card when 0 items need attention', () => {
    const markup = renderToStaticMarkup(
      <VprHomeView
        initialSnapshot={{
          account: makeAccount(true),
          proxyStatus: { running: true, port: 8378, upstream: 'https://api.torveai.com' },
          connectedApps: ['codex'],
          profiles: [makeProfile({ name: 'codex', displayName: 'Codex', needsRestart: false, needsRefresh: false })],
          antigravityStatus: {
            state: 'active',
            installed: true,
            enabled: true,
            running: false,
            version: '1.0.0',
            targetPath: '/Applications/Antigravity.app',
            message: 'Active',
          },
        }}
      />,
    );

    expect(markup).toContain('All systems healthy');
    expect(markup).not.toContain('Action Required');
  });

  it('renders Required action notifications for disconnected account, stopped proxy, Antigravity picker, Restart, and Refresh', () => {
    const agStatus: AntigravityStandalonePatchStatus = {
      state: 'needs-reapply',
      installed: true,
      enabled: false,
      running: true,
      version: '1.0.0',
      targetPath: '/Applications/Antigravity.app',
      message: 'Close Antigravity',
    };

    const markup = renderToStaticMarkup(
      <VprHomeView
        initialSnapshot={{
          account: makeAccount(true),
          proxyStatus: { running: false, port: 8378, upstream: 'https://api.torveai.com' },
          connectedApps: ['antigravity', 'codex', 'opencode'],
          profiles: [
            makeProfile({ name: 'codex', displayName: 'Codex', needsRestart: true }),
            makeProfile({ name: 'opencode', displayName: 'OpenCode', needsRefresh: true }),
          ],
          antigravityStatus: agStatus,
        }}
      />,
    );

    expect(markup).toContain('Action Required');
    expect(markup).toContain('Required');
    expect(markup).toContain('Local proxy stopped on 127.0.0.1:8378');
    expect(markup).toContain('Start Proxy');
    expect(markup).toContain('Antigravity requires restart/re-apply for Native Model Picker');
    expect(markup).toContain('Restart &amp; Apply');
    expect(markup).toContain('Codex needs a restart to load updated Torve models');
    expect(markup).toContain('>Restart</button>');
    expect(markup).toContain('OpenCode model list needs refresh');
    expect(markup).toContain('>Refresh</button>');
    expect(markup).not.toContain('All systems healthy');

    const signedOutMarkup = renderToStaticMarkup(
      <VprHomeView
        initialSnapshot={{
          account: makeAccount(false),
          proxyStatus: { running: true, port: 8378, upstream: 'https://api.torveai.com' },
          connectedApps: [],
          profiles: [],
        }}
      />,
    );
    expect(signedOutMarkup).toContain('Torve account sign-in required');
    expect(signedOutMarkup).toContain('Sign In');
  });

  it('invokes 1-click Restart, Refresh, Restart & Apply, Sign In, and Start Proxy callbacks', async () => {
    const onSignIn = vi.fn();
    const onStartProxy = vi.fn();
    const onRestartAndApplyAntigravity = vi.fn();
    const onRestartApp = vi.fn();
    const onRefreshApp = vi.fn();

    const items = buildActionRequiredItems({
      account: makeAccount(false),
      authError: { message: 'Session expired' },
      proxyStatus: { running: false, port: 8378, upstream: 'https://api.torveai.com' },
      connectedApps: ['antigravity', 'codex', 'opencode'],
      profiles: [
        makeProfile({ name: 'codex', displayName: 'Codex', needsRestart: true }),
        makeProfile({ name: 'opencode', displayName: 'OpenCode', needsRefresh: true }),
      ],
      antigravityStatus: {
        state: 'close-antigravity',
        installed: true,
        enabled: false,
        running: true,
        version: '1.0.0',
        targetPath: '/Applications/Antigravity.app',
        message: 'Running',
      },
      onSignIn,
      onStartProxy,
      onRestartAndApplyAntigravity,
      onRestartApp,
      onRefreshApp,
    });

    const element = ActionRequiredSection({ items });
    const handlers = collectButtonHandlers(element);

    expect(Array.from(handlers.keys())).toEqual(['Sign In', 'Restart & Apply', 'Restart', 'Refresh']);

    await handlers.get('Sign In')?.();
    await handlers.get('Restart & Apply')?.();
    await handlers.get('Restart')?.();
    await handlers.get('Refresh')?.();

    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(onRestartAndApplyAntigravity).toHaveBeenCalledTimes(1);
    expect(onRestartApp).toHaveBeenCalledWith(expect.objectContaining({ name: 'codex' }));
    expect(onRefreshApp).toHaveBeenCalledWith(expect.objectContaining({ name: 'opencode' }));

    // Verify Start Proxy appears when signed in and proxy is stopped
    const proxyItems = buildActionRequiredItems({
      account: makeAccount(true),
      authError: null,
      proxyStatus: { running: false, port: 8378, upstream: 'https://api.torveai.com' },
      connectedApps: [],
      profiles: [],
      antigravityStatus: null,
      onSignIn,
      onStartProxy,
      onRestartAndApplyAntigravity,
      onRestartApp,
      onRefreshApp,
    });
    const proxyHandlers = collectButtonHandlers(ActionRequiredSection({ items: proxyItems }));
    await proxyHandlers.get('Start Proxy')?.();
    expect(onStartProxy).toHaveBeenCalledTimes(1);
  });
});

describe('Overview Click-to-Connect Hero, Unlimited Telemetry, Sidebar Diagnostics & SearchModal', () => {
  it('renders Click to Connect bridge hero at the top of Overview and hides fake 80% / Reference cap for Unlimited plans', () => {
    const markup = renderToStaticMarkup(
      <VprHomeView
        initialSnapshot={{
          account: {
            ...makeAccount(true),
            userMeta: {
              id: 'u1',
              email: 'dev@torveai.com',
              name: 'Jisun Ahamed',
              plan: 'team',
              status: 'active',
            },
          },
          me: {
            user: {
              id: 'u1',
              email: 'dev@torveai.com',
              name: 'Jisun Ahamed',
              plan: 'team',
              status: 'active',
            },
            key: {
              id: 'k1',
              name: 'Torve Desktop (DESKTOP-T5P7KLG)',
              prefix: 'sk-trv-Ds20r8lg6V0',
              createdAt: '2026-11-01T00:00:00Z',
            },
            quota: {
              usedTokensToday: 8_793_239,
              usedRequestsToday: 412,
              monthlyUsedTokens: 12_400_000,
              monthlyUsedRequests: 1_240,
              dailyTokenLimit: null,
              dailyRequestLimit: null,
              monthlyAllowanceTokens: null,
              monthlyAllowanceRequests: null,
              resetsAt: null,
              rateLimitStatus: 'ok',
            },
          },
          proxyStatus: { running: true, port: 8378, upstream: 'https://api.torveai.com' },
          connectedApps: ['opencode'],
          profiles: [
            makeProfile({ name: 'antigravity', displayName: 'Google Antigravity' }),
            makeProfile({ name: 'codex', displayName: 'Codex' }),
            makeProfile({ name: 'opencode', displayName: 'OpenCode' }),
          ],
        }}
      />,
    );

    expect(markup).toContain('Click to Connect');
    expect(markup).toContain('1/6');
    expect(markup).toContain('Unlimited Plan');
    expect(markup).toContain('Unlimited');
    expect(markup).not.toContain('Reference cap');
    expect(markup).not.toContain('80%');
    expect(markup).not.toContain('Manage Keys');

    const signedOutHome = renderToStaticMarkup(
      <VprHomeView
        initialSnapshot={{
          account: makeAccount(false),
          proxyStatus: { running: true, port: 8378, upstream: 'https://api.torveai.com' },
          connectedApps: [],
          profiles: [],
        }}
      />,
    );
    expect(signedOutHome).toContain('Sign in to Torve Desktop');
    expect(signedOutHome).toContain('Ready After Sign-In');
    expect(signedOutHome).not.toContain('CLICK TO CONNECT');
  });

  it('shows real monthly percentage when monthlyAllowanceTokens is finite', () => {
    const markup = renderToStaticMarkup(
      <VprHomeView
        initialSnapshot={{
          account: makeAccount(true),
          me: {
            user: {
              id: 'u1',
              email: 'dev@torveai.com',
              name: 'Pro User',
              plan: 'pro',
              status: 'active',
            },
            key: {
              id: 'k2',
              name: 'Pro Desktop Key',
              prefix: 'sk-trv-pro123',
              createdAt: '2026-11-01T00:00:00Z',
            },
            quota: {
              usedTokensToday: 500_000,
              usedRequestsToday: 42,
              monthlyUsedTokens: 2_500_000,
              monthlyUsedRequests: 240,
              dailyTokenLimit: null,
              dailyRequestLimit: null,
              monthlyAllowanceTokens: 10_000_000,
              monthlyAllowanceRequests: null,
              resetsAt: '2026-12-01T00:00:00Z',
              rateLimitStatus: 'ok',
            },
          },
          proxyStatus: { running: true, port: 8378, upstream: 'https://api.torveai.com' },
          connectedApps: [],
          profiles: [],
        }}
      />,
    );

    expect(markup).toContain('25% of your plan');
    expect(markup).toContain('Monthly allowance');
    expect(markup).not.toContain('Reference cap');
  });

  it('renders account and proxy diagnostics cleanly inside SidebarDiagnostics', () => {
    const expanded = renderToStaticMarkup(
      <SidebarDiagnostics
        collapsed={false}
        proxyActive={true}
        proxyPort={8378}
        connected={true}
        planLabel="TEAM"
        statusLabel="active"
        keyName="Torve Desktop (DESKTOP-T5P7KLG)"
        keyPrefix="sk-trv-Ds20r8lg6V0"
        authMode="oauth"
        healthy={true}
        refreshing={false}
        signOutBusy={false}
        onRefresh={() => {}}
        onCopyProxy={() => {}}
        onManageKeys={() => {}}
        onSignOut={() => {}}
        onSignIn={() => {}}
        onOpenOverview={() => {}}
      />,
    );

    expect(expanded).toContain('127.0.0.1:8378');
    expect(expanded).toContain('DESKTOP');
    expect(expanded).toContain('All systems healthy');
    expect(expanded).toContain('TEAM');
    expect(expanded).toContain('ACTIVE');
    expect(expanded).toContain('Torve Desktop (DESKTOP-T5P7KLG)');
    expect(expanded).toContain('sk-trv-Ds20r8lg6V0');
    expect(expanded).toContain('Browser PKCE');
    expect(expanded).toContain('Keys');
    expect(expanded).toContain('Sign Out');

    const collapsed = renderToStaticMarkup(
      <SidebarDiagnostics
        collapsed={true}
        proxyActive={true}
        proxyPort={8378}
        connected={true}
        planLabel="TEAM"
        statusLabel="active"
        keyName="Torve Desktop"
        keyPrefix="sk-trv-Ds20r8lg6V0"
        authMode="oauth"
        healthy={true}
        refreshing={false}
        signOutBusy={false}
        onRefresh={() => {}}
        onCopyProxy={() => {}}
        onManageKeys={() => {}}
        onSignOut={() => {}}
        onSignIn={() => {}}
        onOpenOverview={() => {}}
      />,
    );
    expect(collapsed).toContain('Local proxy 127.0.0.1:8378');
  });

  it('renders SearchModal combobox with recent item target and Ctrl+K hints', () => {
    const markup = renderToStaticMarkup(
      <SearchModal
        items={[
          { id: 'app:opencode', group: 'Apps', title: 'OpenCode', meta: 'Connected' },
          { id: 'nav:home', group: 'Navigation', title: 'Overview', meta: 'View' },
        ]}
        groups={['Navigation', 'Apps']}
        recent={['app:opencode', 'nav:home']}
        actions={[{ id: 'action:home', label: 'Overview', icon: 'chart', key: '1' }]}
      />,
    );
    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('app:opencode');
    expect(markup).toContain('>Ctrl<');
    expect(markup).toContain('>K<');
  });
});
