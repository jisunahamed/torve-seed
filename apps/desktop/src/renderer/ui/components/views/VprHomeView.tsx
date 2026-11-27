import { useCallback, useEffect, useMemo, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowReloadHorizontalIcon, ArrowRight02Icon } from '@hugeicons/core-free-icons';
import type {
  AntigravityStandalonePatchStatus,
  RuntimeProcessState,
  SystemProxyProfileSummary,
  TorveAccountStatus,
  TorveDesktopMeResponse,
  TorveUsageResponse,
} from '../../../types/bridge';
import type { ViewName } from '../../types';
import { BrandBridge } from '../../../components/motion-brew/brand-bridge';
import { QuotaGauge } from '../../../components/motion-brew/quota-gauge';
import { UsageRing, type UsageMetric } from '../../../components/motion-brew/usage-ring';
import { BrandIcon } from '../brand/BrandIcon';
import { TorveMark } from '../brand/TorveMark';
import { TorveAuthCard } from '../torve/TorveAuthCard';
import { useTorveToast } from '../torve/TorveToastContext';
import {
  ACTIVE_APP_DISPLAY_NAMES,
  buildBridgeHarnesses,
  getConnectedBridgeIds,
  useHarnessBridge,
} from '../torve/app-bridge';
import styles from './VprHomeView.module.scss';

export type ActionRequiredItem = {
  id: string;
  message: string;
  actionLabel: string;
  onAction: () => void | Promise<void>;
};

export type VprHomeViewSnapshot = {
  account?: TorveAccountStatus | null;
  me?: TorveDesktopMeResponse | null;
  proxyStatus?: { running: boolean; port: number; upstream: string } | null;
  connectedApps?: string[];
  profiles?: SystemProxyProfileSummary[];
  antigravityStatus?: AntigravityStandalonePatchStatus | null;
  usage7d?: TorveUsageResponse | null;
  availableModels?: Array<{ id: string; name?: string }>;
  authError?: { message: string; statusCode?: number; code?: string } | null;
};

type Props = {
  onSelectView?: (view: ViewName) => void;
  initialSnapshot?: VprHomeViewSnapshot;
};

