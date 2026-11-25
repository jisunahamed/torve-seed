import { useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon, ArrowRight01Icon, ArrowUpRight01Icon } from '@hugeicons/core-free-icons';
import type { TorveAccountStatus, TorveDesktopMeResponse } from '../../../types/bridge';
import { TorveMark } from '../brand/TorveMark';
import styles from './TorveAuthCard.module.scss';

type Props = {
  account: TorveAccountStatus | null;
  me: TorveDesktopMeResponse | null;
  pkcePending: boolean;
  authError: { message: string; statusCode?: number; code?: string } | null;
  onPkceStart: () => Promise<void>;
  onPkceCancel: () => Promise<void>;
  onManualConnect: (apiKey: string) => Promise<void>;
  onSignOut: () => Promise<void>;
  compact?: boolean;
};

const DASHBOARD_KEYS_URL = 'https://torveai.com/dashboard/api-keys';

function planBadgeClass(plan: string | null | undefined): string {
  const normalized = (plan || '').toLowerCase();
  if (normalized === 'pro' || normalized === 'team' || normalized === 'enterprise') return styles.planPro;
  if (normalized === 'lite') return styles.planLite;
  if (normalized === 'free') return styles.planFree;
  return '';
}

export function TorveAuthCard({
  account,
  me,
  pkcePending,
  authError,
  onPkceStart,
  onPkceCancel,
  onManualConnect,
  onSignOut,
  compact = false,
}: Props) {
  const [manualOpen, setManualOpen] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [busy, setBusy] = useState<'pkce' | 'manual' | 'signout' | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const user = me?.user ?? account?.userMeta ?? null;
  const key = me?.key ?? account?.keyMeta ?? null;
  const activeError = localError || authError?.message || null;
  const isKeyLimitError = authError?.statusCode === 409 || /key limit/i.test(activeError ?? '');

  const handlePkce = async () => {
    setLocalError(null);
    setBusy('pkce');
    try {
      await onPkceStart();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleManualSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = apiKeyInput.trim();
    if (!trimmed) {
      setLocalError('Paste your Torve API key.');
      return;
    }
    if (/\s/.test(trimmed) || trimmed.length < 16) {
      setLocalError('Enter a valid sk-trv- API key without spaces.');
      return;
    }
    setLocalError(null);
    setBusy('manual');
    try {
      await onManualConnect(trimmed);
      setApiKeyInput('');
      setManualOpen(false);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleSignOut = async () => {
    setLocalError(null);
    setBusy('signout');
    try {
      await onSignOut();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  if (account?.connected) {
    const email = user?.email ?? account.email ?? 'Connected account';
    const planLabel = (user?.plan || 'free').toUpperCase();
    const statusLabel = user?.status || 'active';
    const isActiveStatus = statusLabel.toLowerCase() === 'active';

    return (
      <section className={styles.card} aria-label="Torve account">
        <div className={styles.header}>
          <div className={styles.identity}>
            <TorveMark size={compact ? 32 : 36} />
            <div>
              <div className={styles.titleRow}>
                <span className={styles.title}>{user?.name || email}</span>
                <span className={`${styles.badge} ${planBadgeClass(user?.plan)}`}>{planLabel}</span>
                <span className={`${styles.badge} ${isActiveStatus ? styles.statusActive : styles.statusWarn}`}>
                  {statusLabel}
                </span>
              </div>
              <div className={styles.subtitle}>{email}</div>
            </div>
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondaryBtn}
              disabled={busy !== null}
              onClick={() => { void handleSignOut(); }}
            >
              {busy === 'signout' ? 'Signing out…' : 'Sign Out'}
            </button>
          </div>
        </div>

        <div className={styles.metaGrid}>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Desktop Key</span>
            <span className={styles.metaValue}>{key?.name || 'Torve Desktop Key'}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Key Prefix</span>
            <span className={styles.metaValue}>{key?.prefix || account.keyHint || 'sk-trv-••••'}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Auth Mode</span>
            <span className={styles.metaValue}>{account.authMode === 'oauth' ? 'Browser PKCE' : 'API Key'}</span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.card} aria-label="Sign in to Torve Desktop">
      <div className={styles.header}>
        <div className={styles.identity}>
          <TorveMark size={36} />
          <div>
            <div className={styles.title}>Sign in to Torve Desktop</div>
            <div className={styles.subtitle}>
              Connect your Torve account via browser approval to route your coding tools through 127.0.0.1:8378.
            </div>
          </div>
        </div>
      </div>

      {pkcePending ? (
        <div className={styles.pendingBox}>
          <span>Waiting for browser approval on torveai.com…</span>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => { void onPkceCancel(); }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primaryBtn}
            disabled={busy !== null}
            onClick={() => { void handlePkce(); }}
          >
            <span>{busy === 'pkce' ? 'Opening Browser…' : 'Sign in with torveai.com'}</span>
            <HugeiconsIcon icon={ArrowUpRight01Icon} size={15} strokeWidth={2.2} />
          </button>
        </div>
      )}

      {activeError ? (
        <div className={styles.errorBox} role="alert">
          <div>{activeError}</div>
          {isKeyLimitError ? (
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => { void window.torveDesktop?.openExternalUrl?.(DASHBOARD_KEYS_URL); }}
            >
              Manage Keys on torveai.com Dashboard
              <HugeiconsIcon icon={ArrowUpRight01Icon} size={14} strokeWidth={2} />
            </button>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        className={styles.ghostLink}
        onClick={() => setManualOpen((open) => !open)}
        aria-expanded={manualOpen}
      >
        <HugeiconsIcon icon={manualOpen ? ArrowDown01Icon : ArrowRight01Icon} size={14} strokeWidth={2} />
        <span>Or connect with API Key</span>
      </button>

      {manualOpen ? (
        <form className={styles.manualBox} onSubmit={(event) => { void handleManualSubmit(event); }}>
          <div className={styles.fieldRow}>
            <input
              type="password"
              className={styles.input}
              placeholder="sk-trv-..."
              value={apiKeyInput}
              onChange={(event) => setApiKeyInput(event.target.value)}
              autoComplete="off"
              aria-label="Torve API Key"
            />
            <button type="submit" className={styles.secondaryBtn} disabled={busy !== null}>
              {busy === 'manual' ? 'Validating…' : 'Connect Key'}
            </button>
          </div>
          <span className={styles.hint}>
            Stored encrypted in OS credential storage (`safeStorage`) and validated against `/api/desktop/me` + `/v1/models`.
          </span>
        </form>
      ) : null}
    </section>
  );
}
