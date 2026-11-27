import { useCallback, useEffect, useMemo, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowReloadHorizontalIcon, Moon02Icon, Sun02Icon } from '@hugeicons/core-free-icons';
import { activeThemeMode, applyThemeMode, type ThemeMode } from '../../lib/theme';
import type { TorveAccountStatus, TorveDesktopMeResponse, UpdateStatus } from '../../../types/bridge';
import type { ViewName } from '../../types';
import { VprToggle } from '../vpr/VprKit';
import { TorveMark } from '../brand/TorveMark';
import { TorveAuthCard } from '../torve/TorveAuthCard';
import { useTorveToast } from '../torve/TorveToastContext';
import styles from './VprPreferencesView.module.scss';

type Props = {
  onSelectView?: (view: ViewName) => void;
  initialUpdateStatus?: UpdateStatus | null;
};

type CloudActivity = {
  id: string;
  timestamp: number;
  appId: string | null;
  protocol: string;
  requestedModel: string | null;
  resolvedModel: string | null;
  statusCode: number;
  latencyMs: number;
  stream: boolean;
  usage: { inputTokens: number; outputTokens: number } | null;
  errorSummary: string | null;
};

type BackupSummary = {
  appId: string;
  createdAt?: number;
  updatedAt?: number;
  patchedAt?: number | null;
  filesCount?: number;
  targetPaths?: string[];
  files?: Array<{ originalPath: string; existedBefore: boolean }>;
};

declare const __APP_VERSION__: string;

function getUpdateStatusLabel(status: UpdateStatus | null, checking: boolean): string {
  if (checking || status?.status === 'checking') {
    return 'Checking…';
  }
  if (!status) {
    return 'Torve Desktop is up to date';
  }
  switch (status.status) {
    case 'up-to-date':
      return 'Torve Desktop is up to date';
    case 'idle':
      return status.error ? status.error : 'Torve Desktop is up to date';
    case 'available':
      return `Torve Desktop v${status.version} is available`;
    case 'downloading': {
      const pct = Math.max(0, Math.min(100, Math.round(status.downloadPercent ?? status.percent ?? 0)));
      return `Downloading ${pct}%`;
    }
    case 'ready':
      return `Torve Desktop v${status.version} is ready to install`;
    case 'installing':
      return 'Installing update…';
    case 'error':
      return status.message || status.error || 'Unable to check for updates right now. Please try again later.';
  }
}

