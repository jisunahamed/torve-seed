import { useCallback, useEffect, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowReloadHorizontalIcon, ArrowRight02Icon } from '@hugeicons/core-free-icons';
import type {
  TorveAccountStatus,
  TorveDesktopMeResponse,
  TorveUsageResponse,
} from '../../../types/bridge';
import type { ViewName } from '../../types';
import { QuotaGauge } from '../../../components/motion-brew/quota-gauge';
import { UsageRing, type UsageMetric } from '../../../components/motion-brew/usage-ring';
import { TorveMark, TorveWordmark } from '../brand/TorveMark';
import { TorveAuthCard } from '../torve/TorveAuthCard';
import { useTorveToast } from '../torve/TorveToastContext';
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

function resolveGoal(used: number, limit: number | null | undefined, fallback: number): number {
  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
    return limit;
  }
  const safeUsed = Math.max(0, used);
  if (safeUsed <= fallback) return fallback;
  return Math.max(fallback, Math.ceil((safeUsed * 1.25) / fallback) * fallback);
}

export function VprHomeView({ onSelectView }: Props) {
  const toast = useTorveToast();
  const [account, setAccount] = useState<TorveAccountStatus | null>(null);
  const [me, setMe] = useState<TorveDesktopMeResponse | null>(null);
  const [proxyStatus, setProxyStatus] = useState<{ running: boolean; port: number; upstream: string } | null>(null);
  const [connectedApps, setConnectedApps] = useState<string[]>([]);
  const [usage7d, setUsage7d] = useState<TorveUsageResponse | null>(null);
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name?: string }>>([]);
  const [pkcePending, setPkcePending] = useState(false);
  const [authError, setAuthError] = useState<{ message: string; statusCode?: number; code?: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadAll = useCallback(async (notify = false) => {
    const bridge = typeof window !== 'undefined' ? window.torveDesktop : undefined;
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

      if (notify) {
        const port = proxy?.port ?? 8378;
        toast.push({
          kind: 'success',
          title: 'Overview refreshed',
          description: acct?.connected
            ? `Synced account quota and proxy status on 127.0.0.1:${port}.`
            : `Synced local proxy status on 127.0.0.1:${port}.`,
        });
      }
    } catch (err) {
      if (notify) {
        toast.push({
          kind: 'error',
          title: 'Refresh failed',
          description: err instanceof Error ? err.message : 'Could not refresh Torve overview.',
        });
      }
    } finally {
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadAll(false);
    const unsubAuth = typeof window !== 'undefined'
      ? window.torveDesktop?.onTorveAuthEvent?.((event) => {
          if (event.status === 'pending') {
            setPkcePending(true);
            setAuthError(null);
          } else if (event.status === 'connected') {
            setPkcePending(false);
            setAuthError(null);
            if (event.accountStatus) setAccount(event.accountStatus);
            if (event.me !== undefined) setMe(event.me);
            void loadAll(false);
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
        })
      : undefined;
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
    void loadAll(false);
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
    void loadAll(false);
  };

  const quota = me?.quota ?? null;
  const proxyPort = proxyStatus?.port ?? 8378;
  const rateLimited = quota?.rateLimitStatus?.toLowerCase() === 'limited';
  const topModels = (usage7d?.byModel ?? []).slice(0, 4);

  const ringMetrics: UsageMetric[] = quota
    ? [
        {
          label: 'Daily Tokens',
          value: quota.usedTokensToday,
          goal: resolveGoal(quota.usedTokensToday, quota.dailyTokenLimit, 100_000),
          unit: quota.dailyTokenLimit ? 'tok' : 'tok (est)',
        },
        {
          label: 'Monthly Tokens',
          value: quota.monthlyUsedTokens ?? quota.usedTokensToday,
          goal: resolveGoal(
            quota.monthlyUsedTokens ?? quota.usedTokensToday,
            quota.monthlyAllowanceTokens,
            1_000_000,
          ),
          unit: quota.monthlyAllowanceTokens ? 'tok' : 'tok (est)',
        },
        {
          label: 'Requests Today',
          value: quota.usedRequestsToday,
          goal: resolveGoal(quota.usedRequestsToday, quota.dailyRequestLimit, 500),
          unit: quota.dailyRequestLimit ? 'req' : 'req (est)',
        },
      ]
    : [];

  const hasMonthlyAllowance =
    quota?.monthlyAllowanceTokens !== null &&
    quota?.monthlyAllowanceTokens !== undefined &&
    quota.monthlyAllowanceTokens > 0;
  const gaugeValue = quota
    ? hasMonthlyAllowance
      ? (quota.monthlyUsedTokens ?? 0)
      : quota.usedTokensToday
    : 0;
  const gaugeGoal = quota
    ? hasMonthlyAllowance
      ? quota.monthlyAllowanceTokens!
      : resolveGoal(quota.usedTokensToday, quota.dailyTokenLimit, 100_000)
    : 100_000;
  const gaugeUnit = hasMonthlyAllowance ? 'monthly tokens' : 'tokens today';
  const gaugeGoalLabel = hasMonthlyAllowance
    ? 'Monthly limit'
    : quota?.dailyTokenLimit
      ? 'Daily limit'
      : 'Reference cap';

  return (
    <section className={styles.view} role="tabpanel" aria-label="Overview">
      <div className={styles.container}>
        <header className={styles.topBar}>
          <div className={styles.heading}>
            <div className={styles.brandEmblem}>
              <TorveMark size={32} />
            </div>
            <div className={styles.headingCopy}>
              <div className={styles.wordmarkRow}>
                <TorveWordmark height={18} />
                <span className={styles.editionPill}>Desktop</span>
              </div>
              <div className={styles.headingSub}>Direct Cloud AI Router</div>
            </div>
          </div>

          <div className={styles.topActions}>
            <span
              className={`${styles.proxyPill} ${proxyStatus?.running ? styles.proxyPillActive : styles.proxyPillStopped}`}
              title={`Local proxy ${proxyStatus?.running ? 'running' : 'stopped'} on 127.0.0.1:${proxyPort}`}
            >
              <span className={styles.proxyDot} aria-hidden />
              <span>127.0.0.1:{proxyPort}</span>
            </span>
            <button
              type="button"
              className={styles.refreshBtn}
              onClick={() => { void loadAll(true); }}
              disabled={refreshing}
            >
              <HugeiconsIcon icon={ArrowReloadHorizontalIcon} size={14} strokeWidth={2} />
              <span>{refreshing ? 'Refreshing…' : 'Refresh'}</span>
            </button>
          </div>
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
          <section className={styles.telemetryGrid} aria-label="Quota and usage telemetry">
            <UsageRing
              title="Live Usage"
              metrics={ringMetrics}
              className="w-full flex flex-col justify-between"
            />
            <QuotaGauge
              value={gaugeValue}
              goal={gaugeGoal}
              unit={gaugeUnit}
              goalLabel={gaugeGoalLabel}
              className="w-full flex flex-col justify-between"
              header={(
                <div className={styles.gaugeHeader}>
                  <span className={styles.gaugeTitle}>Allowance &amp; Quota</span>
                  <span className={rateLimited ? styles.badgeCrit : styles.badgeOk}>
                    {rateLimited ? 'Rate Limited' : quota.rateLimitStatus || 'ok'}
                  </span>
                </div>
              )}
              footer={(
                <div className={styles.gaugeFooter}>
                  <span className={styles.gaugeResetLabel}>Resets</span>
                  <span className={styles.gaugeResetValue}>{formatResetTime(quota.resetsAt)}</span>
                </div>
              )}
            />
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
            <div
              className={styles.statBox}
              style={{ cursor: 'pointer' }}
              title="Click to copy local proxy URL"
              onClick={() => {
                const url = `http://127.0.0.1:${proxyPort}`;
                void navigator.clipboard?.writeText(url).then(() => {
                  toast.push({ kind: 'success', title: 'Copied local proxy URL', description: url, duration: 2500 });
                }).catch(() => {});
              }}
            >
              <div className={styles.statValue} style={{ fontSize: 15 }}>
                http://127.0.0.1:{proxyPort}
              </div>
              <div className={styles.statSub}>
                Upstream: {proxyStatus?.upstream || 'https://api.torveai.com'} · Click to copy
              </div>
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
                  <span key={name} className={styles.pill}>
                    <span className={styles.pillDot} aria-hidden />
                    {name}
                  </span>
                ))}
              </div>
            ) : (
              <div className={styles.emptyBox}>
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
            <div className={styles.emptyBox}>Sign in to load your usage and available models.</div>
          )}
        </section>
      </div>
    </section>
  );
}
