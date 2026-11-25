import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowReloadHorizontalIcon, Copy01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import type { TorveUsageRange, TorveUsageResponse, TorveUsageScope } from '../../../types/bridge';
import type { ViewName } from '../../types';
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

export function VprExploreView(_props: Props) {
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

  const loadUsage = useCallback(async (nextRange: TorveUsageRange, nextScope: TorveUsageScope | 'local') => {
    const bridge = window.torveDesktop;
    if (!bridge?.torveUsageGet) return;
    setUsageLoading(true);
    try {
      const res = await bridge.torveUsageGet({ range: nextRange, scope: nextScope });
      if (res?.usage) setUsage(res.usage);
      setUsageFallback(res?.fallback ? (res.error || 'Showing local device ledger (offline fallback).') : null);
    } finally {
      setUsageLoading(false);
    }
  }, []);

  const loadModels = useCallback(async (force = false) => {
    const bridge = window.torveDesktop;
    if (!bridge) return;
    setModelsLoading(true);
    setCatalogError(null);
    try {
      if (force && bridge.torveModelsRefresh) {
        const res = await bridge.torveModelsRefresh();
        if (res && !res.ok) setCatalogError(res.error || 'Failed to refresh models catalog.');
      }
      const catalog = await bridge.torveModelsGet?.();
      setModels(catalog?.models ?? []);
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : String(err));
    } finally {
      setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsage(range, scope);
  }, [range, scope, loadUsage]);

  useEffect(() => {
    void loadModels(false);
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
    void navigator.clipboard.writeText(id).then(() => {
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1500);
    });
  };

  return (
    <section className={styles.view} role="tabpanel" aria-label="Models and Usage">
      <div className={styles.container}>
        <header className={styles.topBar}>
          <div>
            <h1 className={styles.title}>Models &amp; Usage</h1>
            <p className={styles.subtitle}>Per-model usage metrics from Torve Cloud and the live /v1/models catalog</p>
          </div>
          <div className={styles.controls}>
            <div className={styles.segmented} role="group" aria-label="Usage time range">
              {(['24h', '7d', '30d'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`${styles.segBtn}${range === r ? ` ${styles.segBtnActive}` : ''}`}
                  onClick={() => setRange(r)}
                >
                  {r}
                </button>
              ))}
            </div>
            <div className={styles.segmented} role="group" aria-label="Usage scope">
              {([
                { id: 'account', label: 'Account' },
                { id: 'key', label: 'This Key' },
                { id: 'local', label: 'This Device Local' },
              ] as const).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`${styles.segBtn}${scope === s.id ? ` ${styles.segBtnActive}` : ''}`}
                  onClick={() => setScope(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={styles.refreshBtn}
              disabled={usageLoading}
              onClick={() => { void loadUsage(range, scope); }}
            >
              <HugeiconsIcon icon={ArrowReloadHorizontalIcon} size={14} strokeWidth={2} />
              <span>{usageLoading ? 'Loading…' : 'Refresh Usage'}</span>
            </button>
          </div>
        </header>

        <section className={styles.card} aria-label="Usage summary">
          {usageFallback ? <div className={styles.noticeBanner}>{usageFallback}</div> : null}

          <div className={styles.totalsGrid}>
            <div className={styles.statBox}>
              <span className={styles.statLabel}>Requests ({range})</span>
              <span className={styles.statValue}>{(usage?.totals.requests ?? 0).toLocaleString()}</span>
            </div>
            <div className={styles.statBox}>
              <span className={styles.statLabel}>Input Tokens</span>
              <span className={styles.statValue}>{formatCompact(usage?.totals.inputTokens ?? 0)}</span>
            </div>
            <div className={styles.statBox}>
              <span className={styles.statLabel}>Output Tokens</span>
              <span className={styles.statValue}>{formatCompact(usage?.totals.outputTokens ?? 0)}</span>
            </div>
            <div className={styles.statBox}>
              <span className={styles.statLabel}>Total Tokens</span>
              <span className={styles.statValue}>{formatCompact(usage?.totals.totalTokens ?? 0)}</span>
            </div>
          </div>

          <h2 className={styles.cardTitle}>By Model</h2>
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
                      <td>{row.modelId}</td>
                      <td>{row.requests.toLocaleString()}</td>
                      <td>{formatCompact(row.inputTokens)}</td>
                      <td>{formatCompact(row.outputTokens)}</td>
                      <td>{formatCompact(row.totalTokens)}</td>
                      <td>{row.avgLatencyMs !== null ? `${row.avgLatencyMs} ms` : '—'}</td>
                      <td>{formatTime(row.lastUsedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.empty}>No model usage recorded in this window yet.</p>
          )}

          <h2 className={styles.cardTitle}>By App</h2>
          {usage && usage.byApp.length > 0 ? (
            <div className={styles.appBreakdownGrid}>
              {usage.byApp.map((appRow) => (
                <div key={appRow.appId} className={styles.appChip}>
                  <span className={styles.appChipName}>{appRow.appId}</span>
                  <span className={styles.appChipMeta}>
                    {appRow.requests.toLocaleString()} req · {formatCompact(appRow.totalTokens)} tokens
                  </span>
                  <span className={styles.appChipMeta}>Last: {formatTime(appRow.lastUsedAt)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.empty}>No per-app requests in this window yet.</p>
          )}
        </section>

        <section className={styles.card} aria-label="Available models catalog">
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>Available Models ({filteredModels.length})</h2>
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
            <input
              type="search"
              className={styles.searchInput}
              placeholder="Search models by name, id, or tier…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search available Torve models"
            />
          </div>

          {catalogError ? <div className={styles.noticeBanner}>{catalogError}</div> : null}

          {filteredModels.length > 0 ? (
            <div className={styles.catalogList}>
              {filteredModels.map((model) => {
                const displayName = model.name || model.display_name || model.id;
                const ctx = formatContextCount(model.context_window);
                const maxOut = formatContextCount(model.max_output_tokens);
                const tier = typeof model.tier === 'string' && model.tier.trim() ? model.tier.trim().toLowerCase() : null;

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
                      {model.supports_tools ? <span className={styles.pill}>Tools</span> : null}
                      {model.supports_reasoning ? <span className={styles.pill}>Reasoning</span> : null}
                      <button
                        type="button"
                        className={styles.copyBtn}
                        onClick={() => copyModelId(model.id)}
                        title="Copy model ID"
                      >
                        <HugeiconsIcon icon={copiedId === model.id ? Tick02Icon : Copy01Icon} size={13} strokeWidth={2} />
                        <span>{copiedId === model.id ? 'Copied' : 'Copy ID'}</span>
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
