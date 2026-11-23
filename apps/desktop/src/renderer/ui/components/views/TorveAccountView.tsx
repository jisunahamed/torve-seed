import { useEffect, useMemo, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowUpRight01Icon,
  Copy01Icon,
  Link01Icon,
  Tick02Icon,
  ZapIcon,
} from '@hugeicons/core-free-icons';
import { VprCard, VprPage } from '../vpr/VprKit';
import styles from './TorveAccountView.module.scss';

type Props = { onSelectView?: (view: import('../../types').ViewName) => void };

const TORVE_LOGIN_URL = 'https://torveai.com/login';
const TORVE_DASHBOARD_KEYS_URL = 'https://torveai.com/dashboard/api-keys';
const TORVE_PROXY_BASE_URL = 'http://localhost:8378/v1';

type TorveAccountBridge = {
  torveAccountGet?: () => Promise<{ connected: boolean; email: string | null; keyHint: string | null; secureStorage: boolean }>;
  torveAccountSet?: (payload: { apiKey: string; email?: string | null }) => Promise<{ ok: boolean; error?: string; status?: { email: string | null; keyHint: string | null } }>;
  torveAccountClear?: () => Promise<{ ok: boolean }>;
  torveModelsGet?: () => Promise<{ models: Array<{ id: string }>; updatedAt: number | null; stale: boolean; upstream: string }>;
  torveModelsRefresh?: () => Promise<{ ok: boolean; error?: string }>;
  torveCloudProxyStatus?: () => Promise<{ running: boolean; port: number }>;
  openExternalUrl?: (url: string) => Promise<{ ok: boolean; error?: string }>;
};

function getBridge(): TorveAccountBridge | null {
  return (window as unknown as { torveDesktop?: TorveAccountBridge }).torveDesktop ?? null;
}

function validateKey(key: string): string | null {
  const trimmed = key.trim();
  if (!trimmed) return 'Paste your Torve API key.';
  if (trimmed.length < 16) return 'That key looks too short — check you copied the full key.';
  if (/\s/.test(trimmed)) return 'The key should not contain spaces or line breaks.';
  return null;
}

