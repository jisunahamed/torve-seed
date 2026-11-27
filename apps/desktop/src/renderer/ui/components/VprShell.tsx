import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  SidebarNav,
  type SidebarIcon,
  type SidebarSection,
} from '../../components/motion-brew/sidebar-nav';
import {
  SearchModal,
  type SearchModalAction,
  type SearchModalItem,
} from '../../components/motion-brew/search-modal';
import type { SystemProxyProfileSummary, TorveAccountStatus } from '../../types/bridge';
import { VIEW_NAMES, type ViewName } from '../types';
import { getViewRegistryEntry, navViews } from './viewRegistry';
import { BrandIcon } from './brand/BrandIcon';
import { TorveMark } from './brand/TorveMark';
import { SidebarDiagnostics } from './torve/SidebarDiagnostics';
import { TorveToastProvider, useTorveToast } from './torve/TorveToastContext';
import { UpdateBanner } from './UpdateBanner';
import { VprNavContext } from './vpr/VprNavContext';
import styles from './VprShell.module.scss';

declare const __APP_VERSION__: string;

type VprShellProps = {
  activeView: ViewName;
  onSelectView: (view: ViewName) => void;
  onNavigateBack: (fallback: ViewName) => void;
  children: ReactNode;
};

type CatalogModelEntry = {
  id: string;
  name?: string;
  display_name?: string;
  tier?: string;
};

const mainNavEntries = navViews('main');
const bottomNavEntries = navViews('bottom');

const VIEW_SIDEBAR_ICON: Partial<Record<ViewName, SidebarIcon>> = {
  home: 'home',
  tools: 'apps',
  explore: 'explore',
  preferences: 'settings',
};

const SEARCH_ACTIONS: SearchModalAction[] = [
  { id: 'action:home', label: 'Overview', icon: 'chart', key: '1' },
  { id: 'action:tools', label: 'Connected Apps', icon: 'grid', key: '2' },
  { id: 'action:explore', label: 'Models & Usage', icon: 'compass', key: '3' },
  { id: 'action:preferences', label: 'Activity & Settings', icon: 'bookmark', key: '4' },
];

const ACTION_VIEW_MAP: Record<string, ViewName> = {
  'action:home': 'home',
  'action:tools': 'tools',
  'action:explore': 'explore',
  'action:preferences': 'preferences',
};

function resolveSidebarLabel(view: ViewName, fallback: string): string {
  return view === 'preferences' ? 'Activity & Settings' : fallback;
}

function formatViewTitle(view: ViewName): string {
  if (view === 'preferences') return 'Activity & Settings';
  return getViewRegistryEntry(view).nav?.label ?? 'Torve Desktop';
}

