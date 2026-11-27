import { spawn, type SpawnOptions } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { open, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

export const TORVE_UPDATES_URL = 'https://api.torveai.com/api/desktop/updates/latest';
export const GITHUB_RELEASES_LIST_URL =
  'https://api.github.com/repos/jisunahamed/torve-seed/releases?per_page=10';
export const GITHUB_LATEST_RELEASE_URL = GITHUB_RELEASES_LIST_URL;

export const FRIENDLY_UPDATE_CHECK_ERROR =
  'Unable to check for updates right now. Please try again later.';
export const FRIENDLY_UPDATE_DOWNLOAD_ERROR =
  'Unable to download the update right now. Please try again later.';

export type GitHubReleaseAsset = {
  name: string;
  browser_download_url: string;
  size?: number;
  digest?: string | null;
  content_type?: string;
};

export type GitHubReleaseResponse = {
  tag_name?: string;
  version?: string;
  name?: string | null;
  html_url?: string | null;
  body?: string | null;
  notes?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  downloadUrl?: string;
  assetName?: string;
  assetSize?: number;
  sha256?: string | null;
  assets?: GitHubReleaseAsset[];
};

export type UpdaterPhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'up-to-date'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'error';

export type TorveUpdaterState = {
  phase: UpdaterPhase;
  currentVersion: string;
  latestVersion: string | null;
  releaseName: string | null;
  releaseUrl: string | null;
  releaseNotes: string | null;
  assetName: string | null;
  assetSize: number | null;
  assetDigest: string | null;
  downloadPercent: number;
  downloadedBytes: number;
  totalBytes: number;
  downloadedFilePath: string | null;
  lastCheckedAt: number | null;
  error: string | null;
};

export type TorveUpdaterOptions = {
  currentVersion?: string;
  tempDir?: string;
  releaseUrl?: string;
  torveUpdatesUrl?: string;
  fallbackReleaseUrl?: string;
  autoDownload?: boolean;
  fetchFn?: typeof fetch;
  spawnFn?: (command: string, args: string[], options: SpawnOptions) => { unref: () => void };
  onQuit?: () => void;
};

type ParsedSemver = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
};

type ResolvedReleaseCandidate = {
  version: string;
  releaseName: string | null;
  releaseNotes: string | null;
  asset: GitHubReleaseAsset | null;
};

