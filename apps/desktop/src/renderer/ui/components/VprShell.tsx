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
import { TorveMark } from './brand/TorveMark';
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
  if (view === 'model') return 'Model Details';
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
      };
    }
    return {
      name: 'Not signed in',
      email: 'Sign in on Overview',
    };
  }, [accountStatus]);

  const sidebarValue = activeView === 'model' ? 'explore' : activeView;

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
        <span className={`${styles.statusItem} ${proxyActive ? styles.statusOk : styles.statusMuted}`}>
          <span className={`${styles.statusDot} ${proxyActive ? styles.statusDotOk : styles.statusDotOff}`} />
          Proxy 127.0.0.1:{proxyPort} ({proxyActive ? 'Active' : 'Stopped'})
        </span>
        <span className={styles.statusSep} aria-hidden="true">|</span>
        <span className={styles.statusItem}>
          <span
            className={`${styles.statusDot} ${connectedAppsCount > 0 ? styles.statusDotLime : styles.statusDotOff}`}
          />
          {connectedAppsCount} {connectedAppsCount === 1 ? 'App' : 'Apps'} Connected
        </span>
        <span className={styles.statusSep} aria-hidden="true">|</span>
        <span className={styles.statusItem}>
          <span>{accountStatus?.connected ? (accountStatus.email ?? 'Signed in') : 'Not signed in'}</span>
          {accountStatus?.connected && planName && (
            <span className={styles.planBadge}>{planName}</span>
          )}
        </span>
        <span className={styles.statusSpacer} />
        <span className={styles.statusItem}>Torve Desktop v{appVersion}</span>
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
