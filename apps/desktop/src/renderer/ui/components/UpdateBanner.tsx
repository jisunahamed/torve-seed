import { useCallback, useEffect, useRef, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Alert02Icon, Download01Icon } from '@hugeicons/core-free-icons';
import { useUiSelector } from '../hooks/useUiSelector';
import type { UpdateStatus } from '../../types/bridge';
import styles from './VprShell.module.scss';

const DEFAULT_INSTALL_HINT = 'Quit the app, reopen, and try again.';

/** Top-of-shell auto-update banner. */
export function UpdateBanner() {
  const networkAlert = useUiSelector((state) => state.networkAlert);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const [detailsCopied, setDetailsCopied] = useState(false);
  const errorFromEventRef = useRef(false);

  useEffect(() => {
    const bridge = window.torveDesktop;
    if (!bridge?.onUpdateStatus) return;

    const apply = (data: UpdateStatus) => {
      if (data.status === 'error') {
        errorFromEventRef.current = true;
        setUpdate(data);
        return;
      }
      errorFromEventRef.current = false;
      if (data.status === 'downloading') {
        // A completed download outranks stray progress events.
        setUpdate((prev) => (prev?.status === 'ready' ? prev : data));
        return;
      }
      setUpdate(data);
    };

    const unsubscribe = bridge.onUpdateStatus(apply);
    // Replay a status that fired before this component mounted.
    void bridge.getUpdateStatus?.()?.then?.((status) => {
      if (status) setUpdate((prev) => prev ?? status);
    }).catch(() => {});
    return unsubscribe;
  }, []);

  const handleDownload = useCallback(async () => {
    const bridge = window.torveDesktop;
    if (!bridge?.downloadUpdate) return;
    try {
      const result = await bridge.downloadUpdate();
      if (!result.ok && !errorFromEventRef.current) {
        setUpdate((prev) => ({
          status: 'error',
          version: prev?.version ?? null,
          message: result.error,
          details: result.details,
          hint: result.hint,
        }));
      }
    } catch (err) {
      setUpdate((prev) => ({
        status: 'error',
        version: prev?.version ?? null,
        message: err instanceof Error ? err.message : 'Update download failed.',
        details: err instanceof Error ? (err.stack || err.message) : String(err),
      }));
    }
  }, []);

  const handleInstall = useCallback(async () => {
    const bridge = window.torveDesktop;
    if (!bridge?.installUpdate) return;
    setUpdate((prev) => (prev?.status === 'ready' ? { ...prev, status: 'installing', version: prev.version } : prev));
    try {
      const result = await bridge.installUpdate();
      if (!result.ok && !errorFromEventRef.current) {
        setUpdate((prev) => ({
          status: 'error',
          version: prev?.version ?? null,
          message: result.error,
          details: result.details,
          hint: result.hint ?? DEFAULT_INSTALL_HINT,
        }));
      }
    } catch (err) {
      setUpdate((prev) => ({
        status: 'error',
        version: prev?.version ?? null,
        message: err instanceof Error ? err.message : 'Update failed to install.',
        details: err instanceof Error ? (err.stack || err.message) : String(err),
        hint: DEFAULT_INSTALL_HINT,
      }));
    }
  }, []);

  const handleCopyDetails = useCallback(() => {
    if (update?.status !== 'error') return;
    const text = [
      `Message: ${update.message}`,
      update.hint ? `Hint: ${update.hint}` : null,
      `Details: ${update.details}`,
    ].filter(Boolean).join('\n');
    void navigator.clipboard.writeText(text).then(() => {
      setDetailsCopied(true);
      window.setTimeout(() => setDetailsCopied(false), 1500);
    }).catch(() => setDetailsCopied(false));
  }, [update]);

  // The network alert owns visibility, and idle/checking/up-to-date never show a banner.
  if (
    networkAlert !== 'none'
    || !update
    || update.status === 'idle'
    || update.status === 'checking'
    || update.status === 'up-to-date'
  ) {
    return null;
  }

  // Dismissal is deliberately session-only (component state): the banner
  // returns on the next app launch until the update is taken.
  if (
    (update.status === 'available' || update.status === 'downloading' || update.status === 'ready')
    && update.version === dismissedVersion
  ) {
    return null;
  }

  if (update.status === 'error') {
    return (
      <div className={`${styles.updateBanner} ${styles.updateBannerDanger}`} role="alert">
        <span className={styles.updateBannerIcon} aria-hidden="true">
          <HugeiconsIcon icon={Alert02Icon} size={18} strokeWidth={1.8} />
        </span>
        <div className={styles.updateBannerText}>
          <span className={styles.updateBannerTitle}>Update failed</span>
          <span className={styles.updateBannerBody}>
            {update.message} {update.hint ?? DEFAULT_INSTALL_HINT}
          </span>
        </div>
        <div className={styles.updateBannerActions}>
          <button type="button" className={styles.updateBannerBtn} onClick={handleCopyDetails}>
            {detailsCopied ? 'Copied' : 'Copy details'}
          </button>
          <button
            type="button"
            className={styles.updateBannerDismiss}
            aria-label="Dismiss update error"
            onClick={() => setUpdate(null)}
          >
            ×
          </button>
        </div>
      </div>
    );
  }

  const installing = update.status === 'installing';
  const downloading = update.status === 'downloading';
  const available = update.status === 'available';
  const percent = update.status === 'downloading'
    ? Math.max(0, Math.min(100, Math.round(update.downloadPercent ?? update.percent ?? 0)))
    : 0;

  const title = installing
    ? 'Installing update…'
    : downloading
      ? 'Downloading update…'
      : available
        ? `Torve Desktop v${update.version} is available`
        : `Torve Desktop v${update.version} is ready to install`;

  const body = installing
    ? 'The app will restart on the new version in a moment.'
    : downloading
      ? `Version ${update.version} · ${percent}%`
      : available
        ? 'A new release is ready to download.'
        : 'Downloaded and verified. Restart to finish updating.';

  return (
    <div className={styles.updateBanner} role="status" aria-live="polite">
      <span className={styles.updateBannerIcon} aria-hidden="true">
        <HugeiconsIcon icon={Download01Icon} size={18} strokeWidth={1.8} />
      </span>
      <div className={styles.updateBannerText}>
        <span className={styles.updateBannerTitle}>{title}</span>
        <span className={styles.updateBannerBody}>{body}</span>
        {downloading && (
          <span
            className={styles.updateBannerProgressTrack}
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Downloading update ${percent}%`}
          >
            <span className={styles.updateBannerProgressFill} style={{ width: `${percent}%` }} />
          </span>
        )}
      </div>
      <div className={styles.updateBannerActions}>
        {available && (
          <button type="button" className={styles.updateBannerBtn} onClick={() => { void handleDownload(); }}>
            Download &amp; Update
          </button>
        )}
        {update.status === 'ready' && (
          <button type="button" className={styles.updateBannerBtn} onClick={() => { void handleInstall(); }}>
            Restart to Install
          </button>
        )}
        {!installing && (
          <button
            type="button"
            className={styles.updateBannerDismiss}
            aria-label="Dismiss update notice"
            onClick={() => setDismissedVersion(update.version)}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