function parseSemver(raw: string): ParsedSemver | null {
  const cleaned = raw.trim().replace(/^v/i, '').split('+')[0] ?? '';
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(cleaned);
  if (!match) return null;
  return {
    major: Number.parseInt(match[1]!, 10),
    minor: Number.parseInt(match[2]!, 10),
    patch: Number.parseInt(match[3]!, 10),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

/**
 * Compare two semver strings (with optional leading `v`).
 * Returns `1` if `a > b`, `-1` if `a < b`, and `0` if equal.
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) {
    const na = a.trim().replace(/^v/i, '');
    const nb = b.trim().replace(/^v/i, '');
    if (na === nb) return 0;
    return na > nb ? 1 : -1;
  }

  if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1;
  if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1;
  if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1;

  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0;
  if (pa.prerelease.length === 0) return 1;
  if (pb.prerelease.length === 0) return -1;

  const len = Math.max(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < len; i++) {
    const ia = pa.prerelease[i];
    const ib = pb.prerelease[i];
    if (ia === undefined) return -1;
    if (ib === undefined) return 1;
    const na = /^\d+$/.test(ia) ? Number.parseInt(ia, 10) : null;
    const nb = /^\d+$/.test(ib) ? Number.parseInt(ib, 10) : null;
    if (na !== null && nb !== null) {
      if (na !== nb) return na > nb ? 1 : -1;
    } else if (na !== null) {
      return -1;
    } else if (nb !== null) {
      return 1;
    } else if (ia !== ib) {
      return ia > ib ? 1 : -1;
    }
  }
  return 0;
}

export function selectWindowsExeAsset(assets: readonly GitHubReleaseAsset[] | undefined): GitHubReleaseAsset | null {
  if (!Array.isArray(assets)) return null;
  for (const asset of assets) {
    if (!asset || typeof asset.name !== 'string' || typeof asset.browser_download_url !== 'string') {
      continue;
    }
    if (/^Torve-Desktop-Setup-.*\.exe$/i.test(asset.name)) {
      return asset;
    }
  }
  return null;
}

function normalizeCandidate(raw: unknown): ResolvedReleaseCandidate | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rel = raw as GitHubReleaseResponse;
  if (rel.draft) return null;

  const rawVersion = (rel.tag_name ?? rel.version ?? '').trim().replace(/^v/i, '');
  if (!rawVersion || !parseSemver(rawVersion)) return null;

  let asset = selectWindowsExeAsset(rel.assets);
  if (!asset && typeof rel.downloadUrl === 'string' && rel.downloadUrl.trim().length > 0) {
    const candidateName = rel.assetName?.trim() || path.basename(rel.downloadUrl.split('?')[0] ?? '');
    if (/^Torve-Desktop-Setup-.*\.exe$/i.test(candidateName)) {
      asset = {
        name: candidateName,
        browser_download_url: rel.downloadUrl.trim(),
        ...(typeof rel.assetSize === 'number' ? { size: rel.assetSize } : {}),
        ...(typeof rel.sha256 === 'string' && rel.sha256.trim().length > 0
          ? { digest: rel.sha256.startsWith('sha256:') ? rel.sha256.trim() : `sha256:${rel.sha256.trim()}` }
          : {}),
      };
    }
  }

  return {
    version: rawVersion,
    releaseName: rel.name ?? `Torve Desktop v${rawVersion}`,
    releaseNotes: rel.notes ?? rel.body ?? null,
    asset,
  };
}

export function selectBestReleaseCandidate(payload: unknown): ResolvedReleaseCandidate | null {
  const list = Array.isArray(payload) ? payload : [payload];
  const candidates = list
    .map((entry) => normalizeCandidate(entry))
    .filter((entry): entry is ResolvedReleaseCandidate => entry !== null);

  if (candidates.length === 0) return null;

  const withExe = candidates.filter((entry) => entry.asset !== null);
  const pool = withExe.length > 0 ? withExe : candidates;
  pool.sort((a, b) => compareSemver(b.version, a.version));
  return pool[0] ?? null;
}

export async function verifyPeHeader(filePath: string): Promise<{ ok: boolean; size: number; error?: string }> {
  try {
    const info = await stat(filePath);
    if (!info.isFile() || info.size < 2) {
      return { ok: false, size: info.size, error: 'Downloaded installer file is empty or invalid.' };
    }
    const handle = await open(filePath, 'r');
    try {
      const header = Buffer.alloc(2);
      const { bytesRead } = await handle.read(header, 0, 2, 0);
      if (bytesRead < 2 || header[0] !== 0x4d || header[1] !== 0x5a) {
        return {
          ok: false,
          size: info.size,
          error: 'Downloaded installer does not have a valid Windows PE (MZ) header.',
        };
      }
      return { ok: true, size: info.size };
    } finally {
      await handle.close();
    }
  } catch {
    return {
      ok: false,
      size: 0,
      error: 'Downloaded installer file is missing or unreadable.',
    };
  }
}

async function computeFileSha256(filePath: string): Promise<string> {
  const handle = await open(filePath, 'r');
  const hash = createHash('sha256');
  try {
    const buf = Buffer.alloc(64 * 1024);
    let offset = 0;
    while (true) {
      const { bytesRead } = await handle.read(buf, 0, buf.length, offset);
      if (bytesRead === 0) break;
      hash.update(buf.subarray(0, bytesRead));
      offset += bytesRead;
    }
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}

async function resolveElectronApp(): Promise<{
  getVersion?: () => string;
  getPath?: (name: string) => string;
  quit?: () => void;
} | null> {
  try {
    const mod = await import('electron');
    return (mod as { app?: unknown }).app as {
      getVersion?: () => string;
      getPath?: (name: string) => string;
      quit?: () => void;
    } | null;
  } catch {
    return null;
  }
}

function createAbortSignal(timeoutMs: number): AbortSignal | undefined {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

export class TorveUpdater {
  private state: TorveUpdaterState;
  private readonly listeners = new Set<(state: TorveUpdaterState) => void>();
  private readonly releaseEndpoints: string[];
  private readonly autoDownload: boolean;
  private readonly fetchFn: typeof fetch;
  private readonly spawnFn: (command: string, args: string[], options: SpawnOptions) => { unref: () => void };
  private readonly onQuit?: () => void;
  private customTempDir?: string;
  private downloadUrl: string | null = null;
  private hasExplicitVersion: boolean;
  private inFlightCheck: Promise<TorveUpdaterState> | null = null;
  private inFlightDownload: Promise<{ ok: boolean; filePath?: string; error?: string }> | null = null;
  private activeCheckSilent = false;

  constructor(options: TorveUpdaterOptions = {}) {
    this.hasExplicitVersion = Boolean(options.currentVersion);
    this.releaseEndpoints = options.releaseUrl
      ? [options.releaseUrl]
      : [
          options.torveUpdatesUrl ?? TORVE_UPDATES_URL,
          options.fallbackReleaseUrl ?? GITHUB_RELEASES_LIST_URL,
        ];
    this.autoDownload = options.autoDownload ?? true;
    this.fetchFn = options.fetchFn ?? fetch;
    this.spawnFn = options.spawnFn ?? ((cmd, args, opts) => spawn(cmd, args, opts));
    this.onQuit = options.onQuit;
    this.customTempDir = options.tempDir;

    this.state = {
      phase: 'idle',
      currentVersion: (options.currentVersion ?? '0.0.0').replace(/^v/i, ''),
      latestVersion: null,
      releaseName: null,
      releaseUrl: null,
      releaseNotes: null,
      assetName: null,
      assetSize: null,
      assetDigest: null,
      downloadPercent: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      downloadedFilePath: null,
      lastCheckedAt: null,
      error: null,
    };
  }

  getState(): TorveUpdaterState {
    return { ...this.state };
  }

  onStateChange(listener: (state: TorveUpdaterState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(patch: Partial<TorveUpdaterState>): TorveUpdaterState {
    this.state = { ...this.state, ...patch };
    const snapshot = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // Isolate listener failures so updater state machine stays healthy.
      }
    }
    return snapshot;
  }

  private async ensureCurrentVersion(): Promise<string> {
    if (!this.hasExplicitVersion) {
      const electronApp = await resolveElectronApp();
      const ver = electronApp?.getVersion?.();
      if (ver) {
        this.hasExplicitVersion = true;
        this.setState({ currentVersion: ver.replace(/^v/i, '') });
      }
    }
    return this.state.currentVersion;
  }

  private async resolveTempDir(): Promise<string> {
    if (this.customTempDir) return this.customTempDir;
    const electronApp = await resolveElectronApp();
    const electronTemp = electronApp?.getPath?.('temp');
    return electronTemp || tmpdir();
  }

  async checkForUpdates(options: { silent?: boolean } = {}): Promise<TorveUpdaterState> {
    if (this.state.phase === 'downloading' || this.state.phase === 'installing') {
      return this.getState();
    }
    if (this.state.phase === 'ready' && this.state.downloadedFilePath && options.silent) {
      return this.getState();
    }

    if (!options.silent) {
      this.activeCheckSilent = false;
    }
    if (this.inFlightCheck) {
      return this.inFlightCheck;
    }

    this.activeCheckSilent = Boolean(options.silent);
    this.inFlightCheck = this.performCheckForUpdates().finally(() => {
      this.inFlightCheck = null;
      this.activeCheckSilent = false;
    });
    return this.inFlightCheck;
  }

  private handleCheckFailure(
    previousPhase: UpdaterPhase,
    errorMsg: string,
    extra: Partial<TorveUpdaterState> = {},
  ): TorveUpdaterState {
    const fallbackPhase: UpdaterPhase =
      previousPhase === 'checking' || previousPhase === 'error' ? 'idle' : previousPhase;
    return this.setState({
      ...extra,
      phase: this.activeCheckSilent ? fallbackPhase : 'error',
      lastCheckedAt: Date.now(),
      error: errorMsg,
    });
  }

  private async fetchLatestCandidate(currentVersion: string): Promise<{
    ok: boolean;
    candidate: ResolvedReleaseCandidate | null;
    emptySuccess: boolean;
  }> {
    let anyEmptySuccess = false;
    for (const endpoint of this.releaseEndpoints) {
      try {
        const response = await this.fetchFn(endpoint, {
          headers: {
            Accept: 'application/vnd.github+json, application/json',
            'User-Agent': `Torve-Desktop/${currentVersion} (Windows)`,
          },
          signal: createAbortSignal(5_000),
        });
        if (!response.ok) continue;

        const payload = (await response.json()) as unknown;
        if (Array.isArray(payload) && payload.length === 0) {
          anyEmptySuccess = true;
          continue;
        }
        const candidate = selectBestReleaseCandidate(payload);
        if (candidate) {
          return { ok: true, candidate, emptySuccess: false };
        }
      } catch {
        // Fall through cleanly to next configured endpoint.
      }
    }

    return { ok: false, candidate: null, emptySuccess: anyEmptySuccess };
  }

  private async performCheckForUpdates(): Promise<TorveUpdaterState> {
    const previousPhase = this.state.phase;
    const currentVersion = await this.ensureCurrentVersion();
    if (!(this.activeCheckSilent && (previousPhase === 'available' || previousPhase === 'ready'))) {
      this.setState({ phase: 'checking', error: null });
    }

    const fetched = await this.fetchLatestCandidate(currentVersion);
    if (!fetched.ok) {
      if (fetched.emptySuccess) {
        this.downloadUrl = null;
        return this.setState({
          phase: 'up-to-date',
          latestVersion: currentVersion,
          releaseName: null,
          releaseUrl: null,
          releaseNotes: null,
          assetName: null,
          assetSize: null,
          assetDigest: null,
          lastCheckedAt: Date.now(),
          error: null,
        });
      }
      return this.handleCheckFailure(previousPhase, FRIENDLY_UPDATE_CHECK_ERROR);
    }

    const candidate = fetched.candidate!;
    if (
      previousPhase === 'ready'
      && this.state.downloadedFilePath
      && this.state.latestVersion
      && compareSemver(candidate.version, this.state.latestVersion) <= 0
    ) {
      return this.setState({
        phase: 'ready',
        lastCheckedAt: Date.now(),
        error: null,
      });
    }

    const isNewer = compareSemver(candidate.version, currentVersion) > 0;
    if (!isNewer) {
      this.downloadUrl = null;
      return this.setState({
        phase: 'up-to-date',
        latestVersion: candidate.version,
        releaseName: candidate.releaseName,
        releaseUrl: null,
        releaseNotes: candidate.releaseNotes,
        assetName: null,
        assetSize: null,
        assetDigest: null,
        lastCheckedAt: Date.now(),
        error: null,
      });
    }

    if (!candidate.asset) {
      this.downloadUrl = null;
      return this.setState({
        phase: 'up-to-date',
        latestVersion: currentVersion,
        lastCheckedAt: Date.now(),
        error: null,
      });
    }

    this.downloadUrl = candidate.asset.browser_download_url;
    const availableState = this.setState({
      phase: 'available',
      latestVersion: candidate.version,
      releaseName: candidate.releaseName,
      releaseUrl: null,
      releaseNotes: candidate.releaseNotes,
      assetName: candidate.asset.name,
      assetSize: typeof candidate.asset.size === 'number' ? candidate.asset.size : null,
      assetDigest: candidate.asset.digest ?? null,
      downloadPercent: 0,
      downloadedBytes: 0,
      totalBytes: typeof candidate.asset.size === 'number' ? candidate.asset.size : 0,
      downloadedFilePath: null,
      lastCheckedAt: Date.now(),
      error: null,
    });

    if (this.autoDownload) {
      void this.downloadUpdate().catch(() => {});
    }

    return availableState;
  }

  async downloadUpdate(): Promise<{ ok: boolean; filePath?: string; error?: string }> {
    if (this.inFlightDownload) {
      return this.inFlightDownload;
    }
    if (this.state.phase === 'ready' && this.state.downloadedFilePath) {
      return { ok: true, filePath: this.state.downloadedFilePath };
    }
    if (!this.downloadUrl || !this.state.assetName) {
      return { ok: false, error: 'No update available to download.' };
    }

    this.inFlightDownload = this.performDownloadUpdate().finally(() => {
      this.inFlightDownload = null;
    });
    return this.inFlightDownload;
  }

  private async performDownloadUpdate(): Promise<{ ok: boolean; filePath?: string; error?: string }> {
    const tempDir = await this.resolveTempDir();
    const safeAssetName = path.basename(this.state.assetName!);
    const destPath = path.join(tempDir, safeAssetName);
    const partPath = `${destPath}.part`;

    this.setState({
      phase: 'downloading',
      downloadPercent: 0,
      downloadedBytes: 0,
      totalBytes: this.state.assetSize ?? 0,
      downloadedFilePath: null,
      error: null,
    });

    try {
      const response = await this.fetchFn(this.downloadUrl!, {
        headers: {
          'User-Agent': `Torve-Desktop/${this.state.currentVersion} (Windows)`,
        },
        redirect: 'follow',
      });

      if (!response.ok || !response.body) {
        this.setState({ phase: 'error', error: FRIENDLY_UPDATE_DOWNLOAD_ERROR });
        return { ok: false, error: FRIENDLY_UPDATE_DOWNLOAD_ERROR };
      }

      const contentLength = Number.parseInt(response.headers.get('content-length') ?? '', 10);
      const totalBytes =
        Number.isFinite(contentLength) && contentLength > 0
          ? contentLength
          : (this.state.assetSize ?? 0);

      let downloadedBytes = 0;
      let lastPercent = -1;

      const nodeStream = Readable.fromWeb(response.body as unknown as WebReadableStream);
      const fileStream = createWriteStream(partPath);

      await new Promise<void>((resolve, reject) => {
        nodeStream.on('data', (chunk: Buffer) => {
          downloadedBytes += chunk.length;
          const percent = totalBytes > 0
            ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
            : 0;
          if (percent !== lastPercent) {
            lastPercent = percent;
            this.setState({
              phase: 'downloading',
              downloadedBytes,
              totalBytes,
              downloadPercent: percent,
            });
          }
        });
        nodeStream.on('error', reject);
        fileStream.on('error', reject);
        fileStream.on('finish', () => resolve());
        nodeStream.pipe(fileStream);
      });

      const peCheck = await verifyPeHeader(partPath);
      if (!peCheck.ok) {
        await rm(partPath, { force: true }).catch(() => {});
        const msg = peCheck.error ?? 'Downloaded installer failed integrity check.';
        this.setState({ phase: 'error', error: msg });
        return { ok: false, error: msg };
      }

      if (this.state.assetDigest && this.state.assetDigest.startsWith('sha256:')) {
        const expected = this.state.assetDigest.slice('sha256:'.length).trim().toLowerCase();
        const actual = await computeFileSha256(partPath);
        if (actual !== expected) {
          await rm(partPath, { force: true }).catch(() => {});
          const msg = 'Downloaded installer verification check failed.';
          this.setState({ phase: 'error', error: msg });
          return { ok: false, error: msg };
        }
      }

      await rm(destPath, { force: true }).catch(() => {});
      await rename(partPath, destPath);

      this.setState({
        phase: 'ready',
        downloadPercent: 100,
        downloadedBytes: peCheck.size,
        totalBytes: totalBytes || peCheck.size,
        downloadedFilePath: destPath,
        error: null,
      });
      return { ok: true, filePath: destPath };
    } catch {
      await rm(partPath, { force: true }).catch(() => {});
      this.setState({ phase: 'error', error: FRIENDLY_UPDATE_DOWNLOAD_ERROR });
      return { ok: false, error: FRIENDLY_UPDATE_DOWNLOAD_ERROR };
    }
  }

  async installDownloadedUpdate(): Promise<{ ok: boolean; error?: string }> {
    const filePath = this.state.downloadedFilePath;
    if (!filePath) {
      return { ok: false, error: 'No downloaded update is ready to install.' };
    }

    const peCheck = await verifyPeHeader(filePath);
    if (!peCheck.ok) {
      const msg = peCheck.error ?? 'Downloaded installer is missing or invalid.';
      this.setState({ phase: 'error', error: msg });
      return { ok: false, error: msg };
    }

    try {
      this.setState({ phase: 'installing', error: null });
      const child = this.spawnFn(filePath, [], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.unref();

      const quit = this.onQuit ?? (async () => {
        const electronApp = await resolveElectronApp();
        electronApp?.quit?.();
      });
      setTimeout(() => {
        void quit();
      }, 150);

      return { ok: true };
    } catch {
      const msg = 'Unable to launch the update installer.';
      this.setState({ phase: 'error', error: msg });
      return { ok: false, error: msg };
    }
  }
}

let singletonUpdater: TorveUpdater | null = null;

export function getTorveUpdater(options?: TorveUpdaterOptions): TorveUpdater {
  if (!singletonUpdater) {
    singletonUpdater = new TorveUpdater(options);
  }
  return singletonUpdater;
}

export function getUpdaterState(): TorveUpdaterState {
  return getTorveUpdater().getState();
}

export function onUpdaterStateChange(listener: (state: TorveUpdaterState) => void): () => void {
  return getTorveUpdater().onStateChange(listener);
}

export function checkForUpdates(options?: { silent?: boolean }): Promise<TorveUpdaterState> {
  return getTorveUpdater().checkForUpdates(options);
}

export function downloadUpdate(): Promise<{ ok: boolean; filePath?: string; error?: string }> {
  return getTorveUpdater().downloadUpdate();
}

export function installDownloadedUpdate(): Promise<{ ok: boolean; error?: string }> {
  return getTorveUpdater().installDownloadedUpdate();
}

export const installUpdate = installDownloadedUpdate;