function formatCompact(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatResetTime(resetsAt: string | null): string {
  if (!resetsAt) return 'Monthly billing cycle';
  const parsed = new Date(resetsAt);
  if (Number.isNaN(parsed.getTime())) return resetsAt;
  return parsed.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function buildActionRequiredItems(params: {
  account: TorveAccountStatus | null;
  authError: { message: string; statusCode?: number; code?: string } | null;
  proxyStatus: { running: boolean; port: number; upstream: string } | null;
  connectedApps: string[];
  profiles: SystemProxyProfileSummary[];
  antigravityStatus: AntigravityStandalonePatchStatus | null;
  onSignIn: () => void | Promise<void>;
  onStartProxy: () => void | Promise<void>;
  onRestartAndApplyAntigravity: () => void | Promise<void>;
  onRestartApp: (profile: SystemProxyProfileSummary) => void | Promise<void>;
  onRefreshApp: (profile: SystemProxyProfileSummary) => void | Promise<void>;
}): ActionRequiredItem[] {
  const {
    account,
    authError,
    proxyStatus,
    connectedApps,
    profiles,
    antigravityStatus,
    onSignIn,
    onStartProxy,
    onRestartAndApplyAntigravity,
    onRestartApp,
    onRefreshApp,
  } = params;

  const items: ActionRequiredItem[] = [];

  if (authError || (account !== null && !account.connected)) {
    items.push({
      id: 'auth-signin',
      message: authError?.message || 'Torve account sign-in required',
      actionLabel: 'Sign In',
      onAction: onSignIn,
    });
  }

  if (account?.connected && proxyStatus !== null && !proxyStatus.running) {
    items.push({
      id: 'proxy-stopped',
      message: `Local proxy stopped on 127.0.0.1:${proxyStatus.port ?? 8378}`,
      actionLabel: 'Start Proxy',
      onAction: onStartProxy,
    });
  }

  if (
    antigravityStatus
    && antigravityStatus.installed
    && !antigravityStatus.enabled
    && (
      antigravityStatus.running
      || antigravityStatus.state === 'needs-reapply'
      || antigravityStatus.state === 'close-antigravity'
      || connectedApps.includes('antigravity')
    )
  ) {
    items.push({
      id: 'antigravity-picker',
      message: 'Antigravity requires restart/re-apply for Native Model Picker',
      actionLabel: 'Restart & Apply',
      onAction: onRestartAndApplyAntigravity,
    });
  }

  for (const profile of profiles) {
    if (!connectedApps.includes(profile.name)) continue;
    if (profile.needsRestart) {
      items.push({
        id: `restart:${profile.name}`,
        message: `${profile.displayName} needs a restart to load updated Torve models`,
        actionLabel: 'Restart',
        onAction: () => onRestartApp(profile),
      });
    }
    if (profile.needsRefresh) {
      items.push({
        id: `refresh:${profile.name}`,
        message: `${profile.displayName} model list needs refresh`,
        actionLabel: 'Refresh',
        onAction: () => onRefreshApp(profile),
      });
    }
  }

  return items;
}

export function ActionRequiredSection({
  items,
  busyActionId,
}: {
  items: ActionRequiredItem[];
  busyActionId?: string | null;
}) {
  if (items.length === 0) {
    return (
      <div className={styles.healthyRow}>
        <span className={styles.healthyPill} role="status">
          <span className={styles.healthyDot} aria-hidden />
          <span>All systems healthy</span>
        </span>
      </div>
    );
  }

  return (
    <section className={styles.actionCard} aria-label="Action Required">
      <div className={styles.actionCardHead}>
        <div className={styles.actionCardTitleRow}>
          <h2 className={styles.actionCardTitle}>Action Required</h2>
          <span className={styles.requiredPill}>Required</span>
        </div>
        <span className={styles.actionCount}>
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </span>
      </div>
      <div className={styles.actionList}>
        {items.map((item) => {
          const isBusy = busyActionId === item.id;
          return (
            <div key={item.id} className={styles.actionRow}>
              <div className={styles.actionCopy}>
                <span className={styles.actionDot} aria-hidden />
                <span className={styles.actionMessage}>{item.message}</span>
              </div>
              <button
                type="button"
                className={styles.actionBtn}
                disabled={isBusy}
                onClick={() => { void item.onAction(); }}
              >
                {isBusy ? 'Working…' : item.actionLabel}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function VprHomeView({ onSelectView, initialSnapshot }: Props) {
  const toast = useTorveToast();
  const [account, setAccount] = useState<TorveAccountStatus | null>(initialSnapshot?.account ?? null);
  const [me, setMe] = useState<TorveDesktopMeResponse | null>(initialSnapshot?.me ?? null);
  const [proxyStatus, setProxyStatus] = useState<{ running: boolean; port: number; upstream: string } | null>(
    initialSnapshot?.proxyStatus ?? null,
  );
  const [proxyPeerId, setProxyPeerId] = useState<string | null>(null);
  const [connectedApps, setConnectedApps] = useState<string[]>(initialSnapshot?.connectedApps ?? []);
  const [profiles, setProfiles] = useState<SystemProxyProfileSummary[]>(initialSnapshot?.profiles ?? []);
  const [antigravityStatus, setAntigravityStatus] = useState<AntigravityStandalonePatchStatus | null>(
    initialSnapshot?.antigravityStatus ?? null,
  );
  const [usage7d, setUsage7d] = useState<TorveUsageResponse | null>(initialSnapshot?.usage7d ?? null);
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; name?: string }>>(
    initialSnapshot?.availableModels ?? [],
  );
  const [pkcePending, setPkcePending] = useState(false);
  const [authError, setAuthError] = useState<{ message: string; statusCode?: number; code?: string } | null>(
    initialSnapshot?.authError ?? null,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);

  const loadAll = useCallback(async (notify = false) => {
    const bridge = typeof window !== 'undefined' ? window.torveDesktop : undefined;
    if (!bridge) return;
    setRefreshing(true);
    try {
      const [acct, meRes, proxy, direct, usageRes, catalog, profileList, agStatus] = await Promise.all([
        bridge.torveAccountGet?.(),
        bridge.torveMeGet?.(),
        bridge.torveCloudProxyStatus?.(),
        bridge.torveDirectState?.(),
        bridge.torveUsageGet?.({ range: '7d', scope: 'account' }),
        bridge.torveModelsGet?.(),
        bridge.systemProxyListProfiles?.(),
        bridge.antigravityStandaloneStatus?.(),
      ]);
      if (acct) setAccount(acct);
      if (meRes) setMe(meRes.me ?? null);
      if (proxy) setProxyStatus(proxy);
      if (direct) {
        setProxyPeerId(direct.peerId ?? null);
        if (direct.activeProfileNames) setConnectedApps(direct.activeProfileNames);
      }
      if (usageRes?.usage) setUsage7d(usageRes.usage);
      if (catalog?.models) setAvailableModels(catalog.models);
      if (Array.isArray(profileList)) setProfiles(profileList);
      if (agStatus) setAntigravityStatus(agStatus);

      if (notify) {
        const port = proxy?.port ?? 8378;
        toast.push({
          kind: 'success',
          title: 'Overview refreshed',
          description: acct?.connected
            ? `Synced apps and telemetry on 127.0.0.1:${port}.`
            : `Synced local apps and proxy on 127.0.0.1:${port}.`,
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

  const handlePkceStart = useCallback(async () => {
    setAuthError(null);
    const res = await window.torveDesktop?.torveAccountPkceStart?.();
    if (res && !res.ok) {
      setAuthError({ message: res.error || 'Could not start browser sign-in.' });
    }
  }, []);

  const handlePkceCancel = useCallback(async () => {
    await window.torveDesktop?.torveAccountPkceCancel?.();
    setPkcePending(false);
  }, []);

  const handleManualConnect = useCallback(async (apiKey: string) => {
    const res = await window.torveDesktop?.torveAccountSet?.({ apiKey });
    if (!res?.ok) {
      throw new Error(res?.error || 'Could not validate API key.');
    }
    if (res.status) setAccount(res.status);
    if (res.me !== undefined) setMe(res.me);
    setAuthError(null);
    void loadAll(false);
  }, [loadAll]);

  const handleSignOut = useCallback(async () => {
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
  }, [loadAll]);

  const handleStartProxy = useCallback(async () => {
    setBusyActionId('proxy-stopped');
    try {
      const bridge = typeof window !== 'undefined' ? window.torveDesktop : undefined;
      if (bridge?.torveCloudProxyStart) {
        const res = await bridge.torveCloudProxyStart();
        if (res && !res.ok) {
          throw new Error(res.error || 'Unable to start local proxy.');
        }
        toast.push({
          kind: 'success',
          title: 'Local proxy started',
          description: `Listening on 127.0.0.1:${res?.port ?? proxyStatus?.port ?? 8378}.`,
        });
        await loadAll(false);
        return;
      }
      await loadAll(true);
    } catch (err) {
      toast.push({
        kind: 'error',
        title: 'Could not start proxy',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyActionId(null);
    }
  }, [loadAll, proxyStatus?.port, toast]);

  const handleRestartAndApplyAntigravity = useCallback(async () => {
    setBusyActionId('antigravity-picker');
    try {
      const bridge = typeof window !== 'undefined' ? window.torveDesktop : undefined;
      const running = Boolean(antigravityStatus?.running);
      const res = running
        ? await bridge?.antigravityStandaloneCloseAndEnable?.()
        : await bridge?.antigravityStandaloneSet?.(true);
      if (res?.status) setAntigravityStatus(res.status);
      if (res && !res.ok) {
        throw new Error(res.error || 'Unable to apply Google Antigravity Native Model Picker.');
      }
      toast.push({
        kind: 'success',
        title: 'Google Antigravity updated',
        description: 'Native Model Picker is now active.',
      });
      await loadAll(false);
    } catch (err) {
      toast.push({
        kind: 'error',
        title: 'Google Antigravity update failed',
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyActionId(null);
    }
  }, [antigravityStatus?.running, loadAll, toast]);

  const handleRestartApp = useCallback(async (profile: SystemProxyProfileSummary) => {
    const id = `restart:${profile.name}`;
    setBusyActionId(id);
    try {
      const bridge = typeof window !== 'undefined' ? window.torveDesktop : undefined;
      const res = await bridge?.torveAppRestart?.(profile.name);
      if (res && !res.ok) {
        throw new Error(res.error || `Unable to restart ${profile.displayName}.`);
      }
      toast.push({
        kind: res?.needsSessionRestart ? 'info' : 'success',
        title: res?.needsSessionRestart ? `${profile.displayName} verified` : `${profile.displayName} restarted`,
        description: res?.detail ?? `Restarted ${profile.displayName} with updated Torve models.`,
      });
      await loadAll(false);
    } catch (err) {
      toast.push({
        kind: 'error',
        title: `Could not restart ${profile.displayName}`,
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyActionId(null);
    }
  }, [loadAll, toast]);

  const handleRefreshApp = useCallback(async (profile: SystemProxyProfileSummary) => {
    const id = `refresh:${profile.name}`;
    setBusyActionId(id);
    try {
      const bridge = typeof window !== 'undefined' ? window.torveDesktop : undefined;
      const res = await bridge?.torveAppRefresh?.(profile.name);
      if (res && !res.ok) {
        throw new Error(res.error || `Unable to refresh ${profile.displayName}.`);
      }
      toast.push({
        kind: 'success',
        title: `${profile.displayName} refreshed`,
        description: res?.detail ?? `${profile.displayName} model list synced.`,
      });
      await loadAll(false);
    } catch (err) {
      toast.push({
        kind: 'error',
        title: `Could not refresh ${profile.displayName}`,
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusyActionId(null);
    }
  }, [loadAll, toast]);

  const activeSet = useMemo(() => new Set(connectedApps), [connectedApps]);
  const bridgeHarnesses = useMemo(() => buildBridgeHarnesses(profiles, activeSet), [activeSet, profiles]);
  const connectedBridgeIds = useMemo(() => getConnectedBridgeIds(connectedApps), [connectedApps]);

  const handleRuntimeStateUpdated = useCallback((state: RuntimeProcessState | null, nextNames: string[]) => {
    setProxyPeerId(typeof state?.peerId === 'string' ? state.peerId : null);
    setConnectedApps(nextNames);
  }, []);

  const handleSetAntigravityStatus = useCallback((status: AntigravityStandalonePatchStatus) => {
    setAntigravityStatus(status);
  }, []);

  const handleAfterStartSuccess = useCallback(() => {
    void loadAll(false);
  }, [loadAll]);

  const {
    activeProgressBanner,
    toggleBridgeHarness,
  } = useHarnessBridge({
    profiles,
    activeProfileNames: connectedApps,
    cloudConnected: account?.connected === true,
    proxyPeerId,
    antigravityPatch: antigravityStatus,
    setAntigravityPatch: handleSetAntigravityStatus,
    onRuntimeStateUpdated: handleRuntimeStateUpdated,
    onAfterStartSuccess: handleAfterStartSuccess,
    launchAfterConnect: false,
  });

  const actionItems = useMemo(() => buildActionRequiredItems({
    account,
    authError,
    proxyStatus,
    connectedApps,
    profiles,
    antigravityStatus,
    onSignIn: handlePkceStart,
    onStartProxy: handleStartProxy,
    onRestartAndApplyAntigravity: handleRestartAndApplyAntigravity,
    onRestartApp: handleRestartApp,
    onRefreshApp: handleRefreshApp,
  }), [
    account,
    antigravityStatus,
    authError,
    connectedApps,
    handlePkceStart,
    handleRefreshApp,
    handleRestartAndApplyAntigravity,
    handleRestartApp,
    handleStartProxy,
    profiles,
    proxyStatus,
  ]);

  const quota = me?.quota ?? null;
  const proxyPort = proxyStatus?.port ?? 8378;
  const rateLimited = quota?.rateLimitStatus?.toLowerCase() === 'limited';
  const topModels = (usage7d?.byModel ?? []).slice(0, 4);

  const hasMonthlyAllowance = typeof quota?.monthlyAllowanceTokens === 'number'
    && Number.isFinite(quota.monthlyAllowanceTokens)
    && quota.monthlyAllowanceTokens > 0;
  const hasDailyTokenLimit = typeof quota?.dailyTokenLimit === 'number'
    && Number.isFinite(quota.dailyTokenLimit)
    && quota.dailyTokenLimit > 0;
  const hasDailyRequestLimit = typeof quota?.dailyRequestLimit === 'number'
    && Number.isFinite(quota.dailyRequestLimit)
    && quota.dailyRequestLimit > 0;

  const ringMetrics: UsageMetric[] = quota
    ? [
        {
          label: 'Daily Tokens',
          value: quota.usedTokensToday,
          goal: hasDailyTokenLimit ? quota.dailyTokenLimit! : null,
          unit: 'tokens',
        },
        {
          label: 'Monthly Tokens',
          value: quota.monthlyUsedTokens ?? quota.usedTokensToday,
          goal: hasMonthlyAllowance ? quota.monthlyAllowanceTokens! : null,
          unit: 'tokens',
        },
        {
          label: 'Requests Today',
          value: quota.usedRequestsToday,
          goal: hasDailyRequestLimit ? quota.dailyRequestLimit! : null,
          unit: 'requests',
        },
      ]
    : [];

  const isUnlimitedPlan = !hasMonthlyAllowance && !hasDailyTokenLimit;
  const planName = (me?.user?.plan || account?.userMeta?.plan || '').toUpperCase();
  const gaugeValue = quota
    ? hasMonthlyAllowance
      ? (quota.monthlyUsedTokens ?? quota.usedTokensToday)
      : quota.usedTokensToday
    : 0;
  const gaugeGoal = hasMonthlyAllowance
    ? quota!.monthlyAllowanceTokens!
    : hasDailyTokenLimit
      ? quota!.dailyTokenLimit!
      : null;
  const gaugeUnit = hasMonthlyAllowance ? 'monthly tokens' : 'tokens today';
  const gaugeGoalLabel = hasMonthlyAllowance
    ? 'Monthly allowance'
    : hasDailyTokenLimit
      ? 'Daily limit'
      : planName
        ? `${planName} plan`
        : 'Unlimited plan';

  return (
    <section className={styles.view} role="tabpanel" aria-label="Overview">
      <div className={styles.container}>
        {account?.connected ? (
          <>
            <BrandBridge
              brands={bridgeHarnesses}
              connectedIds={connectedBridgeIds}
              autoplay={false}
              hub={<TorveMark size={36} />}
              title=""
              description=""
              header={(
                <div className={styles.bridgeHeader}>
                  <div className={styles.bridgeBadgeGroup}>
                    <span className={styles.clickToConnectPill}>
                      <span className={styles.clickToConnectDot} aria-hidden />
                      <span>Click to Connect</span>
                    </span>
                    <span className={styles.bridgeCount}>
                      Tap an icon to connect · {connectedBridgeIds.length}/{bridgeHarnesses.length}
                    </span>
                  </div>
                  <div className={styles.bridgeHeaderActions}>
                    <button
                      type="button"
                      className={styles.refreshBtn}
                      onClick={() => { void loadAll(true); }}
                      disabled={refreshing}
                    >
                      <HugeiconsIcon icon={ArrowReloadHorizontalIcon} size={13} strokeWidth={2} />
                      <span>{refreshing ? 'Refreshing…' : 'Refresh'}</span>
                    </button>
                    {onSelectView ? (
                      <button type="button" className={styles.linkBtn} onClick={() => onSelectView('tools')}>
                        <span>Configure Apps</span>
                        <HugeiconsIcon icon={ArrowRight02Icon} size={13} strokeWidth={2} />
                      </button>
                    ) : null}
                  </div>
                </div>
              )}
              onToggle={toggleBridgeHarness}
            />

            {activeProgressBanner ? (
              <div className={styles.bridgeProgressPill} role="status" aria-live="polite">
                <span className={styles.clickToConnectDot} aria-hidden />
                <span>{activeProgressBanner.label}</span>
              </div>
            ) : null}

            <ActionRequiredSection items={actionItems} busyActionId={busyActionId} />
          </>
        ) : (
          <>
            <ActionRequiredSection items={actionItems} busyActionId={busyActionId} />

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

            <section className={styles.card} aria-label="Supported harnesses">
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle}>Ready After Sign-In</h2>
                <span className={styles.bridgeCount}>6 apps supported</span>
              </div>
              <div className={styles.pillList}>
                {bridgeHarnesses.map((harness) => (
                  <span key={harness.id} className={styles.pill}>
                    <span className="inline-flex size-4 items-center justify-center">{harness.logo}</span>
                    <span>{harness.name}</span>
                  </span>
                ))}
              </div>
            </section>
          </>
        )}

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
              unlimited={isUnlimitedPlan}
              unit={gaugeUnit}
              goalLabel={gaugeGoalLabel}
              className="w-full flex flex-col justify-between"
              header={(
                <div className={styles.gaugeHeader}>
                  <span className={styles.gaugeTitle}>Allowance &amp; Plan</span>
                  <span className={rateLimited ? styles.badgeCrit : styles.badgeOk}>
                    {rateLimited ? 'Rate Limited' : isUnlimitedPlan ? 'Unlimited' : (quota.rateLimitStatus || 'ok')}
                  </span>
                </div>
              )}
              footer={(
                <div className={styles.gaugeFooter}>
                  <span className={styles.gaugeResetLabel}>
                    {hasMonthlyAllowance ? 'Resets' : 'Billing cycle'}
                  </span>
                  <span className={styles.gaugeResetValue}>{formatResetTime(quota.resetsAt)}</span>
                </div>
              )}
            />
          </section>
        ) : null}

        <div className={styles.cardsGrid}>
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
                {connectedApps.map((name) => {
                  const display = ACTIVE_APP_DISPLAY_NAMES[name]
                    ?? profiles.find((p) => p.name === name)?.displayName
                    ?? name;
                  return (
                    <span key={name} className={styles.pill}>
                      <span className={styles.pillDot} aria-hidden />
                      <span>{display}</span>
                    </span>
                  );
                })}
              </div>
            ) : (
              <div className={styles.emptyBox}>
                Click any installed app icon in the bridge above to route its AI traffic through Torve Cloud.
              </div>
            )}
          </section>

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
                  <span className={styles.modelIdentity}>
                    <BrandIcon name={row.modelId} size={16} />
                    <span className={styles.modelId}>{row.modelId}</span>
                  </span>
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
                  <span className={styles.modelIdentity}>
                    <BrandIcon name={m.id} hints={[m.name]} size={16} />
                    <span className={styles.modelId}>{m.name || m.id}</span>
                  </span>
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
