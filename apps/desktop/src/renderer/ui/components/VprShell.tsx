import { useEffect, useMemo, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import type { ViewName } from '../types';
import type { TorveAccountStatus } from '../../types/bridge';
import { navViews } from './viewRegistry';
import { TorveMark } from './brand/TorveMark';
import { UpdateBanner } from './UpdateBanner';
import { VprNavContext } from './vpr/VprNavContext';
import styles from './VprShell.module.scss';

declare const __APP_VERSION__: string;

type VprShellProps = {
  activeView: ViewName;
  onSelectView: (view: ViewName) => void;
  onNavigateBack: (fallback: ViewName) => void;
  children: React.ReactNode;
};

const mainNavEntries = navViews('main');
const bottomNavEntries = navViews('bottom');

export function VprShell({ activeView, onSelectView, onNavigateBack, children }: VprShellProps) {
  const [appVersion, setAppVersion] = useState<string>(
    typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '',
  );
  const [proxyStatus, setProxyStatus] = useState<{ running: boolean; port: number } | null>(null);
  const [connectedAppsCount, setConnectedAppsCount] = useState(0);
  const [accountStatus, setAccountStatus] = useState<TorveAccountStatus | null>(null);

  useEffect(() => {
    window.torveDesktop?.getAppVersion?.().then(setAppVersion).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    const bridge = window.torveDesktop;
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
          setConnectedAppsCount(direct.activeProfileNames.length);
        }
        if (account) setAccountStatus(account);
      } catch {
        // Keep last observed footer state on transient IPC errors.
      }
    };
    void poll();
    const unsubAuth = bridge?.onTorveAuthEvent?.(() => { void poll(); });
    const timer = window.setInterval(() => { void poll(); }, 5_000);
    return () => {
      cancelled = true;
      unsubAuth?.();
      window.clearInterval(timer);
    };
  }, []);

  const navValue = useMemo(
    () => ({ navigate: onSelectView, back: onNavigateBack }),
    [onSelectView, onNavigateBack],
  );

  const proxyActive = Boolean(proxyStatus?.running);
  const planBadge = accountStatus?.userMeta?.plan
    ? ` · ${accountStatus.userMeta.plan.toUpperCase()}`
    : '';

  return (
    <div className={styles.shell}>
      <div className={styles.dragStrip} aria-hidden="true" />
      <nav className={styles.sidebar} aria-label="Torve Desktop navigation">
        <div className={styles.brandSlot} title="Torve Desktop">
          <TorveMark size={30} />
          <span className={styles.brandText}>TORVE</span>
        </div>
        <div className={styles.navGroup}>
          {mainNavEntries.map(({ view, nav }) => {
            const active = activeView === view;
            return (
              <button
                key={view}
                type="button"
                className={`${styles.navButton}${active ? ` ${styles.navButtonActive}` : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => onSelectView(view)}
              >
                <HugeiconsIcon icon={nav.icon} size={22} strokeWidth={1.8} />
                <span className={styles.navLabel}>{nav.label}</span>
              </button>
            );
          })}
        </div>
        <div className={styles.navBottom}>
          {bottomNavEntries.map(({ view, nav }) => {
            const active = activeView === view;
            return (
              <button
                key={view}
                type="button"
                className={`${styles.navButton}${active ? ` ${styles.navButtonActive}` : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => onSelectView(view)}
              >
                <HugeiconsIcon icon={nav.icon} size={22} strokeWidth={1.8} />
                <span className={styles.navLabel}>{nav.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
      <main className={styles.mainPane}>
        <div className={styles.content}>
          <VprNavContext.Provider value={navValue}>{children}</VprNavContext.Provider>
        </div>
        <UpdateBanner />
      </main>
      <footer className={styles.statusStrip}>
        <span className={`${styles.statusItem} ${proxyActive ? styles.statusOk : styles.statusMuted}`}>
          <span className={`${styles.statusDot} ${proxyActive ? styles.statusDotOk : styles.statusDotOff}`} />
          Proxy 127.0.0.1:{proxyStatus?.port ?? 8378} ({proxyActive ? 'Active' : 'Stopped'})
        </span>
        <span className={styles.statusSep} aria-hidden="true">|</span>
        <span className={styles.statusItem}>
          {connectedAppsCount} {connectedAppsCount === 1 ? 'App' : 'Apps'} Connected
        </span>
        <span className={styles.statusSep} aria-hidden="true">|</span>
        <span className={styles.statusItem}>
          {accountStatus?.connected
            ? `${accountStatus.email ?? 'Signed in'}${planBadge}`
            : 'Not signed in'}
        </span>
        <span className={styles.statusSpacer} />
        <span className={styles.statusItem}>Torve Desktop v{appVersion}</span>
      </footer>
    </div>
  );
}
