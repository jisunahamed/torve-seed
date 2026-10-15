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
const TORVE_PROXY_BASE_URL = 'http://localhost:8377/v1';
const STORAGE_KEY = 'torve:account:apiKey';
const STORAGE_EMAIL_KEY = 'torve:account:email';

// Declared in preload.cts when the main handler is registered; fallback to
// localStorage keeps v1 working without rebuilding the main process.
type TorveAccountBridge = {
  torveAccountGet?: () => Promise<{ apiKey: string | null; email: string | null }>;
  torveAccountSet?: (payload: { apiKey: string; email?: string | null }) => Promise<{ ok: boolean; error?: string }>;
  torveAccountClear?: () => Promise<{ ok: boolean }>;
  torveLaunchCodex?: () => Promise<{ ok: boolean; error?: string; command?: string }>;
  openExternalUrl?: (url: string) => Promise<{ ok: boolean; error?: string }>;
  chatAiGetProxyStatus?: () => Promise<{ ok: boolean; data: { running: boolean; port: number } }>;
};

function getBridge(): TorveAccountBridge | null {
  return (window as unknown as { torveDesktop?: TorveAccountBridge }).torveDesktop ?? null;
}

function maskKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 12) return '••••••••';
  return `${trimmed.slice(0, 8)}…${trimmed.slice(-4)}`;
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
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [savedEmail, setSavedEmail] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'key' | 'command' | null>(null);
  const [launchState, setLaunchState] = useState<'idle' | 'launching' | 'done' | 'error'>('idle');
  const [launchMessage, setLaunchMessage] = useState<string | null>(null);
  const [proxyRunning, setProxyRunning] = useState<boolean | null>(null);

  const isConnected = useMemo(() => Boolean(savedKey && savedKey.trim().length > 0), [savedKey]);

  // Load saved credentials: prefer main-process store (encrypted file) then
  // fall back to localStorage so the view works before main is rebuilt.
  useEffect(() => {
    let cancelled = false;
    const bridge = getBridge();
    const load = async () => {
      if (bridge?.torveAccountGet) {
        try {
          const result = await bridge.torveAccountGet();
          if (!cancelled && result) {
            if (result.apiKey) setSavedKey(result.apiKey);
            if (result.email) setSavedEmail(result.email);
            return;
          }
        } catch {
          // fall through to localStorage
        }
      }
      try {
        const localKey = localStorage.getItem(STORAGE_KEY);
        const localEmail = localStorage.getItem(STORAGE_EMAIL_KEY);
        if (!cancelled) {
          if (localKey) setSavedKey(localKey);
          if (localEmail) setSavedEmail(localEmail);
        }
      } catch {
        // storage unavailable
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  // Poll proxy status so the launch button can hint when the buyer is not running.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const bridge = getBridge();
      if (!bridge?.chatAiGetProxyStatus) {
        setProxyRunning(null);
        return;
      }
      try {
        const res = await bridge.chatAiGetProxyStatus();
        if (!cancelled) setProxyRunning(Boolean(res?.data?.running));
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

    // Prefer main-process encrypted store; always mirror to localStorage so the
    // renderer can render connected state even if IPC is unavailable.
    if (bridge?.torveAccountSet) {
      try {
        const res = await bridge.torveAccountSet({ apiKey: trimmedKey, email: trimmedEmail });
        if (!res.ok) {
          setError(res.error ?? 'Could not save key.');
          setSaving(false);
          return;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setSaving(false);
        return;
      }
    }

    try {
      localStorage.setItem(STORAGE_KEY, trimmedKey);
      if (trimmedEmail) localStorage.setItem(STORAGE_EMAIL_KEY, trimmedEmail);
      else localStorage.removeItem(STORAGE_EMAIL_KEY);
    } catch {
      // quota or privacy mode — still treat as saved in memory
    }

    setSavedKey(trimmedKey);
    setSavedEmail(trimmedEmail);
    setApiKey('');
    setSaving(false);
  };

  const handleClear = async () => {
    const bridge = getBridge();
    if (bridge?.torveAccountClear) {
      try { await bridge.torveAccountClear(); } catch { /* ignore */ }
    }
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_EMAIL_KEY);
    } catch { /* ignore */ }
    setSavedKey(null);
    setSavedEmail(null);
    setError(null);
    setLaunchState('idle');
    setLaunchMessage(null);
  };

  const handleCopy = async (kind: 'key' | 'command') => {
    try {
      if (kind === 'key' && savedKey) {
        await navigator.clipboard.writeText(savedKey);
      } else if (kind === 'command') {
        const cmd = launchCommandForCopy(savedKey);
        await navigator.clipboard.writeText(cmd);
      }
      setCopied(kind);
      window.setTimeout(() => setCopied((current) => (current === kind ? null : current)), 2000);
    } catch {
      // clipboard unavailable
    }
  };

  const handleLaunchCodex = async () => {
    if (!savedKey) {
      setError('Connect your Torve account first — paste an API key above.');
      return;
    }
    setLaunchState('launching');
    setLaunchMessage(null);
    setError(null);
    const bridge = getBridge();
    if (bridge?.torveLaunchCodex) {
      try {
        const res = await bridge.torveLaunchCodex();
        if (res.ok) {
          setLaunchState('done');
          setLaunchMessage(res.command ? `Launched: ${res.command}` : 'Codex launched via Torve proxy.');
          return;
        }
        setLaunchState('error');
        setLaunchMessage(res.error ?? 'Could not launch Codex. Copy the command below and run it in your terminal.');
        return;
      } catch (err) {
        setLaunchState('error');
        setLaunchMessage(err instanceof Error ? err.message : String(err));
        return;
      }
    }

    // Fallback when main handler is not yet registered: copy the command so the
    // user can run it themselves — the proxy at 8377 uses the stored key.
    try {
      const cmd = launchCommandForCopy(savedKey);
      await navigator.clipboard.writeText(cmd);
      setLaunchState('done');
      setLaunchMessage('Launch command copied — paste it in your terminal. (Wire torve:launch-codex in main for one-click next.)');
    } catch {
      setLaunchState('error');
      setLaunchMessage(launchCommandForCopy(savedKey));
    }
  };

  function launchCommandForCopy(key: string | null): string {
    const displayKey = key ? key.slice(0, 8) + '…' : '<your-torve-key>';
    // Buyer proxy is OpenAI-compatible at /v1; Codex reads OPENAI_* env.
    if (typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('win')) {
      return `set OPENAI_BASE_URL=${TORVE_PROXY_BASE_URL} && set OPENAI_API_KEY=${displayKey} && codex`;
    }
    return `OPENAI_BASE_URL=${TORVE_PROXY_BASE_URL} OPENAI_API_KEY=${displayKey} codex`;
  }

  const launchCommandPreview = useMemo(() => launchCommandForCopy(savedKey), [savedKey]);

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
                Connect your Torve account, then launch Codex through the local buyer proxy at <code>localhost:8377</code>.
                No API key resale — Torve routes to value-added providers.
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
                      {maskKey(savedKey!)}
                      <button
                        type="button"
                        className={styles.inlineCopy}
                        onClick={() => handleCopy('key')}
                        aria-label="Copy API key"
                        title="Copy API key"
                      >
                        <HugeiconsIcon icon={Copy01Icon} size={14} strokeWidth={1.8} />
                        {copied === 'key' ? 'Copied' : 'Copy'}
                      </button>
                    </span>
                  </div>
                  <div className={styles.kvRow}>
                    <span className={styles.kvLabel}>Proxy</span>
                    <span className={styles.kvValueMono}>{TORVE_PROXY_BASE_URL}</span>
                  </div>
                </div>
                <p className={styles.secureNote}>
                  Key is stored locally{getBridge()?.torveAccountGet ? ' via encrypted file at ~/.torve/desktop-credentials.json' : ' in this app (localStorage for v1)'}.
                  It is sent only to the local buyer proxy for Torve-routed requests.
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
                <span className={styles.formHint}>Stored encrypted when the main handler is wired; otherwise localStorage.</span>
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
                Runs Codex against the buyer proxy — same models you see in the desktop&apos;s Models list. No extra login inside Codex.
              </p>
            </div>

            {proxyRunning === false ? (
              <div className={styles.warning} role="status">
                Buyer proxy is not running. Start the AI VPN on Home (power button) first — Codex talks to it at <code>localhost:8377</code>.
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