function VprShellInner({ activeView, onSelectView, onNavigateBack, children }: VprShellProps) {
  const toast = useTorveToast();
  const [appVersion, setAppVersion] = useState<string>(
    typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '',
  );
  const [proxyStatus, setProxyStatus] = useState<{ running: boolean; port: number } | null>(null);
  const [activeAppNames, setActiveAppNames] = useState<string[]>([]);
  const [availableApps, setAvailableApps] = useState<SystemProxyProfileSummary[]>([]);
  const [models, setModels] = useState<CatalogModelEntry[]>([]);
  const [accountStatus, setAccountStatus] = useState<TorveAccountStatus | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
  const [sidebarRefreshing, setSidebarRefreshing] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);

  useEffect(() => {
    const email = accountStatus?.email?.trim().toLowerCase();
    if (!email || typeof crypto === 'undefined' || !crypto.subtle) {
      setAvatarUrl(undefined);
      return;
    }
    let cancelled = false;
    const data = new TextEncoder().encode(email);
    void crypto.subtle.digest('SHA-256', data).then((buf) => {
      if (cancelled) return;
      const hash = Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      setAvatarUrl(`https://www.gravatar.com/avatar/${hash}?d=404&s=96`);
    }).catch(() => {
      if (!cancelled) setAvatarUrl(undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [accountStatus?.email]);

  useEffect(() => {
    window.torveDesktop?.getAppVersion?.().then(setAppVersion).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    const bridge = window.torveDesktop;

    const loadCatalogAndApps = async () => {
      try {
        const [profiles, catalog] = await Promise.all([
          bridge?.systemProxyListProfiles?.(),
          bridge?.torveModelsGet?.(),
        ]);
        if (cancelled) return;
        if (Array.isArray(profiles)) setAvailableApps(profiles);
        if (catalog && Array.isArray(catalog.models)) setModels(catalog.models);
      } catch {
        // Non-fatal: search modal will fall back to nav views.
      }
    };

    const poll = async () => {
      try {
        const [proxy, direct, account] = await Promise.all([
          bridge?.torveCloudProxyStatus?.(),
          bridge?.torveDirectState?.(),
          bridge?.torveAccountGet?.(),
        ]);
        if (cancelled) return;
        if (proxy) setProxyStatus({ running: Boolean(proxy.running), port: proxy.port || 8378 });
        if (direct && Array.isArray(direct.activeProfileNames)) {
          setActiveAppNames(direct.activeProfileNames);
        }
        if (account) setAccountStatus(account);
      } catch {
        // Keep last observed footer state on transient IPC errors.
      }
    };

    void poll();
    void loadCatalogAndApps();

    const unsubAuth = bridge?.onTorveAuthEvent?.(() => { void poll(); });
    const unsubModels = bridge?.onTorveModelsUpdated?.((catalog) => {
      if (!cancelled && Array.isArray(catalog?.models)) {
        setModels(catalog.models);
      }
    });
    const timer = window.setInterval(() => { void poll(); }, 5_000);

    return () => {
      cancelled = true;
      unsubAuth?.();
      unsubModels?.();
      window.clearInterval(timer);
    };
  }, []);

  const navValue = useMemo(
    () => ({ navigate: onSelectView, back: onNavigateBack }),
    [onSelectView, onNavigateBack],
  );

  const connectedAppsCount = activeAppNames.length;
  const proxyActive = Boolean(proxyStatus?.running);
  const proxyPort = proxyStatus?.port ?? 8378;
  const planName = accountStatus?.userMeta?.plan?.toUpperCase() ?? null;

  const sidebarSections = useMemo<SidebarSection[]>(() => [
    {
      label: 'Workspace',
      items: mainNavEntries.map(({ view, nav }) => ({
        id: view,
        label: resolveSidebarLabel(view, nav.label),
        icon: VIEW_SIDEBAR_ICON[view] ?? 'home',
        badge: view === 'tools' && connectedAppsCount > 0 ? connectedAppsCount : undefined,
      })),
    },
    {
      label: 'System',
      items: bottomNavEntries.map(({ view, nav }) => ({
        id: view,
        label: resolveSidebarLabel(view, nav.label),
        icon: VIEW_SIDEBAR_ICON[view] ?? 'settings',
      })),
    },
  ], [connectedAppsCount]);

  const sidebarUser = useMemo(() => {
    if (accountStatus?.connected) {
      return {
        name: accountStatus.userMeta?.name || accountStatus.email?.split('@')[0] || 'Torve Account',
        email: accountStatus.email ?? 'Connected',
        avatar: avatarUrl,
      };
    }
    return {
      name: 'Not signed in',
      email: 'Sign in on Overview',
    };
  }, [accountStatus, avatarUrl]);

  const sidebarValue = activeView;

  const { searchItems, modelIdBySearchId } = useMemo(() => {
    const activeSet = new Set(activeAppNames);
    const items: SearchModalItem[] = [];
    const modelMap = new Map<string, string>();

    for (const { view, nav } of [...mainNavEntries, ...bottomNavEntries]) {
      items.push({
        id: `nav:${view}`,
        group: 'Navigation',
        title: resolveSidebarLabel(view, nav.label),
        meta: view === 'tools' ? `${connectedAppsCount} connected` : 'View',
        tint: '#18181B',
      });
    }

    const seenApps = new Set<string>();
    for (const app of availableApps) {
      seenApps.add(app.name);
      const isConnected = activeSet.has(app.name);
      items.push({
        id: `app:${app.name}`,
        group: 'Apps',
        title: app.displayName || app.name,
        meta: isConnected ? 'Connected' : 'Available',
        icon: <BrandIcon name={app.name} hints={[app.displayName]} size={18} />,
        tint: '#18181B',
      });
    }
    for (const name of activeAppNames) {
      if (seenApps.has(name)) continue;
      items.push({
        id: `app:${name}`,
        group: 'Apps',
        title: name,
        meta: 'Connected',
        icon: <BrandIcon name={name} size={18} />,
        tint: '#18181B',
      });
    }

    for (const model of models) {
      const searchId = `model:${model.id}`;
      modelMap.set(searchId, model.id);
      items.push({
        id: searchId,
        group: 'Models',
        title: model.display_name || model.name || model.id,
        meta: model.tier ? `${model.id} · ${model.tier}` : model.id,
        icon: <BrandIcon name={model.id} hints={[model.display_name ?? model.name]} size={16} />,
        tint: '#18181B',
      });
    }

    return { searchItems: items, modelIdBySearchId: modelMap };
  }, [activeAppNames, availableApps, connectedAppsCount, models]);

  const handleSearchSelect = useCallback(
    (entry: SearchModalItem | SearchModalAction) => {
      if (entry.id.startsWith('action:')) {
        const view = ACTION_VIEW_MAP[entry.id];
        if (view) onSelectView(view);
        return;
      }

      if (entry.id.startsWith('nav:')) {
        const view = entry.id.slice(4);
        if ((VIEW_NAMES as readonly string[]).includes(view)) {
          onSelectView(view as ViewName);
        }
        return;
      }

      if (entry.id.startsWith('app:')) {
        onSelectView('tools');
        return;
      }

      const modelId = modelIdBySearchId.get(entry.id);
      if (modelId) {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          void navigator.clipboard
            .writeText(modelId)
            .then(() => {
              toast.push({
                kind: 'success',
                title: 'Copied model ID',
                description: modelId,
              });
            })
            .catch(() => {
              onSelectView('explore');
              toast.push({
                kind: 'info',
                title: 'Opened Models & Usage',
                description: modelId,
              });
            });
        } else {
          onSelectView('explore');
          toast.push({
            kind: 'info',
            title: 'Opened Models & Usage',
            description: modelId,
          });
        }
      }
    },
    [modelIdBySearchId, onSelectView, toast],
  );

  const handleCopyProxy = useCallback(() => {
    const url = `http://127.0.0.1:${proxyPort}`;
    void navigator.clipboard?.writeText(url).then(() => {
      toast.push({ kind: 'success', title: 'Copied local proxy URL', description: url, duration: 2500 });
    }).catch(() => {});
  }, [proxyPort, toast]);

  const handleSidebarRefresh = useCallback(async () => {
    const bridge = window.torveDesktop;
    if (!bridge || sidebarRefreshing) return;
    setSidebarRefreshing(true);
    try {
      const [proxy, direct, account] = await Promise.all([
        bridge.torveCloudProxyStatus?.(),
        bridge.torveDirectState?.(),
        bridge.torveAccountGet?.(),
        bridge.torveMeGet?.(),
      ]);
      if (proxy) setProxyStatus({ running: Boolean(proxy.running), port: proxy.port || 8378 });
      if (direct && Array.isArray(direct.activeProfileNames)) {
        setActiveAppNames(direct.activeProfileNames);
      }
      if (account) setAccountStatus(account);
      const port = proxy?.port ?? proxyPort;
      toast.push({
        kind: 'success',
        title: 'Status refreshed',
        description: account?.connected
          ? `Synced account and proxy status on 127.0.0.1:${port}.`
          : `Synced local proxy status on 127.0.0.1:${port}.`,
      });
    } catch (err) {
      toast.push({
        kind: 'error',
        title: 'Refresh failed',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSidebarRefreshing(false);
    }
  }, [proxyPort, sidebarRefreshing, toast]);

  const handleManageKeys = useCallback(() => {
    void window.torveDesktop?.openExternalUrl?.('https://torveai.com/dashboard/keys');
  }, []);

  const handleSidebarSignOut = useCallback(async () => {
    const bridge = window.torveDesktop;
    if (!bridge?.torveAccountClear || signOutBusy) return;
    setSignOutBusy(true);
    try {
      const res = await bridge.torveAccountClear();
      if (res && !res.ok) {
        throw new Error(res.error || 'Failed to sign out.');
      }
      setAccountStatus((prev) => (prev
        ? { ...prev, connected: false, authMode: null, email: null, keyHint: null, keyMeta: null, userMeta: null, updatedAt: null }
        : null));
      setActiveAppNames([]);
      toast.push({ kind: 'info', title: 'Signed out', description: 'Disconnected your Torve Desktop session.' });
      onSelectView('home');
    } catch (err) {
      toast.push({
        kind: 'error',
        title: 'Sign out failed',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSignOutBusy(false);
    }
  }, [onSelectView, signOutBusy, toast]);

  const handleSidebarSignIn = useCallback(() => {
    void window.torveDesktop?.torveAccountPkceStart?.().catch(() => {});
    onSelectView('home');
  }, [onSelectView]);

  return (
    <div className={styles.shell}>
      <div className={styles.dragStrip} aria-hidden="true" />
      <div className={styles.sidebarSlot}>
        <SidebarNav
          brand="TORVE"
          logo={<TorveMark size={28} />}
          sections={sidebarSections}
          value={sidebarValue}
          defaultCollapsed={false}
          mobile="sidebar"
          user={sidebarUser}
          diagnostics={(collapsed) => (
            <SidebarDiagnostics
              collapsed={collapsed}
              proxyActive={proxyActive}
              proxyPort={proxyPort}
              connected={Boolean(accountStatus?.connected)}
              planLabel={planName}
              statusLabel={accountStatus?.userMeta?.status ?? null}
              keyName={accountStatus?.keyMeta?.name ?? null}
              keyPrefix={accountStatus?.keyMeta?.prefix ?? accountStatus?.keyHint ?? null}
              authMode={accountStatus?.authMode ?? null}
              healthy={Boolean(accountStatus?.connected && proxyActive)}
              refreshing={sidebarRefreshing}
              signOutBusy={signOutBusy}
              onRefresh={() => { void handleSidebarRefresh(); }}
              onCopyProxy={handleCopyProxy}
              onManageKeys={handleManageKeys}
              onSignOut={() => { void handleSidebarSignOut(); }}
              onSignIn={handleSidebarSignIn}
              onOpenOverview={() => onSelectView('home')}
            />
          )}
          onNavigate={(id) => {
            if ((VIEW_NAMES as readonly string[]).includes(id)) {
              onSelectView(id as ViewName);
            }
          }}
          onSettings={() => onSelectView('preferences')}
          className="flex-1 min-h-0 rounded-none border-0"
        />
      </div>
      <main className={styles.mainPane}>
        <header className={styles.topBar}>
          <div className={styles.topBarLeft}>
            <span className={styles.topBarTitle}>{formatViewTitle(activeView)}</span>
            <span className={`${styles.topBarPill} ${proxyActive ? styles.topBarPillActive : ''}`}>
              <span className={`${styles.statusDot} ${proxyActive ? styles.statusDotOk : styles.statusDotOff}`} />
              127.0.0.1:{proxyPort}
            </span>
          </div>
          <div className={styles.topBarActions}>
            <SearchModal
              modal
              items={searchItems}
              groups={['Navigation', 'Apps', 'Models']}
              recent={['nav:home', 'nav:tools', 'nav:explore', 'nav:preferences']}
              actions={SEARCH_ACTIONS}
              placeholder="Search views, apps, models…"
              examples={['claude', 'cursor', 'gpt', 'overview', 'settings']}
              onSelect={handleSearchSelect}
              className="h-8 w-56 text-[12px]"
            />
          </div>
        </header>
        <UpdateBanner />
        <div className={styles.content}>
          <VprNavContext.Provider value={navValue}>{children}</VprNavContext.Provider>
        </div>
      </main>
      <footer className={styles.statusStrip}>
        <button
          type="button"
          className={`${styles.statusBtn} ${proxyActive ? styles.statusOk : styles.statusMuted}`}
          title="Click to copy local proxy endpoint"
          onClick={() => {
            const url = `http://127.0.0.1:${proxyPort}`;
            void navigator.clipboard?.writeText(url).then(() => {
              toast.push({ kind: 'success', title: 'Copied proxy URL', description: url, duration: 2500 });
            }).catch(() => {});
          }}
        >
          <span className={`${styles.statusDot} ${proxyActive ? styles.statusDotOk : styles.statusDotOff}`} />
          <span className={styles.statusMono}>127.0.0.1:{proxyPort}</span>
          <span>({proxyActive ? 'Active' : 'Stopped'})</span>
        </button>
        <span className={styles.statusSep} aria-hidden="true">|</span>
        <button
          type="button"
          className={styles.statusBtn}
          onClick={() => onSelectView('tools')}
        >
          <span
            className={`${styles.statusDot} ${connectedAppsCount > 0 ? styles.statusDotLime : styles.statusDotOff}`}
          />
          <span>{connectedAppsCount} {connectedAppsCount === 1 ? 'App' : 'Apps'}</span>
        </button>
        {accountStatus?.connected && planName && (
          <>
            <span className={styles.statusSep} aria-hidden="true">|</span>
            <span className={styles.planBadge}>{planName}</span>
          </>
        )}
        <span className={styles.statusSpacer} />
        <span className={`${styles.statusItem} ${styles.statusMono}`}>v{appVersion}</span>
      </footer>
    </div>
  );
}

export function VprShell(props: VprShellProps) {
  return (
    <TorveToastProvider>
      <VprShellInner {...props} />
    </TorveToastProvider>
  );
}
