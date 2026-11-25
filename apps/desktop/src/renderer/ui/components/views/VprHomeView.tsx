import { useCallback, useEffect, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowReloadHorizontalIcon, ArrowRight02Icon } from '@hugeicons/core-free-icons';
import type {
  TorveAccountStatus,
  TorveDesktopMeResponse,
  TorveUsageResponse,
} from '../../../types/bridge';
import type { ViewName } from '../../types';
import { TorveMark } from '../brand/TorveMark';
import { TorveAuthCard } from '../torve/TorveAuthCard';
import styles from './VprHomeView.module.scss';

type Props = { onSelectView?: (view: ViewName) => void };

function formatCompact(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatResetTime(resetsAt: string | null): string {
  if (!resetsAt) return 'Daily UTC reset';
  const parsed = new Date(resetsAt);
  if (Number.isNaN(parsed.getTime())) return resetsAt;
  return parsed.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function VprHomeView({ onSelectView }: Props) {
  const [account, setAccount] = useState<TorveAccountStatus | null>(null);
  const [me, setMe] = useState<TorveDesktopMeResponse | null>(null);
  const [proxyStatus, setProxyStatus] = useState<{ running: boolean; port: number; upstream: string } | null>(null);
  const [connectedApps, setConnectedApps] = useState<string[]>([]);
  const [usage7d, setUsage7d] = useState<TorveUsageResponse | null>(null);
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name?: string }>>([]);
  const [pkcePending, setPkcePending] = useState(false);
  const [authError, setAuthError] = useState<{ message: string; statusCode?: number; code?: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadAll = useCallback(async () => {
    const bridge = window.torveDesktop;
    if (!bridge) return;
    setRefreshing(true);
    try {
      const [acct, meRes, proxy, direct, usageRes, catalog] = await Promise.all([
        bridge.torveAccountGet?.(),
        bridge.torveMeGet?.(),
        bridge.torveCloudProxyStatus?.(),
        bridge.torveDirectState?.(),
        bridge.torveUsageGet?.({ range: '7d', scope: 'account' }),
        bridge.torveModelsGet?.(),
      ]);
      if (acct) setAccount(acct);
      if (meRes) setMe(meRes.me ?? null);
      if (proxy) setProxyStatus(proxy);
      if (direct?.activeProfileNames) setConnectedApps(direct.activeProfileNames);
      if (usageRes?.usage) setUsage7d(usageRes.usage);
      if (catalog?.models) setAvailableModels(catalog.models);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
    const unsubAuth = window.torveDesktop?.onTorveAuthEvent?.((event) => {
      if (event.status === 'pending') {
        setPkcePending(true);
        setAuthError(null);
      } else if (event.status === 'connected') {
        setPkcePending(false);
        setAuthError(null);
        if (event.accountStatus) setAccount(event.accountStatus);
        if (event.me !== undefined) setMe(event.me);
        void loadAll();
      } else if (event.status === 'cancelled') {
        setPkcePending(false);
      } else if (event.status === 'error') {
        setPkcePending(false);
        setAuthError({
          message: event.error || 'Authentication failed.',
          statusCode: event.statusCode,
          code: event.code,
        });
      }
    });
    return () => { unsubAuth?.(); };
  }, [loadAll]);

  const handlePkceStart = async () => {
    setAuthError(null);
    const res = await window.torveDesktop?.torveAccountPkceStart?.();
    if (res && !res.ok) {
      setAuthError({ message: res.error || 'Could not start browser sign-in.' });
    }
  };

  const handlePkceCancel = async () => {
    await window.torveDesktop?.torveAccountPkceCancel?.();
    setPkcePending(false);
  };

  const handleManualConnect = async (apiKey: string) => {
    const res = await window.torveDesktop?.torveAccountSet?.({ apiKey });
    if (!res?.ok) {
      throw new Error(res?.error || 'Could not validate API key.');
    }
    if (res.status) setAccount(res.status);
    if (res.me !== undefined) setMe(res.me);
    setAuthError(null);
    void loadAll();
  };

  const handleSignOut = async () => {
    const res = await window.torveDesktop?.torveAccountClear?.();
    if (res && !res.ok) {
      throw new Error(res.error || 'Failed to sign out.');
    }
    setAccount((prev) => prev
      ? { ...prev, connected: false, authMode: null, email: null, keyHint: null, keyMeta: null, userMeta: null, updatedAt: null }
      : null);
    setMe(null);
    setConnectedApps([]);
    void loadAll();
  };

  const quota = me?.quota ?? null;
  const monthlyAllowance = quota?.monthlyAllowanceTokens ?? null;
  const monthlyUsed = quota?.monthlyUsedTokens ?? null;
  const monthlyPct = monthlyAllowance && monthlyAllowance > 0 && monthlyUsed !== null
    ? Math.min(100, Math.round((monthlyUsed / monthlyAllowance) * 100))
    : null;
  const rateLimited = quota?.rateLimitStatus?.toLowerCase() === 'limited';
  const topModels = (usage7d?.byModel ?? []).slice(0, 4);

  return (
    <section className={styles.view} role="tabpanel" aria-label="Overview">
      <div className={styles.container}>
        <header className={styles.topBar}>
          <div className={styles.heading}>
            <TorveMark size={30} />
            <div>
              <h1 className={styles.headingTitle}>Torve Desktop</h1>
              <div className={styles.headingSub}>Direct Cloud AI Router · 127.0.0.1:{proxyStatus?.port ?? 8378}</div>
            </div>
          </div>
          <button
            type="button"
            className={styles.refreshBtn}
            onClick={() => { void loadAll(); }}
            disabled={refreshing}
          >
            <HugeiconsIcon icon={ArrowReloadHorizontalIcon} size={14} strokeWidth={2} />
            <span>{refreshing ? 'Refreshing…' : 'Refresh'}</span>
          </button>
        </header>

        <TorveAuthCard
          account={account}
          me={me}
          pkcePending={pkcePending}
          authError={authError}
          onPkceStart={handlePkceStart}
          onPkceCancel={handlePkceCancel}
          onManualConnect={handleManualConnect}
          onSignOut={handleSignOut}
        />

        {account?.connected && quota ? (
          <section className={styles.card} aria-label="Quota and allowance">
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>Quota &amp; Allowance</h2>
              <span className={rateLimited ? styles.badgeWarn : styles.badgeOk}>
                {rateLimited ? 'Rate Limited' : quota.rateLimitStatus || 'ok'}
              </span>
            </div>

            <div className={styles.quotaGrid}>
              <div className={styles.statBox}>
                <span className={styles.statLabel}>Tokens Used Today</span>
                <span className={styles.statValue}>{formatCompact(quota.usedTokensToday)}</span>
                {quota.dailyTokenLimit ? (
                  <div className={styles.statSub}>of {formatCompact(quota.dailyTokenLimit)} daily limit</div>
                ) : null}
              </div>
              <div className={styles.statBox}>
                <span className={styles.statLabel}>Requests Today</span>
                <span className={styles.statValue}>{quota.usedRequestsToday.toLocaleString()}</span>
                {quota.dailyRequestLimit ? (
                  <div className={styles.statSub}>of {quota.dailyRequestLimit.toLocaleString()} daily limit</div>
                ) : null}
              </div>
              <div className={styles.statBox}>
                <span className={styles.statLabel}>Resets At</span>
                <span className={styles.statValue} style={{ fontSize: 14 }}>
                  {formatResetTime(quota.resetsAt)}
                </span>
              </div>
            </div>

            {monthlyPct !== null && monthlyAllowance ? (
              <div className={styles.progressWrap}>
                <div className={styles.progressHeader}>
                  <span>Monthly Package Allowance</span>
                  <span>
                    {formatCompact(monthlyUsed)} / {formatCompact(monthlyAllowance)} ({monthlyPct}%)
                  </span>
                </div>
                <div className={styles.progressTrack} role="progressbar" aria-valuenow={monthlyPct} aria-valuemin={0} aria-valuemax={100}>
                  <div className={styles.progressFill} style={{ width: `${monthlyPct}%` }} />
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        <div className={styles.cardsGrid}>
          <section className={styles.card}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>Local Proxy</h2>
              <span className={proxyStatus?.running ? styles.badgeOk : styles.badgeWarn}>
                {proxyStatus?.running ? 'Active' : 'Stopped'}
              </span>
            </div>
            <div className={styles.statValue} style={{ fontSize: 15 }}>
              http://127.0.0.1:{proxyStatus?.port ?? 8378}
            </div>
            <div className={styles.statSub}>
              Upstream: {proxyStatus?.upstream || 'https://api.torveai.com'}
            </div>
          </section>

          <section className={styles.card}>
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle}>Connected Apps ({connectedApps.length})</h2>
              {onSelectView ? (
                <button type="button" className={styles.linkBtn} onClick={() => onSelectView('tools')}>
                  <span>Manage</span>
                  <HugeiconsIcon icon={ArrowRight02Icon} size={13} strokeWidth={2} />
                </button>
              ) : null}
            </div>
            {connectedApps.length > 0 ? (
              <div className={styles.pillList}>
                {connectedApps.map((name) => (
                  <span key={name} className={styles.pill}>{name}</span>
                ))}
              </div>
            ) : (
              <div className={styles.statSub}>
                No harnesses toggled on yet. Enable Codex, Claude Desktop, OpenCode, or Antigravity in Connected Apps.
              </div>
            )}
          </section>
        </div>

        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>
              {topModels.length > 0 ? 'Top Used Models (7d)' : `Available Torve Models (${availableModels.length})`}
            </h2>
            {onSelectView ? (
              <button type="button" className={styles.linkBtn} onClick={() => onSelectView('explore')}>
                <span>Models &amp; Usage</span>
                <HugeiconsIcon icon={ArrowRight02Icon} size={13} strokeWidth={2} />
              </button>
            ) : null}
          </div>
          {topModels.length > 0 ? (
            <div className={styles.modelList}>
              {topModels.map((row) => (
                <div key={row.modelId} className={styles.modelRow}>
                  <span className={styles.modelId}>{row.modelId}</span>
                  <span className={styles.modelMeta}>
                    {row.requests.toLocaleString()} req · {formatCompact(row.totalTokens)} tok
                  </span>
                </div>
              ))}
            </div>
          ) : availableModels.length > 0 ? (
            <div className={styles.modelList}>
              {availableModels.slice(0, 4).map((m) => (
                <div key={m.id} className={styles.modelRow}>
                  <span className={styles.modelId}>{m.name || m.id}</span>
                  <span className={styles.modelMeta}>{m.id}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.statSub}>Sign in to load your usage and available models.</div>
          )}
        </section>
      </div>
    </section>
  );
}