export function VprPreferencesView({ initialUpdateStatus = null }: Props) {
  const toast = useTorveToast();
  const [activities, setActivities] = useState<CloudActivity[]>([]);
  const [appFilter, setAppFilter] = useState('');
  const [modelFilter, setModelFilter] = useState('');

  const [account, setAccount] = useState<TorveAccountStatus | null>(null);
  const [me, setMe] = useState<TorveDesktopMeResponse | null>(null);
  const [pkcePending, setPkcePending] = useState(false);
  const [authError, setAuthError] = useState<{ message: string; statusCode?: number; code?: string } | null>(null);

  const [openAtLogin, setOpenAtLogin] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => activeThemeMode());
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [backupBusy, setBackupBusy] = useState<string | null>(null);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string>(typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.2.58');
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(initialUpdateStatus);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  const refreshBackups = useCallback(async () => {
    const bridge = typeof window !== 'undefined' ? window.torveDesktop : undefined;
    const list = await bridge?.torveBackupsList?.();
    if (Array.isArray(list)) setBackups(list);
  }, []);

  const refreshAccount = useCallback(async () => {
    const bridge = typeof window !== 'undefined' ? window.torveDesktop : undefined;
    if (!bridge) return;
    const [acct, meRes] = await Promise.all([
      bridge.torveAccountGet?.(),
      bridge.torveMeGet?.(),
    ]);
    if (acct) setAccount(acct);
    if (meRes) setMe(meRes.me ?? null);
  }, []);

  useEffect(() => {
    const bridge = typeof window !== 'undefined' ? window.torveDesktop : undefined;
    void refreshAccount();
    void refreshBackups();
    void bridge?.torveActivityGet?.()?.then?.((items) => setActivities(items ?? []))?.catch?.(() => {});
    void bridge?.loginItemGet?.()?.then?.((res) => setOpenAtLogin(Boolean(res?.openAtLogin)))?.catch?.(() => {});
    void bridge?.getAppVersion?.()?.then?.((v) => { if (v) setAppVersion(v); })?.catch?.(() => {});
    void bridge?.getUpdateStatus?.()?.then?.((status) => { if (status) setUpdateStatus(status); })?.catch?.(() => {});

    const unsubActivity = bridge?.onTorveActivity?.((item) => {
      setActivities((current) => [item, ...current.filter((entry) => entry.id !== item.id)].slice(0, 150));
    });
    const unsubUpdate = bridge?.onUpdateStatus?.((status) => {
      setUpdateStatus(status);
      if (status.status !== 'checking') {
        setCheckingUpdate(false);
      }
    });
    const unsubAuth = bridge?.onTorveAuthEvent?.((event) => {
      if (event.status === 'pending') {
        setPkcePending(true);
        setAuthError(null);
      } else if (event.status === 'connected') {
        setPkcePending(false);
        setAuthError(null);
        if (event.accountStatus) setAccount(event.accountStatus);
        if (event.me !== undefined) setMe(event.me);
      } else if (event.status === 'cancelled') {
        setPkcePending(false);
      } else if (event.status === 'error') {
        setPkcePending(false);
        setAuthError({ message: event.error || 'Authentication failed.', statusCode: event.statusCode, code: event.code });
      }
    });

    return () => {
      unsubActivity?.();
      unsubUpdate?.();
      unsubAuth?.();
    };
  }, [refreshAccount, refreshBackups]);

  const distinctApps = useMemo(
    () => [...new Set(activities.map((a) => a.appId || 'torve-desktop'))].sort(),
    [activities],
  );
  const distinctModels = useMemo(
    () => [...new Set(activities.map((a) => a.resolvedModel || a.requestedModel).filter((v): v is string => Boolean(v)))].sort(),
    [activities],
  );

  const filteredActivities = useMemo(() => activities.filter((item) => {
    const appName = item.appId || 'torve-desktop';
    const modelName = item.resolvedModel || item.requestedModel || '';
    if (appFilter && appName !== appFilter) return false;
    if (modelFilter && modelName !== modelFilter) return false;
    return true;
  }), [activities, appFilter, modelFilter]);

  const toggleLoginItem = async (next: boolean) => {
    setOpenAtLogin(next);
    const bridge = typeof window !== 'undefined' ? window.torveDesktop : undefined;
    const res = await bridge?.loginItemSet?.(next);
    if (res && typeof res.openAtLogin === 'boolean') {
      setOpenAtLogin(res.openAtLogin);
    }
  };

  const restoreBackup = async (appId: string) => {
    setBackupBusy(appId);
    setBackupNotice(null);
    try {
      const bridge = typeof window !== 'undefined' ? window.torveDesktop : undefined;
      const res = await bridge?.torveBackupsRestore?.(appId);
      if (!res?.ok) throw new Error(res?.error || `Failed to restore ${appId}`);
      const msg = `Restored original config for ${appId}.`;
      setBackupNotice(msg);
      toast.push({
        kind: 'success',
        title: 'Backup restored',
        description: msg,
        duration: 3500,
      });
      await refreshBackups();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setBackupNotice(msg);
      toast.push({
        kind: 'error',
        title: 'Restore failed',
        description: msg,
      });
    } finally {
      setBackupBusy(null);
    }
  };

  const handleCheckForUpdates = async () => {
    const checkFn = typeof window !== 'undefined' ? window.torveDesktop?.checkForUpdates : undefined;
    if (!checkFn) return;
    setCheckingUpdate(true);
    try {
      const next = await checkFn();
      if (next) {
        setUpdateStatus(next);
        if (next.status === 'available') {
          toast.push({
            kind: 'info',
            title: 'Update available',
            description: `Torve Desktop v${next.version} is ready to download.`,
          });
        } else if (next.status === 'up-to-date' || (next.status === 'idle' && !next.error)) {
          toast.push({
            kind: 'success',
            title: 'Up to date',
            description: `Torve Desktop v${next.currentVersion || appVersion} is the latest release.`,
            duration: 3000,
          });
        } else if (next.status === 'error' || (next.status === 'idle' && next.error)) {
          toast.push({
            kind: 'error',
            title: 'Update check failed',
            description: next.status === 'error' ? next.message : (next.error || 'Could not check for updates.'),
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to check for updates.';
      setUpdateStatus({
        status: 'error',
        version: null,
        message: msg,
        details: err instanceof Error ? (err.stack || err.message) : String(err),
      });
      toast.push({
        kind: 'error',
        title: 'Update check failed',
        description: msg,
      });
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleDownloadUpdate = async () => {
    if (typeof window === 'undefined') return;
    await window.torveDesktop?.downloadUpdate?.();
  };

  const handleInstallUpdate = async () => {
    if (typeof window === 'undefined') return;
    await window.torveDesktop?.installUpdate?.();
  };

  const displayVersion = updateStatus?.currentVersion || appVersion;
  const lastCheckedLabel = updateStatus?.lastCheckedAt
    ? new Date(updateStatus.lastCheckedAt).toLocaleString()
    : 'Never';
  const updateStatusLabel = getUpdateStatusLabel(updateStatus, checkingUpdate);
  const downloadPercent = updateStatus?.status === 'downloading'
    ? Math.max(0, Math.min(100, Math.round(updateStatus.downloadPercent ?? updateStatus.percent ?? 0)))
    : 0;
  const isUpdateError = updateStatus?.status === 'error' || (updateStatus?.status === 'idle' && Boolean(updateStatus.error));
  const isUpdateReady = updateStatus?.status === 'available' || updateStatus?.status === 'ready';
  const isCheckDisabled =
    checkingUpdate
    || updateStatus?.status === 'checking'
    || updateStatus?.status === 'downloading'
    || updateStatus?.status === 'installing';

  return (
    <section className={styles.view} role="tabpanel" aria-label="Activity and Settings">
      <div className={styles.container}>
        <header className={styles.topBar}>
          <div>
            <h1 className={styles.title}>Activity &amp; Settings</h1>
            <p className={styles.subtitle}>Sanitized local request stream, account credentials, startup behavior, and atomic backups</p>
          </div>
          <span className={styles.endpointPill}>
            <span className={styles.endpointDot} />
            127.0.0.1:8378
          </span>
        </header>

        <section className={styles.card} aria-label="Request activity log">
          <div className={styles.cardHead}>
            <div>
              <h2 className={styles.cardTitle}>Live Request Activity ({filteredActivities.length})</h2>
              <p className={styles.settingHint}>Real-time metadata stream across local coding tools (prompts and responses never logged)</p>
            </div>
            <div className={styles.filters}>
              <select
                className={styles.select}
                value={appFilter}
                onChange={(event) => setAppFilter(event.target.value)}
                aria-label="Filter activity by app"
              >
                <option value="">All apps</option>
                {distinctApps.map((appId) => <option key={appId} value={appId}>{appId}</option>)}
              </select>
              <select
                className={styles.select}
                value={modelFilter}
                onChange={(event) => setModelFilter(event.target.value)}
                aria-label="Filter activity by model"
              >
                <option value="">All models</option>
                {distinctModels.map((modelId) => <option key={modelId} value={modelId}>{modelId}</option>)}
              </select>
              <button
                type="button"
                className={styles.btn}
                onClick={() => {
                  const bridge = typeof window !== 'undefined' ? window.torveDesktop : undefined;
                  void bridge?.torveActivityClear?.().then(() => {
                    setActivities([]);
                    toast.push({
                      kind: 'info',
                      title: 'Activity cleared',
                      description: 'Local request stream log cleared.',
                      duration: 2400,
                    });
                  });
                }}
              >
                Clear
              </button>
            </div>
          </div>

          {filteredActivities.length > 0 ? (
            <div className={styles.activityList}>
              {filteredActivities.map((item) => (
                <div key={item.id} className={styles.activityRow}>
                  <span className={item.statusCode < 400 ? styles.statusOk : styles.statusErr}>
                    {item.statusCode}
                  </span>
                  <div className={styles.activityMain}>
                    <div className={styles.activityTop}>
                      <span>{item.appId || 'torve-desktop'}</span>
                      <span className={styles.activityArrow}>→</span>
                      <span className={styles.activityModel}>{item.resolvedModel || item.requestedModel || 'automatic'}</span>
                    </div>
                    <div className={styles.activitySub}>
                      <span className={styles.protoPill}>{item.protocol}</span>
                      {item.stream ? <span className={styles.streamPill}>stream</span> : null}
                      {item.usage ? (
                        <span className={styles.usageText}>
                          {item.usage.inputTokens} in / {item.usage.outputTokens} out
                        </span>
                      ) : null}
                      {item.errorSummary ? <span className={styles.errorInline}>{item.errorSummary}</span> : null}
                    </div>
                  </div>
                  <div className={styles.activityRight}>
                    <div className={styles.latencyValue}>{item.latencyMs} ms</div>
                    <div className={styles.timeValue}>{new Date(item.timestamp).toLocaleTimeString()}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.empty}>No requests logged yet. Requests routed through 127.0.0.1:8378 appear here in real time (metadata only — never prompts or responses).</p>
          )}
        </section>

        <TorveAuthCard
          compact
          account={account}
          me={me}
          pkcePending={pkcePending}
          authError={authError}
          onPkceStart={async () => {
            const res = await window.torveDesktop?.torveAccountPkceStart?.();
            if (res && !res.ok) setAuthError({ message: res.error || 'Failed to launch sign-in.' });
          }}
          onPkceCancel={async () => {
            await window.torveDesktop?.torveAccountPkceCancel?.();
            setPkcePending(false);
          }}
          onManualConnect={async (apiKey) => {
            const res = await window.torveDesktop?.torveAccountSet?.({ apiKey });
            if (!res?.ok) throw new Error(res?.error || 'Could not validate API key.');
            if (res.status) setAccount(res.status);
            if (res.me !== undefined) setMe(res.me);
          }}
          onSignOut={async () => {
            await window.torveDesktop?.torveAccountClear?.();
            setAccount((prev) => prev ? { ...prev, connected: false, authMode: null, email: null, keyHint: null, keyMeta: null, userMeta: null } : null);
            setMe(null);
          }}
        />

        <section className={styles.card} aria-label="Application settings">
          <h2 className={styles.cardTitle}>Desktop Preferences</h2>
          <div className={styles.settingRow}>
            <div>
              <div className={styles.settingTitle}>Launch at Login</div>
              <div className={styles.settingHint}>Start Torve Desktop automatically so 127.0.0.1:8378 stays ready for your coding tools.</div>
            </div>
            <VprToggle
              checked={openAtLogin}
              onChange={(next) => { void toggleLoginItem(next); }}
              ariaLabel="Launch at Login"
            />
          </div>

          <div className={styles.settingRow}>
            <div>
              <div className={styles.settingTitle}>Appearance</div>
              <div className={styles.settingHint}>Torve dark theme uses #0A0A0A / #18181B surfaces with #D8FF0A &amp; #14FF73 accents.</div>
            </div>
            <div className={styles.themeGroup} role="group" aria-label="Theme mode">
              <button
                type="button"
                aria-pressed={themeMode === 'dark'}
                className={`${styles.btn}${themeMode === 'dark' ? ` ${styles.themeBtnActive}` : ''}`}
                onClick={() => { applyThemeMode('dark'); setThemeMode('dark'); }}
              >
                <HugeiconsIcon icon={Moon02Icon} size={14} strokeWidth={2} />
                <span>Dark</span>
              </button>
              <button
                type="button"
                aria-pressed={themeMode === 'light'}
                className={`${styles.btn}${themeMode === 'light' ? ` ${styles.themeBtnActive}` : ''}`}
                onClick={() => { applyThemeMode('light'); setThemeMode('light'); }}
              >
                <HugeiconsIcon icon={Sun02Icon} size={14} strokeWidth={2} />
                <span>Light</span>
              </button>
            </div>
          </div>
        </section>

        <section className={styles.card} aria-label="Backup and restore manager">
          <div className={styles.cardHead}>
            <div>
              <h2 className={styles.cardTitle}>Backup &amp; Restore (~/.torve/backups/)</h2>
              <div className={styles.settingHint}>Original app configuration snapshots stored atomically before Torve patches are applied.</div>
            </div>
            <button type="button" className={styles.btn} onClick={() => { void refreshBackups(); }}>
              <HugeiconsIcon icon={ArrowReloadHorizontalIcon} size={14} strokeWidth={2} />
              <span>Refresh</span>
            </button>
          </div>

          {backupNotice ? <div className={styles.feedback}>{backupNotice}</div> : null}

          {backups.length > 0 ? (
            <div className={styles.backupList}>
              {backups.map((b) => {
                const pathsList = Array.isArray(b.targetPaths)
                  ? b.targetPaths
                  : Array.isArray(b.files)
                    ? b.files.map((f) => f.originalPath).filter(Boolean)
                    : [];
                const count = typeof b.filesCount === 'number' ? b.filesCount : pathsList.length;
                return (
                  <div key={b.appId} className={styles.backupRow}>
                    <div className={styles.backupMeta}>
                      <div className={styles.backupTitleRow}>
                        <span className={styles.backupTitle}>{b.appId}</span>
                        <span className={styles.countPill}>{count} {count === 1 ? 'file' : 'files'}</span>
                      </div>
                      <span className={styles.backupPaths}>{pathsList.join(', ') || 'Original config backup'}</span>
                    </div>
                    <button
                      type="button"
                      className={styles.btn}
                      disabled={backupBusy === b.appId}
                      onClick={() => { void restoreBackup(b.appId); }}
                    >
                      {backupBusy === b.appId ? 'Restoring…' : 'Restore Original'}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className={styles.empty}>No active harness backups found right now.</p>
          )}
        </section>

        <section className={styles.card} aria-label="About Torve Desktop">
          <div className={styles.cardHead}>
            <div className={styles.aboutBrand}>
              <div className={styles.aboutMarkTile}>
                <TorveMark size={24} />
              </div>
              <div>
                <h2 className={styles.cardTitle}>About Torve Desktop</h2>
                <div className={styles.settingHint}>Direct Cloud Proxy: http://127.0.0.1:8378</div>
              </div>
            </div>
            <span className={styles.versionPill}>v{displayVersion}</span>
          </div>

          <div className={styles.settingRow}>
            <div className={styles.updateMeta}>
              <div className={styles.updateTitleRow}>
                <span
                  className={`${styles.settingTitle}${
                    isUpdateError
                      ? ` ${styles.updateErrorText}`
                      : isUpdateReady
                        ? ` ${styles.updateReadyText}`
                        : ''
                  }`}
                >
                  {updateStatusLabel}
                </span>
              </div>
              <div className={styles.settingHint}>Last checked: {lastCheckedLabel}</div>
              {updateStatus?.status === 'downloading' ? (
                <div
                  className={styles.updateProgressTrack}
                  role="progressbar"
                  aria-valuenow={downloadPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div className={styles.updateProgressFill} style={{ width: `${downloadPercent}%` }} />
                </div>
              ) : null}
            </div>
            <div className={styles.updateActions}>
              {updateStatus?.status === 'available' ? (
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={() => { void handleDownloadUpdate(); }}
                >
                  Download &amp; Update
                </button>
              ) : null}
              {updateStatus?.status === 'ready' ? (
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  onClick={() => { void handleInstallUpdate(); }}
                >
                  Restart to Install
                </button>
              ) : null}
              <button
                type="button"
                className={styles.btn}
                disabled={isCheckDisabled}
                onClick={() => { void handleCheckForUpdates(); }}
              >
                <HugeiconsIcon icon={ArrowReloadHorizontalIcon} size={14} strokeWidth={2} />
                <span>{checkingUpdate || updateStatus?.status === 'checking' ? 'Checking…' : 'Check for Updates'}</span>
              </button>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
