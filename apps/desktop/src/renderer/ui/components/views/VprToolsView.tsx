import { useCallback, useEffect, useMemo, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowReloadHorizontalIcon,
  ArrowRight01Icon,
  ArrowUpRight01Icon,
  Settings02Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { Modal } from '@torveai/ui';
import type {
  AntigravityStandalonePatchStatus,
  InstalledAppEntry,
  RuntimeProcessState,
  SystemProxyProfileSummary,
} from '../../../types/bridge';
import type { ViewName } from '../../types';
import { installedAppsResource, refreshSystemProxyProfilesForce, systemProxyResource } from '../../../modules/app/vpr-resources';
import { useCachedResource } from '../../../modules/app/cached-resource';
import { activeProfilesFromRuntimeState } from '../../../modules/routing/tools';
import { BrandIcon, resolveBrandKey, shouldPreferBundledBrandIcon } from '../brand/BrandIcon';
import { TorveMark } from '../brand/TorveMark';
import { useTorveToast } from '../torve/TorveToastContext';
import {
  ACTIVE_APP_DISPLAY_NAMES,
  ACTIVE_APP_IDS,
  ACTIVE_APP_ORDER,
  ACTIVE_APP_ROSTER,
  BRIDGE_HARNESSES,
  buildBridgeHarnesses,
  getConnectedBridgeIds,
  isActiveProgressStage,
  type ActiveAppId,
  useHarnessBridge,
} from '../torve/app-bridge';
import { BrandBridge } from '../../../components/motion-brew/brand-bridge';
import { VprPage, VprSearch } from '../vpr/VprKit';
import { AppsOnboarding } from './AppsOnboarding';
import { isAppsOnboardingSeen, persistAppsOnboardingSeen } from '../../../modules/app/apps-onboarding';
import styles from './VprToolsView.module.scss';

export { ACTIVE_APP_IDS, ACTIVE_APP_ROSTER, BRIDGE_HARNESSES, type ActiveAppId };

export const COMING_SOON_APPS = [
  { id: 'cursor', name: 'Cursor', brand: 'cursor' as const },
  { id: 'cline-roo', name: 'Cline / Roo Code', brand: 'generic' as const },
  { id: 'aider', name: 'Aider', brand: 'generic' as const },
  { id: 'continue', name: 'Continue', brand: 'generic' as const },
] as const;

const ACTIVE_APP_INFO: Readonly<Record<string, { description: string; websiteUrl?: string }>> = {
  antigravity: {
    description: 'Unified Native Model Picker and MCP Bridge for Google Antigravity. Connecting configures both the MCP bridge and the standalone Native Model Picker.',
  },
  codex: {
    description: 'OpenAI’s coding agent for building, reviewing, and shipping software.',
    websiteUrl: 'https://openai.com/codex/',
  },
  opencode: {
    description: 'An open-source coding agent for the terminal, desktop, and IDE.',
    websiteUrl: 'https://opencode.ai/',
  },
  'claude-desktop': {
    description: 'Anthropic’s desktop application — Torve routes its Code (</>) tab through your Torve account.',
    websiteUrl: 'https://claude.ai/download',
  },
  'claude-code': {
    description: 'Anthropic’s terminal coding CLI, routed through the model selected in Torve.',
    websiteUrl: 'https://code.claude.com/docs/en/overview',
  },
  'gemini-cli': {
    description: 'Google Gemini CLI configured persistently through its official environment and settings files.',
    websiteUrl: 'https://geminicli.com/',
  },
};

function appInfo(profile: SystemProxyProfileSummary): { description: string; websiteUrl?: string } {
  const builtIn = ACTIVE_APP_INFO[profile.name];
  if (builtIn) return builtIn;
  const domain = profile.domains[0];
  return {
    description: `${profile.displayName} is configured to use Torve for AI requests.`,
    ...(domain ? { websiteUrl: `https://${domain}` } : {}),
  };
}

/** Two-pane modal navigation: the main pane slides to the application list. */
type ModalPane = { pane: 'main' | 'apps'; dir: 'none' | 'forward' | 'back' };

type AntigravityBridgeExtras = {
  antigravityStandaloneCloseAndEnable?: () => Promise<{ ok: boolean; status?: AntigravityStandalonePatchStatus; error?: string }>;
  antigravityLaunch?: () => Promise<{ ok: boolean; targetPath?: string; error?: string }>;
};

function antigravityStatusSummary(patch: AntigravityStandalonePatchStatus | null): {
  text: string;
  tone: 'default' | 'ok' | 'warn' | 'error';
} {
  if (!patch) return { text: 'Checking standalone Google Antigravity…', tone: 'default' };
  if (!patch.installed) return { text: 'MCP Bridge only (standalone Google Antigravity not found)', tone: 'default' };
  if (patch.enabled && patch.running) return { text: 'Native Model Picker: Active (Close Google Antigravity to disconnect)', tone: 'warn' };
  if (patch.enabled) return { text: 'Native Model Picker: Active', tone: 'ok' };
  if (patch.state === 'needs-reapply' && !patch.running) {
    return { text: 'Native Model Picker: Needs re-apply after Antigravity update', tone: 'warn' };
  }
  if (patch.running || patch.state === 'close-antigravity') {
    return { text: 'Close Google Antigravity to apply Native Model Picker', tone: 'warn' };
  }
  if (patch.state === 'error') {
    return { text: `Native Model Picker: ${patch.message}`, tone: 'error' };
  }
  return { text: 'Native Model Picker: Off (applied automatically on connect)', tone: 'default' };
}

let cachedCloudModelsSnapshot: Array<{ id: string }> = [];

const OPENABLE_PROFILE_NAMES = new Set([
  'antigravity',
  'claude-desktop',
  'opencode',
  'codex',
]);

function QuickOpenIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 4h6v6" />
      <path d="M10 14L20 4" />
      <path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

function QuickRestartIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function QuickRefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

  // Logo SVGs moved to BrandIcon + app-bridge.tsx

export function normalizeActiveAppProfiles(profiles: SystemProxyProfileSummary[]): SystemProxyProfileSummary[] {
  return profiles
    .filter((profile) => ACTIVE_APP_IDS.has(profile.name))
    .map((profile) => ({
      ...profile,
      displayName: ACTIVE_APP_DISPLAY_NAMES[profile.name] ?? profile.displayName,
    }))
    .sort((a, b) => (ACTIVE_APP_ORDER[a.name] ?? 99) - (ACTIVE_APP_ORDER[b.name] ?? 99));
}

export function partitionActiveProfiles(
  profiles: SystemProxyProfileSummary[],
  activeProfiles: ReadonlySet<string> | null,
): {
  installedProfiles: SystemProxyProfileSummary[];
  notInstalledProfiles: SystemProxyProfileSummary[];
} {
  const normalized = normalizeActiveAppProfiles(profiles);
  const installedProfiles: SystemProxyProfileSummary[] = [];
  const notInstalledProfiles: SystemProxyProfileSummary[] = [];

  for (const profile of normalized) {
    const connected = activeProfiles?.has(profile.name) ?? false;
    const isInstalled = connected || profile.installed !== false;
    if (isInstalled) installedProfiles.push(profile);
    else notInstalledProfiles.push(profile);
  }

  installedProfiles.sort((a, b) => {
    const aConn = Number(activeProfiles?.has(a.name) ?? false);
    const bConn = Number(activeProfiles?.has(b.name) ?? false);
    if (aConn !== bConn) return bConn - aConn;
    return (ACTIVE_APP_ORDER[a.name] ?? 99) - (ACTIVE_APP_ORDER[b.name] ?? 99);
  });

  return { installedProfiles, notInstalledProfiles };
}

export type VprToolsViewSnapshot = {
  profiles?: SystemProxyProfileSummary[];
  activeProfileNames?: string[];
  cloudConnected?: boolean;
  cloudModels?: Array<{ id: string }>;
  antigravityPatch?: AntigravityStandalonePatchStatus | null;
};

type Props = {
  onSelectView?: (view: ViewName) => void;
  initialSnapshot?: VprToolsViewSnapshot;
};

export function VprToolsView({ initialSnapshot }: Props = {}) {
  const toast = useTorveToast();
  const proxyResource = useCachedResource(systemProxyResource);
  const rawProfiles = (proxyResource.data?.profiles && proxyResource.data.profiles.length > 0
    ? proxyResource.data.profiles
    : undefined) ?? initialSnapshot?.profiles ?? proxyResource.data?.profiles ?? [];
  const proxyState = proxyResource.data?.state ?? (
    initialSnapshot?.activeProfileNames
      ? { mode: 'system-proxy' as const, running: true, activeProfileNames: initialSnapshot.activeProfileNames }
      : null
  );

  const [showOnboarding, setShowOnboarding] = useState(() => !isAppsOnboardingSeen());
  useEffect(() => {
    if (showOnboarding) persistAppsOnboardingSeen();
  }, [showOnboarding]);

  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [cloudModels, setCloudModels] = useState<Array<{ id: string }>>(
    () => initialSnapshot?.cloudModels ?? cachedCloudModelsSnapshot,
  );
  const [modelOverrides, setModelOverrides] = useState<Record<string, { modelId: string; enabled: boolean }>>({});
  const [cloudConnected, setCloudConnected] = useState(initialSnapshot?.cloudConnected ?? false);
  const [antigravityPatch, setAntigravityPatch] = useState<AntigravityStandalonePatchStatus | null>(
    initialSnapshot?.antigravityPatch ?? null,
  );
  const [antigravityInlineNotice, setAntigravityInlineNotice] = useState<string | null>(null);
  const [backupsByApp, setBackupsByApp] = useState<Record<string, { filesCount: number; updatedAt: number }>>({});
  const [appsRefreshing, setAppsRefreshing] = useState(false);
  const [notInstalledOpen, setNotInstalledOpen] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);

  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [settingsPane, setSettingsPane] = useState<ModalPane>({ pane: 'main', dir: 'none' });
  const [pickerSearch, setPickerSearch] = useState('');
  const [identityDraft, setIdentityDraft] = useState('');
  const [launchDraft, setLaunchDraft] = useState<InstalledAppEntry | null | undefined>(undefined);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const installedAppsResourceSnapshot = useCachedResource(installedAppsResource, false);
  const installedApps = installedAppsResourceSnapshot.data;
  const installedAppsError = installedAppsResourceSnapshot.error;

  const profiles = useMemo(() => normalizeActiveAppProfiles(rawProfiles), [rawProfiles]);
  const activeProfiles = useMemo(() => activeProfilesFromRuntimeState(proxyState), [proxyState]);
  const activeProfileNames = useMemo(() => activeProfiles ? [...activeProfiles] : [], [activeProfiles]);

  const connectedBridgeIds = useMemo(() => getConnectedBridgeIds(activeProfileNames), [activeProfileNames]);
  const bridgeHarnesses = useMemo(
    () => buildBridgeHarnesses(profiles, activeProfiles),
    [activeProfiles, profiles],
  );

  const { installedProfiles, notInstalledProfiles } = useMemo(
    () => partitionActiveProfiles(profiles, activeProfiles),
    [profiles, activeProfiles],
  );

  const displayNameFor = useCallback((profileName: string) => (
    ACTIVE_APP_DISPLAY_NAMES[profileName]
    ?? profiles.find((profile) => profile.name === profileName)?.displayName
    ?? profileName
  ), [profiles]);

  const setupProfiles = useMemo(() => {
    const metadata = proxyState as (Record<string, unknown> | null);
    return new Set(
      Array.isArray(metadata?.setupProfileNames)
        ? metadata.setupProfileNames.filter((name): name is string => typeof name === 'string')
        : [],
    );
  }, [proxyState]);

  const refresh = systemProxyResource.refresh;

  const refreshCloudModels = useCallback(async (force = false) => {
    const bridge = typeof window !== 'undefined' ? window.torveDesktop : undefined;
    try {
      if (force) {
        const refreshed = await bridge?.torveModelsRefresh?.();
        if (refreshed && !refreshed.ok) throw new Error(refreshed.error ?? 'Unable to refresh Torve models');
      }
      void bridge?.torveModelsGet?.().then((catalog) => {
        if (Array.isArray(catalog?.models)) {
          cachedCloudModelsSnapshot = catalog.models;
          setCloudModels(catalog.models);
        }
      });
      void bridge?.torveAccountGet?.().then((account) => {
        setCloudConnected(account?.connected === true);
      });
      void bridge?.torveOverridesGet?.().then((overrides) => {
        if (overrides) setModelOverrides(overrides);
      });
      void bridge?.torveBackupsList?.().then((backups) => {
        if (Array.isArray(backups)) {
          setBackupsByApp(Object.fromEntries(backups.map((b) => [
            b.appId,
            { filesCount: b.filesCount ?? b.files?.length ?? 0, updatedAt: b.updatedAt ?? b.patchedAt ?? 0 },
          ])));
        }
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setMessage(errMsg);
      toast.push({ kind: 'error', title: 'Model refresh failed', description: errMsg });
    }
  }, [toast]);

  useEffect(() => {
    void refreshCloudModels(false);
    const bridge = typeof window !== 'undefined' ? window.torveDesktop : undefined;
    const unsubModels = bridge?.onTorveModelsUpdated?.((catalog) => {
      if (Array.isArray(catalog?.models)) {
        cachedCloudModelsSnapshot = catalog.models;
        setCloudModels(catalog.models);
      }
    });
    const unsubAuth = bridge?.onTorveAuthEvent?.((event) => {
      if (event.status === 'connected') {
        setCloudConnected(true);
        void refreshCloudModels(false);
      } else if (event.status === 'cancelled') {
        setCloudConnected(false);
      }
    });
    return () => {
      unsubModels?.();
      unsubAuth?.();
    };
  }, [refreshCloudModels]);

  const handleRuntimeStateUpdated = useCallback(
    (state: RuntimeProcessState | null) => {
      systemProxyResource.setData({ profiles: rawProfiles, state });
    },
    [rawProfiles],
  );

  const handleAfterStartSuccess = useCallback(() => {
    void refreshCloudModels(false);
  }, [refreshCloudModels]);

  const {
    busy,
    connecting,
    antigravityPatchBusy,
    setAntigravityPatchBusy,
    progressByApp,
    activeProgressBanner,
    displayNameFor: displayNameFromBridge,
    refreshAntigravityPatch,
    startProfiles,
    disconnect,
    connectProfile,
    disconnectProfile,
    toggleBridgeHarness,
    openUrl,
    openTool,
  } = useHarnessBridge({
    profiles,
    activeProfileNames,
    cloudConnected,
    proxyPeerId: typeof proxyState?.peerId === 'string' ? proxyState.peerId : null,
    antigravityPatch,
    setAntigravityPatch,
    onRuntimeStateUpdated: handleRuntimeStateUpdated,
    onAfterStartSuccess: handleAfterStartSuccess,
    onMessage: setMessage,
    onInlineAntigravityNotice: setAntigravityInlineNotice,
    launchAfterConnect: true,
  });
  useEffect(() => { void refreshAntigravityPatch(false); }, [refreshAntigravityPatch]);
  void displayNameFromBridge;

  const applyAntigravityPicker = useCallback(async () => {
    setAntigravityPatchBusy(true);
    setMessage(null);
    setAntigravityInlineNotice(null);
    try {
      const result = await window.torveDesktop?.antigravityStandaloneSet?.(true);
      if (result?.status) setAntigravityPatch(result.status);
      else await refreshAntigravityPatch(true);
      if (!result?.ok) throw new Error(result?.error ?? 'Unable to apply the Google Antigravity native picker patch.');
      toast.push({
        kind: 'success',
        title: 'Google Antigravity picker applied',
        description: 'Native Model Picker is now active.',
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setMessage(errMsg);
      setAntigravityInlineNotice(errMsg);
      toast.push({ kind: 'error', title: 'Google Antigravity patch failed', description: errMsg });
      await refreshAntigravityPatch(true);
    } finally {
      setAntigravityPatchBusy(false);
    }
  }, [refreshAntigravityPatch, toast]);

  const closeAndEnableAntigravityPicker = useCallback(async () => {
    setAntigravityPatchBusy(true);
    setMessage(null);
    setAntigravityInlineNotice(null);
    try {
      const bridge = window.torveDesktop as (Window['torveDesktop'] & AntigravityBridgeExtras) | undefined;
      const result = await bridge?.antigravityStandaloneCloseAndEnable?.();
      if (result?.status) setAntigravityPatch(result.status);
      else await refreshAntigravityPatch(true);
      if (!result?.ok) throw new Error(result?.error ?? 'Unable to close Google Antigravity and apply the native picker patch.');
      toast.push({
        kind: 'success',
        title: 'Google Antigravity updated',
        description: 'Closed Google Antigravity and enabled Native Model Picker.',
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setMessage(errMsg);
      setAntigravityInlineNotice(errMsg);
      toast.push({ kind: 'error', title: 'Could not patch Google Antigravity', description: errMsg });
      await refreshAntigravityPatch(true);
    } finally {
      setAntigravityPatchBusy(false);
    }
  }, [refreshAntigravityPatch, toast]);

  const launchAntigravityApp = useCallback(async () => {
    setAntigravityPatchBusy(true);
    setMessage(null);
    try {
      const bridge = window.torveDesktop as (Window['torveDesktop'] & AntigravityBridgeExtras) | undefined;
      const result = await bridge?.antigravityLaunch?.();
      if (result && !result.ok) {
        const errMsg = result.error ?? 'Unable to launch Google Antigravity.';
        setMessage(errMsg);
        toast.push({ kind: 'error', title: 'Could not launch Google Antigravity', description: errMsg });
      } else {
        window.setTimeout(() => { void refreshAntigravityPatch(true); }, 1000);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setMessage(errMsg);
      toast.push({ kind: 'error', title: 'Could not launch Google Antigravity', description: errMsg });
    } finally {
      setAntigravityPatchBusy(false);
    }
  }, [refreshAntigravityPatch, toast]);

  const setAppModel = useCallback(async (appId: string, modelId: string) => {
    const result = await window.torveDesktop?.torveOverrideSet?.(appId, modelId ? { modelId, enabled: true } : null);
    if (!result?.ok) {
      const errMsg = result?.error ?? 'Unable to save the model selection';
      setMessage(errMsg);
      toast.push({ kind: 'error', title: 'Model update failed', description: errMsg });
      return;
    }
    setModelOverrides(result.overrides ?? {});
    toast.push({
      kind: 'success',
      title: `${displayNameFor(appId)} model updated`,
      description: modelId ? `Pinned to ${modelId}` : 'Using Automatic routing',
    });
  }, [displayNameFor, toast]);

  useEffect(() => {
    if (proxyState?.running || rawProfiles.length === 0) return;
    void window.torveDesktop?.torveDirectState?.().then((state) => {
      if (state?.activeProfileNames?.length) systemProxyResource.setData({ profiles: rawProfiles, state });
    }).catch(() => undefined);
  }, [rawProfiles, proxyState?.running]);

  const openConnectedApp = useCallback(async (profile: SystemProxyProfileSummary) => {
    const bridge = window.torveDesktop;
    setActionBusy(profile.name);
    setMessage(null);
    try {
      if (profile.appAction === 'open-url' && profile.openUrl && !profile.launchAppName) {
        await openUrl(profile.openUrl);
        return;
      }
      if (bridge?.torveAppOpen) {
        const result = await bridge.torveAppOpen(profile.name);
        if (!result.ok) {
          const errMsg = result.error ?? `Could not open ${profile.displayName}`;
          setMessage(errMsg);
          toast.push({ kind: 'error', title: `Could not open ${profile.displayName}`, description: errMsg });
        } else if (profile.name === 'antigravity') {
          window.setTimeout(() => { void refreshAntigravityPatch(true); }, 1000);
        }
        return;
      }
      await openTool(profile.toolName ?? profile.name);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setMessage(errMsg);
      toast.push({ kind: 'error', title: `Could not open ${profile.displayName}`, description: errMsg });
    } finally {
      setActionBusy(null);
    }
  }, [openTool, openUrl, refreshAntigravityPatch, toast]);

  const restartApp = useCallback(async (profileName: string, label: string) => {
    const bridge = window.torveDesktop;
    if (!bridge?.torveAppRestart && !bridge?.systemProxyRestartApp) return;
    setActionBusy(profileName);
    setMessage(null);
    try {
      if (bridge.torveAppRestart) {
        const result = await bridge.torveAppRestart(profileName);
        if (!result.ok) {
          const errMsg = result.error ?? `Unable to restart ${label}`;
          setMessage(errMsg);
          toast.push({ kind: 'error', title: `Could not restart ${label}`, description: errMsg });
        } else if (result.needsSessionRestart) {
          const detail = result.detail ?? `${label} config verified — start a new CLI session to apply.`;
          setMessage(detail);
          toast.push({ kind: 'info', title: `${label} verified`, description: detail });
        } else {
          const detail = result.detail ?? `Restarted ${label}`;
          setMessage(detail);
          toast.push({ kind: 'success', title: `${label} restarted`, description: detail });
        }
        if (result.ok) {
          await refresh();
          if (profileName === 'antigravity') await refreshAntigravityPatch(true);
        }
        return;
      }
      const result = await bridge.systemProxyRestartApp!(profileName);
      if (result.ok) {
        setMessage(`Restarted ${label}`);
        toast.push({ kind: 'success', title: `${label} restarted` });
        await refresh();
      } else {
        const errMsg = result.error ?? `Unable to restart ${label}`;
        setMessage(errMsg);
        toast.push({ kind: 'error', title: `Could not restart ${label}`, description: errMsg });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setMessage(errMsg);
      toast.push({ kind: 'error', title: `Could not restart ${label}`, description: errMsg });
    } finally {
      setActionBusy(null);
    }
  }, [refresh, refreshAntigravityPatch, toast]);

  const refreshConnectedApp = useCallback(async (profileName: string, label: string) => {
    const bridge = window.torveDesktop;
    if (!bridge?.torveAppRefresh) return;
    setActionBusy(profileName);
    setMessage(null);
    try {
      const result = await bridge.torveAppRefresh(profileName);
      if (!result.ok) {
        const errMsg = result.error ?? `Unable to verify ${label}`;
        setMessage(errMsg);
        toast.push({ kind: 'error', title: `${label} verification failed`, description: errMsg });
      } else {
        const detail = result.detail ?? `${label} config & proxy verified.`;
        setMessage(detail);
        toast.push({ kind: 'success', title: `${label} verified`, description: detail });
      }
      await Promise.all([
        refresh(),
        refreshCloudModels(false),
        ...(profileName === 'antigravity' ? [refreshAntigravityPatch(true)] : []),
      ]);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setMessage(errMsg);
      toast.push({ kind: 'error', title: `${label} refresh failed`, description: errMsg });
    } finally {
      setActionBusy(null);
    }
  }, [refresh, refreshAntigravityPatch, refreshCloudModels, toast]);

  // ---------- Per-app settings modal ----------

  const ensureInstalledApps = useCallback(() => {
    if (installedApps === null && !installedAppsResourceSnapshot.loading) {
      void installedAppsResource.refresh();
    }
  }, [installedApps, installedAppsResourceSnapshot.loading]);

  const openSettings = useCallback((profile: SystemProxyProfileSummary) => {
    setSettingsFor(profile.name);
    setSettingsPane({ pane: 'main', dir: 'none' });
    setPickerSearch('');
    setIdentityDraft((profile.toolSlugs?.length ? profile.toolSlugs : [profile.name]).join(', '));
    setLaunchDraft(undefined);
    ensureInstalledApps();
  }, [ensureInstalledApps]);

  const chooseApp = useCallback((app: InstalledAppEntry | null) => {
    setLaunchDraft(app);
    setSettingsPane({ pane: 'main', dir: 'back' });
  }, []);

  const settingsProfile = settingsFor ? profiles.find((profile) => profile.name === settingsFor) ?? null : null;
  const settingsInfo = settingsProfile ? appInfo(settingsProfile) : null;
  const settingsIdentity = settingsProfile
    ? (settingsProfile.toolSlugs?.length ? settingsProfile.toolSlugs : [settingsProfile.name]).join(', ')
    : '';
  const identityDirty = settingsProfile !== null && identityDraft.trim() !== settingsIdentity;
  const launchDirty = settingsProfile !== null && launchDraft !== undefined
    && (launchDraft?.name ?? null) !== (settingsProfile.launchAppName ?? null);
  const settingsDirty = identityDirty || launchDirty;
  const settingsLaunchName = launchDraft === undefined
    ? settingsProfile?.launchAppName ?? null
    : launchDraft?.name ?? null;

  const saveSettings = useCallback(async () => {
    const bridge = window.torveDesktop;
    if (!settingsFor || !bridge) return;
    setSettingsSaving(true);
    setMessage(null);
    try {
      if (activeProfileNames.includes(settingsFor)) {
        const remaining = activeProfileNames.filter((name) => name !== settingsFor);
        if (remaining.length === 0) await disconnect();
        else if (!await startProfiles(remaining)) return;
      }
      if (launchDirty && bridge.systemProxySetAppLaunch) {
        const result = await bridge.systemProxySetAppLaunch({
          name: settingsFor,
          app: launchDraft ? { name: launchDraft.name, path: launchDraft.path } : null,
        });
        if (!result.ok) {
          setMessage(result.error ?? 'Could not save the app setting');
          return;
        }
      }
      if (identityDirty && bridge.systemProxySetAppIdentity) {
        const slugs = identityDraft.split(',').map((entry) => entry.trim()).filter(Boolean);
        const result = await bridge.systemProxySetAppIdentity({ name: settingsFor, toolSlugs: slugs.length > 0 ? slugs : null });
        if (!result.ok) {
          setMessage(result.error ?? 'Could not save the client names');
          return;
        }
      }
      const listed = (await bridge.systemProxyListProfiles?.()) ?? [];
      systemProxyResource.setData({ profiles: listed, state: proxyState });
      setLaunchDraft(undefined);
      const updated = normalizeActiveAppProfiles(listed).find((profile) => profile.name === settingsFor);
      if (updated) setIdentityDraft((updated.toolSlugs?.length ? updated.toolSlugs : [updated.name]).join(', '));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSettingsSaving(false);
    }
  }, [activeProfileNames, disconnect, identityDirty, identityDraft, launchDirty, launchDraft, proxyState, settingsFor, startProfiles]);

  const renderProfileCard = (profile: SystemProxyProfileSummary) => {
    const connected = activeProfiles?.has(profile.name) ?? false;
    const isInstalled = connected || profile.installed !== false;
    const label = ACTIVE_APP_DISPLAY_NAMES[profile.name] ?? profile.displayName;
    const setupComplete = setupProfiles.has(profile.name);
    const rowProgress = progressByApp[profile.name];
    const progressActive = isActiveProgressStage(rowProgress?.stage);
    const rowBusy = connecting === profile.name || actionBusy === profile.name || progressActive;
    const canOpenApp = isInstalled && Boolean(
      profile.launchAppName
      || profile.appAction === 'open-url'
      || profile.appAction === 'open-tool'
      || OPENABLE_PROFILE_NAMES.has(profile.name),
    );
    const notInstalledTip = `Install ${label} first, then click Refresh Apps`;
    const brandKey = resolveBrandKey(profile.name, label);

    return (
      <div
        key={profile.name}
        className={`${styles.appPill}${connected ? ` ${styles.appPillConnected}` : ''}${!isInstalled ? ` ${styles.appPillUnavailable}` : ''}`}
      >
        <div className={styles.appHead}>
          <span className={styles.appIdentity}>
            {profile.iconDataUri && !shouldPreferBundledBrandIcon(brandKey) ? (
              <img src={profile.iconDataUri} alt="" className={styles.appIcon} />
            ) : (
              <BrandIcon brand={brandKey} size={24} />
            )}
            <span className={styles.appText}>
              <span className={styles.appNameRow}>
                {isInstalled && (profile.launchAppName || profile.appAction === 'open-url' || profile.appAction === 'open-tool') ? (
                  <button
                    type="button"
                    className={styles.appNameLink}
                    onClick={() => { void openConnectedApp(profile); }}
                    title={`Open ${profile.launchAppName ?? label}`}
                  >
                    {label}
                  </button>
                ) : (
                  <span className={styles.appName}>{label}</span>
                )}
                {profile.name === 'claude-desktop' ? <span className={styles.claudeCodeBadge}>&lt;/&gt; Code</span> : null}
                {profile.name === 'antigravity' ? <span className={styles.torveBetaBadge}>Beta</span> : null}
                {!isInstalled ? <span className={styles.notInstalledBadge}>Not Installed</span> : null}
              </span>
              {rowProgress ? (
                <span
                  className={`${styles.appMeta}${rowProgress.stage === 'error' ? ` ${styles.appMetaError}` : progressActive ? ` ${styles.appMetaProgress}` : ''}`}
                  title={rowProgress.detail ?? rowProgress.label}
                >
                  <span
                    className={
                      rowProgress.stage === 'error'
                        ? styles.errorDot
                        : progressActive
                          ? styles.progressDot
                          : styles.connectedDot
                    }
                    aria-hidden="true"
                  />
                  {rowProgress.label}
                </span>
              ) : connected ? (
                <span className={`${styles.appMeta}${profile.needsRestart ? ` ${styles.appMetaWarning}` : ''}`}>
                  <span className={profile.needsRestart ? styles.restartDot : styles.connectedDot} aria-hidden="true" />
                  {profile.needsRestart ? 'Restart required' : 'Connected'}
                </span>
              ) : null}
            </span>
          </span>
          <div className={styles.quickActionBar} role="group" aria-label={`${label} quick actions`}>
            {rowBusy ? (
              <span
                className={styles.appBusy}
                role="status"
                aria-label={rowProgress?.label ?? `Working on ${label}`}
                title={rowProgress?.label ?? `Working on ${label}`}
              />
            ) : null}
            <button
              type="button"
              className={styles.quickActionBtn}
              disabled={!isInstalled || rowBusy || !canOpenApp}
              onClick={() => { void openConnectedApp(profile); }}
              aria-label={`Open ${label}`}
              title={!isInstalled
                ? notInstalledTip
                : canOpenApp
                  ? `Open ${profile.launchAppName ?? label}`
                  : `${label} is a terminal CLI — launch it from your terminal`}
            >
              <QuickOpenIcon />
            </button>
            <button
              type="button"
              className={`${styles.quickActionBtn}${connected && profile.needsRestart ? ` ${styles.appRestartNeeded}` : ''}`}
              disabled={!isInstalled || rowBusy || !connected}
              onClick={() => { void restartApp(profile.name, label); }}
              aria-label={`Restart ${label}`}
              title={!isInstalled
                ? notInstalledTip
                : !connected
                  ? `Connect ${label} first to restart`
                  : profile.needsRestart
                    ? `Restart ${label} to apply the connection`
                    : `Restart GUI or verify CLI session for ${label}`}
            >
              <QuickRestartIcon />
            </button>
            <button
              type="button"
              className={styles.quickActionBtn}
              disabled={!isInstalled || rowBusy || !connected}
              onClick={() => { void refreshConnectedApp(profile.name, label); }}
              aria-label={`Refresh and verify ${label}`}
              title={!isInstalled
                ? notInstalledTip
                : !connected
                  ? `Connect ${label} first to refresh`
                  : `Re-patch config and verify proxy for ${label}`}
            >
              <QuickRefreshIcon />
            </button>
            <button
              type="button"
              className={`${styles.configAction}${settingsFor === profile.name ? ` ${styles.configActionActive}` : ''}`}
              onClick={() => openSettings(profile)}
              aria-haspopup="dialog"
              aria-label={`${label} settings`}
              title={`${label} settings`}
            >
              <HugeiconsIcon icon={Settings02Icon} size={15} strokeWidth={2} />
            </button>
          </div>
          {connected || setupComplete ? (
            <button
              type="button"
              role="switch"
              aria-checked={connected}
              className={`${styles.connectedToggle}${connected ? '' : ` ${styles.connectedToggleOff}`}`}
              disabled={!isInstalled || busy !== null || (!connected && !cloudConnected)}
              onClick={() => {
                if (!isInstalled) return;
                if (connected) void disconnectProfile(profile.name);
                else void connectProfile(profile.name);
              }}
              aria-label={`${connected ? 'Disconnect' : 'Connect'} ${label}`}
              title={!isInstalled ? notInstalledTip : `${connected ? 'Disconnect' : 'Connect'} ${label}`}
            >
              <span />
            </button>
          ) : (
            <button
              type="button"
              className={styles.connectAction}
              disabled={!isInstalled || busy !== null || !cloudConnected}
              onClick={() => {
                if (!isInstalled) return;
                void connectProfile(profile.name);
              }}
              title={!isInstalled ? notInstalledTip : `Connect ${label}`}
            >
              Connect
            </button>
          )}
        </div>

        {isInstalled && profile.name === 'antigravity' ? (() => {
          const statusSummary = antigravityStatusSummary(antigravityPatch);
          const statusClass = statusSummary.tone === 'ok'
            ? styles.antigravityStatusOk
            : statusSummary.tone === 'warn'
              ? styles.antigravityStatusWarn
              : statusSummary.tone === 'error'
                ? styles.antigravityStatusError
                : '';
          const showCloseAndApply = Boolean(
            antigravityPatch?.installed
            && (antigravityPatch.running || antigravityPatch.state === 'close-antigravity')
            && !antigravityPatch.enabled,
          );
          const showApplyReapply = Boolean(
            antigravityPatch?.installed
            && antigravityPatch.state === 'needs-reapply'
            && !antigravityPatch.running,
          );
          const showLaunch = Boolean(
            antigravityPatch?.installed
            && antigravityPatch.enabled
            && !antigravityPatch.running,
          );
          const showRefreshWhileRunning = Boolean(
            antigravityPatch?.installed
            && antigravityPatch.enabled
            && antigravityPatch.running,
          );
          return (
            <div className={styles.antigravityNativePatch}>
              <div className={styles.antigravityStatusRow}>
                <span className={`${styles.antigravityStatusText}${statusClass ? ` ${statusClass}` : ''}`}>
                  {statusSummary.text}
                </span>
                {(showCloseAndApply || showApplyReapply || showLaunch || showRefreshWhileRunning) ? (
                  <div className={styles.antigravityInlineActions}>
                    {showCloseAndApply ? (
                      <button
                        type="button"
                        className={styles.antigravityInlinePrimaryBtn}
                        disabled={antigravityPatchBusy || connecting === 'antigravity'}
                        onClick={() => { void closeAndEnableAntigravityPicker(); }}
                      >
                        {antigravityPatchBusy ? 'Applying…' : 'Close Antigravity & Apply Picker'}
                      </button>
                    ) : null}
                    {showApplyReapply ? (
                      <button
                        type="button"
                        className={styles.antigravityInlinePrimaryBtn}
                        disabled={antigravityPatchBusy || connecting === 'antigravity'}
                        onClick={() => { void applyAntigravityPicker(); }}
                      >
                        {antigravityPatchBusy ? 'Applying…' : 'Apply Native Picker'}
                      </button>
                    ) : null}
                    {showLaunch ? (
                      <button
                        type="button"
                        className={styles.antigravityInlineBtn}
                        disabled={antigravityPatchBusy}
                        onClick={() => { void launchAntigravityApp(); }}
                      >
                        Launch Antigravity
                      </button>
                    ) : null}
                    {showRefreshWhileRunning ? (
                      <button
                        type="button"
                        className={styles.antigravityInlineBtn}
                        disabled={antigravityPatchBusy}
                        onClick={() => { void refreshAntigravityPatch(true); }}
                      >
                        Refresh Status
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {antigravityInlineNotice ? (
                <span className={`${styles.antigravityStatusText} ${styles.antigravityStatusWarn}`}>
                  {antigravityInlineNotice}
                </span>
              ) : null}
            </div>
          );
        })() : null}

        {isInstalled && profile.name === 'codex' ? (
          <p className={styles.codexRestartNote}>Restart Codex if it was open so it connects cleanly to 127.0.0.1:8378.</p>
        ) : null}
        {isInstalled && profile.name === 'claude-desktop' ? (
          <p className={styles.mcpModelNote}>Applies to Claude Desktop&apos;s Code (&lt;/&gt;) tab (claude.ai Chat tab uses Anthropic cloud directly).</p>
        ) : null}
        {isInstalled && cloudModels.length > 0 && profile.kind === 'config-patch' && profile.name !== 'antigravity' ? (
          <label className={styles.modelPicker}>
            <span>Model</span>
            <select
              value={modelOverrides[profile.name]?.modelId ?? ''}
              onChange={(event) => void setAppModel(profile.name, event.target.value)}
              aria-label={`${label} Torve model`}
            >
              <option value="">Automatic</option>
              {cloudModels.map((model) => <option key={model.id} value={model.id}>{model.id}</option>)}
            </select>
          </label>
        ) : null}
        {isInstalled && backupsByApp[profile.name] ? (
          <div className={styles.backupStatusRow}>
            <span>Backup saved ({backupsByApp[profile.name].filesCount} {backupsByApp[profile.name].filesCount === 1 ? 'file' : 'files'})</span>
            <button
              type="button"
              className={styles.backupRestoreBtn}
              disabled={actionBusy === profile.name}
              onClick={() => {
                setActionBusy(profile.name);
                void window.torveDesktop?.torveBackupsRestore?.(profile.name)
                  .then(async () => {
                    await refresh();
                    await refreshCloudModels(false);
                    toast.push({
                      kind: 'success',
                      title: `${label} backup restored`,
                    });
                  })
                  .catch((err) => {
                    const errMsg = err instanceof Error ? err.message : String(err);
                    setMessage(errMsg);
                    toast.push({ kind: 'error', title: 'Backup restore failed', description: errMsg });
                  })
                  .finally(() => setActionBusy(null));
              }}
            >
              Restore
            </button>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <section className={`view view-vpr-tools view-pinned-header ${styles.view}`} role="tabpanel">
      <VprPage title="Connected apps" backFallback="home">
        <div className={styles.stack}>
          {activeProgressBanner ? (
            <p className={styles.progressBanner} role="status" aria-live="polite">
              <span className={styles.progressDot} aria-hidden="true" />
              <span>{activeProgressBanner.label}</span>
            </p>
          ) : null}
          {message ? <p className={styles.note} role="status">{message}</p> : null}

          <div className={styles.modelToolbar}>
            <span>Auto-detected AI harnesses &amp; Direct Cloud ({cloudModels.length} models)</span>
            <button
              type="button"
              disabled={appsRefreshing}
              onClick={() => {
                setAppsRefreshing(true);
                void Promise.all([
                  refreshSystemProxyProfilesForce(),
                  refreshCloudModels(true),
                  refreshAntigravityPatch(true),
                ])
                  .then(() => {
                    toast.push({
                      kind: 'info',
                      title: 'Apps refreshed',
                      description: 'Detected harnesses and model catalog updated.',
                    });
                  })
                  .catch((err) => {
                    const errMsg = err instanceof Error ? err.message : String(err);
                    setMessage(errMsg);
                    toast.push({ kind: 'error', title: 'Refresh failed', description: errMsg });
                  })
                  .finally(() => setAppsRefreshing(false));
              }}
            >
              <HugeiconsIcon icon={ArrowReloadHorizontalIcon} size={14} strokeWidth={2} />
              {appsRefreshing ? 'Refreshing…' : 'Refresh Apps'}
            </button>
          </div>

          <div className={styles.appScroll}>
            <div className={styles.bridgeWrap}>
              <BrandBridge
                brands={bridgeHarnesses}
                connectedIds={[...connectedBridgeIds]}
                autoplay={false}
                hub={<TorveMark size={38} />}
                title="Click to Connect"
                description="Click any installed harness tile to route its AI traffic through Torve, or manage per-app models and settings below."
                onToggle={toggleBridgeHarness}
              />
            </div>

            <div className={styles.appList}>
              {installedProfiles.map(renderProfileCard)}

              {notInstalledProfiles.length > 0 ? (
                <section className={styles.collapsibleSection} aria-label="Not installed apps">
                  <button
                    type="button"
                    className={styles.collapsibleHeader}
                    aria-expanded={notInstalledOpen}
                    onClick={() => setNotInstalledOpen((open) => !open)}
                  >
                    <span>Not Installed ({notInstalledProfiles.length})</span>
                    <HugeiconsIcon
                      icon={ArrowDown01Icon}
                      size={14}
                      strokeWidth={2}
                      className={`${styles.collapsibleChevron}${notInstalledOpen ? ` ${styles.collapsibleChevronOpen}` : ''}`}
                    />
                  </button>
                  {notInstalledOpen ? notInstalledProfiles.map(renderProfileCard) : null}
                </section>
              ) : null}
            </div>

            <section className={styles.comingSoonSection} aria-label="Coming Soon">
              <div className={styles.comingSoonHeader}>
                <span className={styles.comingSoonTitle}>Coming Soon</span>
                <span className={styles.comingSoonSub}>Upcoming native connectors</span>
              </div>
              <div className={styles.comingSoonGrid}>
                {COMING_SOON_APPS.map((app) => (
                  <div key={app.id} className={styles.comingSoonCard} aria-disabled="true">
                    <span className={styles.appIdentity}>
                      <BrandIcon brand={app.brand} size={20} />
                      <span className={styles.comingSoonName}>{app.name}</span>
                    </span>
                    <span className={styles.comingSoonPill}>Coming Soon</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className={styles.appFooter}>
            <button type="button" className={styles.learnMore} onClick={() => setHelpOpen(true)}>
              What are connected apps?
            </button>
          </div>
        </div>
      </VprPage>

      {showOnboarding && <AppsOnboarding onDone={() => setShowOnboarding(false)} />}

      <Modal
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
        size="sm"
        title="Connected apps"
        subtitle="How Torve works with your coding tools"
        bodyClassName={styles.settingsBody}
      >
        <section className={styles.settingSection}>
          <div className={styles.settingHead}>
            <span className={styles.settingTitle}>What connecting does</span>
          </div>
          <p className={styles.settingHint}>
            Connecting an app routes its AI requests through Torve&apos;s local proxy on
            127.0.0.1:8378. Your tool works as usual — requests are served by Torve Cloud
            using your account quota and models.
          </p>
        </section>
        <section className={styles.settingSection}>
          <div className={styles.settingHead}>
            <span className={styles.settingTitle}>How apps connect</span>
          </div>
          <p className={styles.settingHint}>
            Torve patches each tool&apos;s local configuration atomically on Connect and keeps
            a backup of the original files so Disconnect or Restore returns everything to its
            previous state.
          </p>
        </section>
        <section className={styles.settingSection}>
          <div className={styles.settingHead}>
            <span className={styles.settingTitle}>Per-app models</span>
          </div>
          <p className={styles.settingHint}>
            Use the Model dropdown on any connected tool to pin a specific Torve Cloud model
            or keep it on Automatic routing.
          </p>
        </section>
      </Modal>

      <Modal
        isOpen={settingsProfile !== null}
        onClose={() => setSettingsFor(null)}
        size="sm"
        title={settingsPane.pane === 'apps' ? (
          <span className={styles.modalBackTitle}>
            <button
              type="button"
              className={styles.paneBackButton}
              onClick={() => setSettingsPane({ pane: 'main', dir: 'back' })}
              aria-label="Back"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={15} strokeWidth={2} />
            </button>
            Choose application
          </span>
        ) : (settingsProfile?.displayName ?? 'App settings')}
        subtitle={settingsPane.pane === 'apps'
          ? undefined
          : settingsInfo ? (
            <span className={styles.modalAppSubtitle}>
              {settingsInfo.description}
              {settingsInfo.websiteUrl ? (
                <button
                  type="button"
                  className={styles.settingWebsiteLink}
                  onClick={() => void openUrl(settingsInfo.websiteUrl!)}
                >
                  Website / download
                  <HugeiconsIcon icon={ArrowUpRight01Icon} size={12} strokeWidth={2} />
                </button>
              ) : null}
            </span>
          ) : undefined}
        bodyClassName={styles.settingsBody}
      >
        {settingsProfile ? (() => {
          const connected = activeProfiles?.has(settingsProfile.name) ?? false;
          return (
            <div key={settingsPane.pane} className={`${styles.pane}${settingsPane.dir === 'forward' ? ` ${styles.paneForward}` : settingsPane.dir === 'back' ? ` ${styles.paneBack}` : ''}`}>
              {settingsPane.pane === 'apps' ? (
                <AppPickerPane
                  apps={installedApps}
                  error={installedAppsError}
                  search={pickerSearch}
                  onSearch={setPickerSearch}
                  activeName={settingsLaunchName}
                  onChoose={chooseApp}
                  noneLabel="Default action"
                  noneMeta="Use the app’s built-in open behavior"
                />
              ) : (
                <>
                  <section className={styles.settingSection}>
                    <div className={styles.settingHead}>
                      <span className={styles.settingTitle}>Connection</span>
                      {connected ? (
                        <span className={styles.settingConnected}>
                          <span className={styles.connectedDot} aria-hidden="true" />
                          Connected
                        </span>
                      ) : null}
                    </div>
                    <p className={styles.settingHint}>
                      {connected
                        ? `${settingsProfile.displayName}'s AI requests currently route through Torve. Disconnecting restores its direct connection.${settingsDirty ? ' Saving these changes disconnects it first — reconnect from the apps list.' : ''}`
                        : `Connect from the apps list to route ${settingsProfile.displayName}'s AI requests through Torve.`}
                    </p>
                  </section>

                  <section className={styles.settingSection}>
                    <div className={styles.settingHead}>
                      <span className={styles.settingTitle}>Application</span>
                    </div>
                    <p className={styles.settingHint}>
                      The installed application Torve launches for {settingsProfile.displayName}.
                    </p>
                    <button
                      type="button"
                      className={styles.settingValueRow}
                      onClick={() => setSettingsPane({ pane: 'apps', dir: 'forward' })}
                    >
                      {settingsProfile.iconDataUri && !shouldPreferBundledBrandIcon(resolveBrandKey(settingsProfile.name, settingsProfile.displayName))
                        ? <img src={settingsProfile.iconDataUri} alt="" className={styles.pickerIcon} />
                        : <BrandIcon name={settingsProfile.name} hints={[settingsProfile.displayName]} size={20} />}
                      <span className={styles.settingValueName}>
                        {settingsLaunchName ?? 'Default action'}
                      </span>
                      <HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={2} className={styles.settingValueChevron} />
                    </button>
                  </section>

                  <section className={styles.settingSection}>
                    <div className={styles.settingHead}>
                      <span className={styles.settingTitle}>Request identity</span>
                    </div>
                    <p className={styles.settingHint}>
                      Torve matches requests to {settingsProfile.displayName} by the client name they
                      carry on the wire, like <code>opencode</code> or <code>codex</code>. Separate multiple names with commas.
                    </p>
                    <form
                      className={styles.settingInputRow}
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveSettings();
                      }}
                    >
                      <input
                        type="text"
                        className={styles.settingInput}
                        value={identityDraft}
                        placeholder={settingsProfile.name}
                        spellCheck={false}
                        onChange={(event) => setIdentityDraft(event.currentTarget.value)}
                        disabled={settingsSaving}
                      />
                    </form>
                  </section>

                  <div className={styles.settingFooter}>
                    {settingsDirty ? (
                      <button
                        type="button"
                        className={styles.settingPrimary}
                        disabled={settingsSaving || busy !== null}
                        onClick={() => void saveSettings()}
                      >
                        {settingsSaving ? 'Saving...' : 'Save'}
                      </button>
                    ) : connected ? (
                      <button
                        type="button"
                        className={styles.settingDanger}
                        disabled={busy !== null}
                        onClick={() => { void disconnectProfile(settingsProfile.name); }}
                      >
                        Disconnect
                      </button>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          );
        })() : null}
      </Modal>
    </section>
  );
}

function AppPickerPane({ apps, error, search, onSearch, activeName, onChoose, noneLabel, noneMeta }: {
  apps: InstalledAppEntry[] | null;
  error: string | null;
  search: string;
  onSearch: (value: string) => void;
  activeName: string | null;
  onChoose: (app: InstalledAppEntry | null) => void;
  noneLabel: string;
  noneMeta: string;
}) {
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const list = apps ?? [];
    return query ? list.filter((app) => app.name.toLowerCase().includes(query)) : list;
  }, [apps, search]);

  return (
    <div className={styles.pickerStack}>
      <VprSearch value={search} onChange={onSearch} placeholder="Search applications" />
      <div className={styles.pickerList}>
        <button
          type="button"
          className={`${styles.pickerRow}${activeName === null ? ` ${styles.pickerRowActive}` : ''}`}
          onClick={() => onChoose(null)}
        >
          <span className={styles.pickerRowText}>
            <span className={styles.pickerRowName}>{noneLabel}</span>
            <span className={styles.pickerRowMeta}>{noneMeta}</span>
          </span>
          {activeName === null ? <HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={2} /> : null}
        </button>
        {apps === null ? (
          <div className={styles.pickerEmpty}>Loading applications...</div>
        ) : error ? (
          <div className={styles.pickerEmpty}>{error}</div>
        ) : filtered.length === 0 ? (
          <div className={styles.pickerEmpty}>No applications match your search</div>
        ) : (
          filtered.map((app) => (
            <button
              type="button"
              key={app.path}
              className={`${styles.pickerRow}${activeName === app.name ? ` ${styles.pickerRowActive}` : ''}`}
              onClick={() => onChoose(app)}
              title={app.path}
            >
              {app.iconDataUri && !shouldPreferBundledBrandIcon(resolveBrandKey(app.name))
                ? <img src={app.iconDataUri} alt="" className={styles.pickerIcon} />
                : <BrandIcon name={app.name} hints={[app.name]} size={20} />}
              <span className={styles.pickerRowText}>
                <span className={styles.pickerRowName}>{app.name}</span>
              </span>
              {activeName === app.name ? <HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={2} /> : null}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
