import { useEffect, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon, ArrowRight01Icon, ArrowUpRight01Icon } from '@hugeicons/core-free-icons';
import type { TorveAccountStatus, TorveDesktopMeResponse } from '../../../types/bridge';
import { TorveMark, TorveWordmark } from '../brand/TorveMark';
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
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarFailed, setAvatarFailed] = useState(false);

  const user = me?.user ?? account?.userMeta ?? null;
  const resolvedEmail = user?.email ?? account?.email ?? null;

  useEffect(() => {
    setAvatarFailed(false);
    const normalized = resolvedEmail?.trim().toLowerCase();
    if (!normalized || typeof crypto === 'undefined' || !crypto.subtle) {
      setAvatarUrl(null);
      return;
    }
    let cancelled = false;
    const data = new TextEncoder().encode(normalized);
    void crypto.subtle.digest('SHA-256', data).then((buf) => {
      if (cancelled) return;
      const hash = Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      setAvatarUrl(`https://www.gravatar.com/avatar/${hash}?d=404&s=96`);
    }).catch(() => {
      if (!cancelled) setAvatarUrl(null);
    });
    return () => {
      cancelled = true;
    };
  }, [resolvedEmail]);
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

  const openDashboardKeys = () => {
    if (typeof window !== 'undefined') {
      void window.torveDesktop?.openExternalUrl?.(DASHBOARD_KEYS_URL);
    }
  };

  if (account?.connected) {
    const email = user?.email ?? account.email ?? 'Connected account';
    const planLabel = (user?.plan || 'free').toUpperCase();
    const statusLabel = user?.status || 'active';
    const isActiveStatus = statusLabel.toLowerCase() === 'active';

    return (
      <section className={`${styles.card} ${compact ? styles.cardCompact : ''}`} aria-label="Torve account">
        <div className={styles.header}>
          <div className={styles.identity}>
            <div className={styles.markFrame}>
              {avatarUrl && !avatarFailed ? (
                <img
                  src={avatarUrl}
                  alt={user?.name || email}
                  draggable={false}
                  onError={() => setAvatarFailed(true)}
                  style={{
                    width: compact ? 32 : 36,
                    height: compact ? 32 : 36,
                    borderRadius: 8,
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
              ) : (
                <TorveMark size={compact ? 32 : 36} />
              )}
            </div>
            <div className={styles.identityCopy}>
              <div className={styles.titleRow}>
                <span className={styles.title}>{user?.name || email}</span>
                <span className={`${styles.badge} ${planBadgeClass(user?.plan)}`}>{planLabel}</span>
                <span className={`${styles.badge} ${isActiveStatus ? styles.statusActive : styles.statusWarn}`}>
                  <span className={styles.statusDot} aria-hidden />
                  {statusLabel}
                </span>
              </div>
              <div className={styles.subtitle}>{email}</div>
            </div>
          </div>
          <div className={styles.actions}>
            {!compact ? (
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={openDashboardKeys}
              >
                <span>Manage Keys</span>
                <HugeiconsIcon icon={ArrowUpRight01Icon} size={13} strokeWidth={2} />
              </button>
            ) : null}
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

        {activeError ? (
          <div className={styles.errorBox} role="alert">
            <div>{activeError}</div>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className={`${styles.card} ${styles.signInCard} ${compact ? styles.cardCompact : ''}`} aria-label="Sign in to Torve Desktop">
      <div className={styles.header}>
        <div className={styles.identity}>
          <div className={styles.markFrameHero}>
            <TorveMark size={compact ? 32 : 40} />
          </div>
          <div className={styles.identityCopy}>
            <div className={styles.brandLockup}>
              <TorveWordmark height={compact ? 15 : 18} />
              <span className={styles.desktopPill}>Desktop</span>
            </div>
            <div className={styles.title}>Sign in to Torve Desktop</div>
            <div className={styles.subtitle}>
              Connect your Torve account via browser PKCE approval to route coding tools through 127.0.0.1:8378.
            </div>
          </div>
        </div>
      </div>

      {pkcePending ? (
        <div className={styles.pendingBox}>
          <div className={styles.pendingText}>
            <span className={styles.pendingPulse} aria-hidden />
            <span>Waiting for browser approval on torveai.com…</span>
          </div>
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
            <HugeiconsIcon icon={ArrowUpRight01Icon} size={15} strokeWidth={2.4} />
          </button>
          <span className={styles.pkceHint}>Encrypted in OS keychain · PKCE OAuth</span>
        </div>
      )}

      {activeError ? (
        <div className={styles.errorBox} role="alert">
          <div>{activeError}</div>
          {isKeyLimitError ? (
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={openDashboardKeys}
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
        <span>Or connect manually with API Key</span>
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
            Stored encrypted in OS credential storage (safeStorage) and validated against /api/desktop/me + /v1/models.
          </span>
        </form>
      ) : null}
    </section>
  );
}
