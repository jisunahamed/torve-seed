import { useCallback, useDeferredValue, useEffect, useId, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowReloadHorizontalIcon, Copy01Icon, Search01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { MixChart, type MixPoint, type MixSeries } from '../../../components/motion-brew/mix-chart';
import { ChannelMix, type ChannelMixChannel, type ChannelMixMetric } from '../../../components/motion-brew/channel-mix';
import type { TorveUsageRange, TorveUsageResponse, TorveUsageScope } from '../../../types/bridge';
import type { ViewName } from '../../types';
import { useTorveToast } from '../torve/TorveToastContext';
import styles from './VprExploreView.module.scss';

type Props = { onSelectView?: (view: ViewName) => void };

type CatalogModel = {
  id: string;
  name?: string;
  display_name?: string;
  tier?: string;
  context_window?: number;
  max_output_tokens?: number;
  supports_tools?: boolean;
  supports_reasoning?: boolean;
};

const USAGE_SERIES: MixSeries[] = [
  { key: 'input', label: 'Input Tokens', color: '#D8FF0A' },
  { key: 'output', label: 'Output Tokens', color: '#14FF73' },
];

const APP_PALETTE = ['#D8FF0A', '#14FF73', '#38BDF8', '#A78BFA', '#FB923C'];

const RANGE_OPTIONS: ReadonlyArray<{ id: TorveUsageRange; label: string }> = [
  { id: '24h', label: '24h' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
];

const SCOPE_OPTIONS: ReadonlyArray<{ id: TorveUsageScope | 'local'; label: string }> = [
  { id: 'account', label: 'Account' },
  { id: 'key', label: 'This Key' },
  { id: 'local', label: 'This Device Local' },
];

const APP_DISPLAY_NAMES: Record<string, string> = {
  codex: 'Codex',
  opencode: 'OpenCode',
  antigravity: 'Antigravity',
  claude: 'Claude',
  'claude-code': 'Claude Code',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
  cline: 'Cline',
  aider: 'Aider',
  'torve-desktop': 'Torve Desktop',
};

function formatAppLabel(appId: string): string {
  const key = appId.trim().toLowerCase();
  if (APP_DISPLAY_NAMES[key]) return APP_DISPLAY_NAMES[key];
  return appId
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || appId;
}

function shortModelLabel(modelId: string): string {
  const stripped = modelId.includes('/') ? modelId.split('/').pop() ?? modelId : modelId;
  return stripped.length > 14 ? `${stripped.slice(0, 13)}…` : stripped;
}

function formatCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatContextCount(n: number | undefined): string | null {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function LiquidSegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
}) {
  const uid = useId();
  const still = !!useReducedMotion();

  return (
    <div className={styles.segmented} role="tablist" aria-label={label}>
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`${styles.segBtn}${active ? ` ${styles.segBtnActive}` : ''}`}
            onClick={() => onChange(opt.id)}
          >
            {active ? (
              <motion.span
                layoutId={`${uid}-pill`}
                transition={still ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 38 }}
                className={styles.segPill}
                aria-hidden
              />
            ) : null}
            <span className={styles.segLabel}>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function VprExploreView(_props: Props) {
  const toast = useTorveToast();
  const [range, setRange] = useState<TorveUsageRange>('7d');
  const [scope, setScope] = useState<TorveUsageScope | 'local'>('account');
  const [usage, setUsage] = useState<TorveUsageResponse | null>(null);
  const [usageFallback, setUsageFallback] = useState<string | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  const [models, setModels] = useState<CatalogModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const loadUsage = useCallback(async (nextRange: TorveUsageRange, nextScope: TorveUsageScope | 'local', notify = false) => {
    const bridge = typeof window !== 'undefined' ? window.torveDesktop : undefined;
    if (!bridge?.torveUsageGet) return;
    setUsageLoading(true);
    try {
      const res = await bridge.torveUsageGet({ range: nextRange, scope: nextScope });
      if (res?.usage) setUsage(res.usage);
      setUsageFallback(res?.fallback ? (res.error || 'Showing local device ledger (offline fallback).') : null);
      if (notify) {
        toast.push({
          kind: res?.fallback ? 'warning' : 'success',
          title: 'Usage metrics refreshed',
          description: res?.fallback
            ? 'Showing local device ledger fallback.'
            : `Loaded ${nextRange} usage for ${SCOPE_OPTIONS.find((s) => s.id === nextScope)?.label ?? nextScope}.`,
          duration: 3000,
        });
      }
    } catch (err) {
      if (notify) {
        toast.push({
          kind: 'error',
          title: 'Could not refresh usage',
          description: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      setUsageLoading(false);
    }
  }, [toast]);

  const loadModels = useCallback(async (force = false) => {
    const bridge = typeof window !== 'undefined' ? window.torveDesktop : undefined;
    if (!bridge) return;
    setModelsLoading(true);
    setCatalogError(null);
    try {
      if (force && bridge.torveModelsRefresh) {
        const res = await bridge.torveModelsRefresh();
        if (res && !res.ok) {
          const message = res.error || 'Failed to refresh models catalog.';
          setCatalogError(message);
          toast.push({
            kind: 'error',
            title: 'Models refresh failed',
            description: message,
          });
          return;
        }
      }
      const catalog = await bridge.torveModelsGet?.();
      const nextModels = catalog?.models ?? [];
      setModels(nextModels);
      if (force) {
        toast.push({
          kind: 'success',
          title: 'Models catalog refreshed',
          description: `${nextModels.length} ${nextModels.length === 1 ? 'model' : 'models'} synced from Torve Cloud.`,
          duration: 3000,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setCatalogError(message);
      if (force) {
        toast.push({
          kind: 'error',
          title: 'Models refresh failed',
          description: message,
        });
      }
    } finally {
      setModelsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadUsage(range, scope, false);
  }, [range, scope, loadUsage]);

  useEffect(() => {
    void loadModels(false);
    const bridge = typeof window !== 'undefined' ? window.torveDesktop : undefined;
    const unsubModels = bridge?.onTorveModelsUpdated?.((catalog) => {
      if (Array.isArray(catalog?.models)) setModels(catalog.models);
    });
    return () => { unsubModels?.(); };
  }, [loadModels]);

  const filteredModels = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => (
      m.id.toLowerCase().includes(q)
      || (m.name || '').toLowerCase().includes(q)
      || (m.display_name || '').toLowerCase().includes(q)
      || (m.tier || '').toLowerCase().includes(q)
    ));
  }, [models, deferredSearch]);

  const copyModelId = (id: string) => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
    void navigator.clipboard.writeText(id).then(() => {
      setCopiedId(id);
      toast.push({
        kind: 'success',
        title: 'Model ID copied',
        description: id,
        duration: 2400,
      });
      window.setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1500);
    }).catch(() => {
      toast.push({
        kind: 'error',
        title: 'Clipboard unavailable',
        description: `Could not copy ${id}.`,
      });
    });
  };

  const scopeLabel = SCOPE_OPTIONS.find((s) => s.id === scope)?.label ?? scope;

  const mixRanges = useMemo(() => {
    const sorted = [...(usage?.byModel ?? [])]
      .sort((a, b) => b.totalTokens - a.totalTokens || b.requests - a.requests)
      .slice(0, 6);

    const points: MixPoint[] = sorted.map((row) => ({
      label: shortModelLabel(row.modelId),
      detail: `${row.modelId} · ${row.requests.toLocaleString()} req`,
      values: [row.inputTokens, row.outputTokens],
    }));

    return [
      {
        id: `${range}-${scope}`,
        label: `${range} · ${scopeLabel}`,
        points,
        caption: sorted.length > 0
          ? `Top ${sorted.length} active ${sorted.length === 1 ? 'model' : 'models'} by input vs output tokens`
          : `No model token activity in ${range} (${scopeLabel.toLowerCase()})`,
      },
    ];
  }, [usage, range, scope, scopeLabel]);

  const channelMixData = useMemo(() => {
    const apps = [...(usage?.byApp ?? [])].sort(
      (a, b) => b.totalTokens - a.totalTokens || b.requests - a.requests,
    );
    const totalTokens = usage?.totals.totalTokens ?? 0;
    const inputTokens = usage?.totals.inputTokens ?? 0;
    const outputTokens = usage?.totals.outputTokens ?? 0;
    const totalRequests = usage?.totals.requests ?? 0;

    const channels: ChannelMixChannel[] = apps.map((row, idx) => ({
      name: formatAppLabel(row.appId),
      sessions: row.totalTokens > 0 ? row.totalTokens : row.requests,
      detail: `${row.requests.toLocaleString()} req · ${formatCompact(row.totalTokens)} tokens`,
      color: APP_PALETTE[idx % APP_PALETTE.length],
    }));

    const ioTotal = inputTokens + outputTokens;
    const inPct = ioTotal > 0 ? Math.round((inputTokens / ioTotal) * 100) : 0;
    const outPct = ioTotal > 0 ? 100 - inPct : 0;
    const ioValue = ioTotal > 0 ? `${inPct}% / ${outPct}%` : '0% / 0%';
    const ioDetail = ioTotal > 0
      ? `${formatCompact(inputTokens)} / ${formatCompact(outputTokens)}`
      : 'in / out';

    const metrics: ChannelMixMetric[] = [
      {
        label: 'Requests',
        value: totalRequests.toLocaleString(),
        detail: `${range} window`,
        icon: 'people',
      },
      {
        label: 'Input / Output',
        value: ioValue,
        detail: ioDetail,
        icon: 'time',
      },
      {
        label: 'Total Tokens',
        value: formatCompact(totalTokens),
        detail: scopeLabel,
        icon: 'money',
      },
    ];

    return { channels, metrics };
  }, [usage, range, scopeLabel]);

  return (
    <section className={styles.view} role="tabpanel" aria-label="Models and Usage">
      <div className={styles.container}>
        <header className={styles.topBar}>
          <div>
            <h1 className={styles.title}>Models &amp; Usage</h1>
            <p className={styles.subtitle}>Per-model token distribution, connected app mix, and the live /v1/models catalog</p>
          </div>
          <div className={styles.controls}>
            <LiquidSegmentedControl
              label="Usage time range"
              options={RANGE_OPTIONS}
              value={range}
              onChange={setRange}
            />
            <LiquidSegmentedControl
              label="Usage scope"
              options={SCOPE_OPTIONS}
              value={scope}
              onChange={setScope}
            />
            <button
              type="button"
              className={styles.refreshBtn}
              disabled={usageLoading}
              onClick={() => { void loadUsage(range, scope, true); }}
            >
              <HugeiconsIcon icon={ArrowReloadHorizontalIcon} size={14} strokeWidth={2} />
              <span>{usageLoading ? 'Loading…' : 'Refresh Usage'}</span>
            </button>
          </div>
        </header>

        {usageFallback ? <div className={styles.noticeBanner}>{usageFallback}</div> : null}

        <div className={styles.chartsGrid} aria-label="Usage analytics charts">
          <MixChart
            title="Model Token Mix"
            series={USAGE_SERIES}
            ranges={mixRanges}
            unit="tokens"
            decimals={0}
            emptyText="No model token activity recorded in this window yet."
          />
          <ChannelMix
            header={false}
            label={`App & Channel Mix (${range})`}
            info="Token and request distribution across connected coding apps in this scope and window."
            channels={channelMixData.channels}
            unit="tokens"
            formatValue={formatCompact}
            metrics={channelMixData.metrics}
            metricThirdHeader="Window"
            emptyText="No per-app requests recorded in this window yet."
          />
        </div>

        <section className={styles.card} aria-label="Usage breakdown by model">
          <div className={styles.cardHead}>
            <div>
              <h2 className={styles.cardTitle}>By Model</h2>
              <p className={styles.cardHint}>Detailed token, request, and latency ledger across active models</p>
            </div>
            <div className={styles.summaryStrip}>
              <span className={styles.summaryPill}>
                <span className={styles.summaryDotLime} />
                {(usage?.totals.requests ?? 0).toLocaleString()} req
              </span>
              <span className={styles.summaryPill}>
                <span className={styles.summaryDotGreen} />
                {formatCompact(usage?.totals.totalTokens ?? 0)} tokens
              </span>
            </div>
          </div>

          {usage && usage.byModel.length > 0 ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Requests</th>
                    <th>Input</th>
                    <th>Output</th>
                    <th>Total</th>
                    <th>Avg Latency</th>
                    <th>Last Used</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.byModel.map((row) => (
                    <tr key={row.modelId}>
                      <td className={styles.modelCell}>{row.modelId}</td>
                      <td>{row.requests.toLocaleString()}</td>
                      <td className={styles.inputCell}>{formatCompact(row.inputTokens)}</td>
                      <td className={styles.outputCell}>{formatCompact(row.outputTokens)}</td>
                      <td className={styles.totalCell}>{formatCompact(row.totalTokens)}</td>
                      <td>{row.avgLatencyMs !== null ? `${row.avgLatencyMs} ms` : '—'}</td>
                      <td className={styles.mutedCell}>{formatTime(row.lastUsedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.empty}>No model usage recorded in this window yet.</p>
          )}
        </section>

        <section className={styles.card} aria-label="Available models catalog">
          <div className={styles.cardHead}>
            <div>
              <h2 className={styles.cardTitle}>Available Models ({filteredModels.length})</h2>
              <p className={styles.cardHint}>Live capabilities and context limits from Torve Cloud</p>
            </div>
            <button
              type="button"
              className={styles.refreshBtn}
              disabled={modelsLoading}
              onClick={() => { void loadModels(true); }}
            >
              <HugeiconsIcon icon={ArrowReloadHorizontalIcon} size={14} strokeWidth={2} />
              <span>{modelsLoading ? 'Refreshing…' : 'Refresh Models'}</span>
            </button>
          </div>

          <div className={styles.searchRow}>
            <div className={styles.searchField}>
              <HugeiconsIcon icon={Search01Icon} size={15} strokeWidth={2} className={styles.searchIcon} />
              <input
                type="search"
                className={styles.searchInput}
                placeholder="Search models by name, id, or tier…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Search available Torve models"
              />
            </div>
          </div>

          {catalogError ? <div className={styles.noticeBanner}>{catalogError}</div> : null}

          {filteredModels.length > 0 ? (
            <div className={styles.catalogList}>
              {filteredModels.map((model) => {
                const displayName = model.name || model.display_name || model.id;
                const ctx = formatContextCount(model.context_window);
                const maxOut = formatContextCount(model.max_output_tokens);
                const tier = typeof model.tier === 'string' && model.tier.trim() ? model.tier.trim().toLowerCase() : null;
                const isCopied = copiedId === model.id;

                return (
                  <div key={model.id} className={styles.modelCard}>
                    <div className={styles.modelMain}>
                      <div className={styles.modelNameRow}>
                        <span className={styles.modelName}>{displayName}</span>
                        {tier ? (
                          <span className={`${styles.pill} ${tier === 'free' ? styles.tierFree : styles.tierPro}`}>
                            {tier}
                          </span>
                        ) : null}
                      </div>
                      <span className={styles.modelId}>{model.id}</span>
                    </div>

                    <div className={styles.pills}>
                      {ctx ? <span className={styles.pill}>{ctx} ctx</span> : null}
                      {maxOut ? <span className={styles.pill}>{maxOut} out</span> : null}
                      {model.supports_tools ? <span className={`${styles.pill} ${styles.pillFeature}`}>Tools</span> : null}
                      {model.supports_reasoning ? <span className={`${styles.pill} ${styles.pillFeature}`}>Reasoning</span> : null}
                      <button
                        type="button"
                        className={`${styles.copyBtn}${isCopied ? ` ${styles.copyBtnCopied}` : ''}`}
                        onClick={() => copyModelId(model.id)}
                        title="Copy model ID"
                      >
                        <HugeiconsIcon icon={isCopied ? Tick02Icon : Copy01Icon} size={13} strokeWidth={2} />
                        <span>{isCopied ? 'Copied' : 'Copy ID'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className={styles.empty}>
              {models.length === 0 ? 'Sign in to load available models from Torve Cloud.' : 'No models match your search.'}
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