export function TorveAccountView(_props: Props) {
  const [apiKey, setApiKey] = useState('');
  const [email, setEmail] = useState('');
  const [savedKeyHint, setSavedKeyHint] = useState<string | null>(null);
  const [savedEmail, setSavedEmail] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'command' | null>(null);
  const [launchState, setLaunchState] = useState<'idle' | 'launching' | 'done' | 'error'>('idle');
  const [launchMessage, setLaunchMessage] = useState<string | null>(null);
  const [proxyRunning, setProxyRunning] = useState<boolean | null>(null);

  const isConnected = useMemo(() => Boolean(savedKeyHint), [savedKeyHint]);

  // The main process returns a masked status only; raw credentials never enter
  // renderer memory or browser storage.
  useEffect(() => {
    let cancelled = false;
    const bridge = getBridge();
    const load = async () => {
      if (bridge?.torveAccountGet) {
        try {
          const result = await bridge.torveAccountGet();
          if (!cancelled && result) {
            if (result.connected) setSavedKeyHint(result.keyHint);
            if (result.email) setSavedEmail(result.email);
            return;
          }
        } catch { /* display disconnected state */ }
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  // Poll the direct loopback proxy; the P2P buyer is not required here.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const bridge = getBridge();
      if (!bridge?.torveCloudProxyStatus) {
        setProxyRunning(null);
        return;
      }
      try {
        const res = await bridge.torveCloudProxyStatus();
        if (!cancelled) setProxyRunning(Boolean(res?.running));
      } catch {
        if (!cancelled) setProxyRunning(null);
      }
    };
    void check();
    const timer = window.setInterval(() => { void check(); }, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isConnected]);

  const handleOpenLogin = () => {
    void getBridge()?.openExternalUrl?.(TORVE_LOGIN_URL);
  };

  const handleOpenKeys = () => {
    void getBridge()?.openExternalUrl?.(TORVE_DASHBOARD_KEYS_URL);
  };

  const handleSave = async () => {
    const validation = validateKey(apiKey);
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
    setError(null);
    const trimmedKey = apiKey.trim();
    const trimmedEmail = email.trim() || null;
    const bridge = getBridge();

    if (bridge?.torveAccountSet) {
      let result: { ok: boolean; error?: string; status?: { email: string | null; keyHint: string | null } };
      try {
        result = await bridge.torveAccountSet({ apiKey: trimmedKey, email: trimmedEmail });
        if (!result.ok) {
          setError(result.error ?? 'Could not save key.');
          setSaving(false);
          return;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setSaving(false);
        return;
      }
      setSavedKeyHint(result.status?.keyHint ?? '••••••••');
      setSavedEmail(result.status?.email ?? trimmedEmail);
    } else {
      setError('Torve Desktop needs to be updated before it can store credentials securely.');
      setSaving(false);
      return;
    }
    setApiKey('');
    setSaving(false);
  };

  const handleClear = async () => {
    const bridge = getBridge();
    if (bridge?.torveAccountClear) {
      try { await bridge.torveAccountClear(); } catch { /* ignore */ }
    }
    setSavedKeyHint(null);
    setSavedEmail(null);
    setError(null);
    setLaunchState('idle');
    setLaunchMessage(null);
  };

  const handleCopy = async (kind: 'command') => {
    try {
      if (kind === 'command') {
        const cmd = launchCommandForCopy();
        await navigator.clipboard.writeText(cmd);
      }
      setCopied(kind);
      window.setTimeout(() => setCopied((current) => (current === kind ? null : current)), 2000);
    } catch {
      // clipboard unavailable
    }
  };

  const handleLaunchCodex = async () => {
    if (!savedKeyHint) {
      setError('Connect your Torve account first — paste an API key above.');
      return;
    }
    setLaunchState('launching');
    setLaunchMessage(null);
    setError(null);
    // The direct loopback proxy owns the API credential, so the command holds
    // only a harmless placeholder API value.
    try {
      const cmd = launchCommandForCopy();
      await navigator.clipboard.writeText(cmd);
      setLaunchState('done');
      setLaunchMessage('Launch command copied — paste it in your terminal. It uses the local Torve Cloud proxy.');
    } catch {
      setLaunchState('error');
      setLaunchMessage(launchCommandForCopy());
    }
  };

  function launchCommandForCopy(): string {
    // The direct proxy authenticates in the Electron main process.
    if (typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('win')) {
      return `set OPENAI_BASE_URL=${TORVE_PROXY_BASE_URL} && set OPENAI_API_KEY=torve-local && codex`;
    }
    return `OPENAI_BASE_URL=${TORVE_PROXY_BASE_URL} OPENAI_API_KEY=torve-local codex`;
  }

  const launchCommandPreview = useMemo(() => launchCommandForCopy(), []);

  return (
    <section className={`view view-vpr-torve-account view-pinned-header ${styles.view}`} role="tabpanel" aria-label="Torve Account">
      <VprPage title="Torve Account" backFallback="home">
        <div className={styles.stack}>

          <div className={styles.hero}>
            <div className={styles.heroIcon} aria-hidden="true">
              <HugeiconsIcon icon={Link01Icon} size={20} strokeWidth={1.8} />
            </div>
            <div className={styles.heroText}>
              <h2 className={styles.heroTitle}>Use Torve models in Codex — 1 click</h2>
              <p className={styles.heroSubtitle}>
                Connect your Torve account, then launch Codex through the local Torve Cloud proxy at <code>localhost:8378</code>.
                Your API key stays inside the desktop app.
              </p>
            </div>
          </div>

          {/* Connection status */}
          <VprCard className={styles.card}>
            <div className={styles.cardHead}>
              <span className={styles.cardLabel}>Connection</span>
              {isConnected ? (
                <span className={styles.connectedBadge}>
                  <HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={2.4} />
                  Connected
                </span>
              ) : (
                <span className={styles.disconnectedBadge}>Not connected</span>
              )}
            </div>

            {isConnected ? (
              <div className={styles.connectedBody}>
                <div className={styles.kvList}>
                  {savedEmail ? (
                    <div className={styles.kvRow}>
                      <span className={styles.kvLabel}>Account</span>
                      <span className={styles.kvValue}>{savedEmail}</span>
                    </div>
                  ) : null}
                  <div className={styles.kvRow}>
                    <span className={styles.kvLabel}>API key</span>
                    <span className={styles.kvValueMono}>
                      {savedKeyHint}
                    </span>
                  </div>
                  <div className={styles.kvRow}>
                    <span className={styles.kvLabel}>Proxy</span>
                    <span className={styles.kvValueMono}>{TORVE_PROXY_BASE_URL}</span>
                  </div>
                </div>
                <p className={styles.secureNote}>
                  Key is encrypted by your OS credential store and is only decrypted inside the local Torve Cloud proxy.
                </p>
                <div className={styles.cardActions}>
                  <button type="button" className={styles.secondaryButton} onClick={handleClear}>
                    Disconnect
                  </button>
                  <button type="button" className={styles.ghostButton} onClick={handleOpenKeys}>
                    Manage keys
                    <HugeiconsIcon icon={ArrowUpRight01Icon} size={14} strokeWidth={2} />
                  </button>
                </div>
              </div>
            ) : (
              <div className={styles.disconnectedBody}>
                <p className={styles.lede}>
                  Sign in on torveai.com, create an API key, then paste it below. The desktop keeps it on this device.
                </p>
                <div className={styles.ctaRow}>
                  <button type="button" className={styles.primaryButton} onClick={handleOpenLogin}>
                    Connect Torve Account
                    <HugeiconsIcon icon={ArrowUpRight01Icon} size={14} strokeWidth={2} />
                  </button>
                  <button type="button" className={styles.ghostButton} onClick={handleOpenKeys}>
                    I already have a key
                  </button>
                </div>
              </div>
            )}
          </VprCard>

          {/* Paste key — always visible so the user can rotate keys without disconnecting */}
          <VprCard className={styles.card}>
            <div className={styles.sectionHead}>
              <h3 className={styles.sectionTitle}>{isConnected ? 'Update API key' : 'Paste API key'}</h3>
              <p className={styles.sectionHint}>
                From <button type="button" className={styles.inlineLink} onClick={handleOpenKeys}>torveai.com/dashboard/api-keys</button> — copy the full key (starts with <code>torve_</code> or <code>sk-</code>).
              </p>
            </div>

            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Torve API key</span>
                <div className={styles.inputRow}>
                  <input
                    type="password"
                    className={styles.input}
                    placeholder="torve_... or sk-..."
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              </label>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>Email <span className={styles.optional}>(optional, for display)</span></span>
                <input
                  type="email"
                  className={styles.input}
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </label>

              {error ? <div className={styles.error} role="alert">{error}</div> : null}

              <div className={styles.formActions}>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={handleSave}
                  disabled={saving || !apiKey.trim()}
                >
                  {saving ? 'Saving…' : isConnected ? 'Update key' : 'Save key'}
                </button>
                <span className={styles.formHint}>Stored only in your OS credential store.</span>
              </div>
            </div>
          </VprCard>

          {/* Launch Codex */}
          <VprCard className={`${styles.card} ${styles.launchCard}`}>
            <div className={styles.sectionHead}>
              <h3 className={styles.sectionTitle}>
                <HugeiconsIcon icon={ZapIcon} size={16} strokeWidth={1.8} className={styles.sectionIcon} />
                Launch Codex with Torve
              </h3>
              <p className={styles.sectionHint}>
                Runs Codex against the local Torve Cloud proxy — same models you see in the desktop&apos;s Models list. No extra login inside Codex.
              </p>
            </div>

            {proxyRunning === false ? (
              <div className={styles.warning} role="status">
                Torve Cloud proxy is not running. Reconnect your Torve account, then try again.
              </div>
            ) : null}

            <div className={styles.commandBlock}>
              <code className={styles.commandCode}>{launchCommandPreview}</code>
              <button
                type="button"
                className={styles.inlineCopy}
                onClick={() => handleCopy('command')}
                aria-label="Copy launch command"
              >
                <HugeiconsIcon icon={Copy01Icon} size={14} strokeWidth={1.8} />
                {copied === 'command' ? 'Copied' : 'Copy'}
              </button>
            </div>

            <div className={styles.launchActions}>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={handleLaunchCodex}
                disabled={!isConnected || launchState === 'launching'}
              >
                {launchState === 'launching' ? 'Launching…' : 'Launch Codex with Torve'}
              </button>
              <span className={styles.launchHint}>
                {isConnected ? 'Uses your saved key for this device only.' : 'Save a key above to enable.'}
              </span>
            </div>

            {launchMessage ? (
              <div className={`${styles.launchMessage} ${launchState === 'error' ? styles.launchMessageError : ''}`} role="status">
                {launchMessage}
              </div>
            ) : null}

            <div className={styles.docsRow}>
              <button type="button" className={styles.inlineLink} onClick={() => void getBridge()?.openExternalUrl?.('https://torveai.com/docs')}>
                Docs
              </button>
              <span className={styles.dot} aria-hidden="true">·</span>
              <button type="button" className={styles.inlineLink} onClick={() => void getBridge()?.openExternalUrl?.('https://torveai.com/integrations')}>
                Integrations
              </button>
            </div>
          </VprCard>

          <p className={styles.footnote}>
            Torve is not a raw API-key reseller. Providers must add value (TEE, skills, agents, fine-tuned models). Subscription plugins are for testing only.
          </p>
        </div>
      </VprPage>
    </section>
  );
}
