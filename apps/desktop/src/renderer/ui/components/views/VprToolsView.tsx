import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Add01Icon, ArrowDown01Icon, ArrowLeft01Icon, ArrowReloadHorizontalIcon, ArrowRight01Icon, ArrowUpRight01Icon, Copy01Icon, Settings02Icon, SquareLock01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { Bot, Code2, FastForward, Terminal } from 'lucide-react';
import { Modal } from '@torveai/ui';
import type { AntigravityStandalonePatchStatus, ConnectLifecycleProgress, InstalledAppEntry, SystemProxyProfileSummary } from '../../../types/bridge';
import { chooseBestVprRoute, isPeerRoutable } from '../../../modules/routing/select';
import { routesForSelectedModel } from '../../../modules/catalog/view-models';
import { installedAppsResource, refreshSystemProxyProfilesForce, systemProxyResource } from '../../../modules/app/vpr-resources';
import { useCachedResource } from '../../../modules/app/cached-resource';
import {
  activeProfilesFromRuntimeState,
  buildVprPeerOptions,
  resolveVprToolRouteForPeerOptions,
} from '../../../modules/routing/tools';
import { shallowEqual, useUiSelector } from '../../hooks/useUiSelector';
import { useActions } from '../../hooks/useActions';
import { BrandIcon, isThemeAwareAppBrand, resolveBrandKey } from '../brand/BrandIcon';
import { TorveMark } from '../brand/TorveMark';
import { useTorveToast } from '../torve/TorveToastContext';
import { BrandBridge, type BridgeBrand } from '../../../components/motion-brew/brand-bridge';
import { VprBadge, VprPage, VprSearch } from '../vpr/VprKit';
import { TelegramBotCard } from './TelegramBotCard';
import { CursorAppCard } from './CursorAppCard';
import { AppsOnboarding } from './AppsOnboarding';
import { isAppsOnboardingSeen, persistAppsOnboardingSeen } from '../../../modules/app/apps-onboarding';
import styles from './VprToolsView.module.scss';
import { recordUserAction } from '../../../modules/telemetry/actions';
import { normalizeTelemetryAppName } from '../../../../shared/telemetry.js';


declare const __TORVE_SYSTEM_PROXY_PORT__: number;

const DEFAULT_PORT = __TORVE_SYSTEM_PROXY_PORT__;

const BUILT_IN_APP_INFO: Readonly<Record<string, { description: string; websiteUrl?: string }>> = {
  opencode: {
    description: 'An open-source coding agent for the terminal, desktop, and IDE.',
    websiteUrl: 'https://opencode.ai/',
  },
  codex: {
    description: 'OpenAI’s coding agent for building, reviewing, and shipping software.',
    websiteUrl: 'https://openai.com/codex/',
  },
  'claude-code': {
    description: 'Anthropic’s terminal coding agent, routed through the model selected in the AI VPN.',
    websiteUrl: 'https://code.claude.com/docs/en/overview',
  },
  t3code: {
    description: 'A desktop interface for running multiple coding agents in parallel.',
    websiteUrl: 'https://github.com/pingdotgg/t3code',
  },
  pi: {
    description: 'A minimal, extensible coding agent for the terminal.',
    websiteUrl: 'https://pi.dev/',
  },
  gooeypi: {
    description: 'A graphical desktop experience powered by the Pi coding-agent ecosystem.',
    websiteUrl: 'https://pi.dev/',
  },
  crush: {
    description: 'A terminal-based AI coding agent from Charm.',
    websiteUrl: 'https://github.com/charmbracelet/crush',
  },
  goose: {
    description: 'An open-source AI agent that can plan, code, and automate development tasks.',
    websiteUrl: 'https://block.github.io/goose/',
  },
  hermes: {
    description: 'A desktop AI agent with tools, skills, file previews, voice, profiles, and automation.',
    websiteUrl: 'https://hermes-agent.nousresearch.com/',
  },
  'gemini-cli': { description: 'Google Gemini CLI configured persistently through its official environment and settings files.', websiteUrl: 'https://geminicli.com/' },
  aider: { description: 'A terminal pair-programming assistant using Torve through its OpenAI-compatible endpoint.', websiteUrl: 'https://aider.chat/' },
  continue: { description: 'The open-source coding assistant configured with a dedicated Torve model provider.', websiteUrl: 'https://continue.dev/' },
  antigravity: { description: 'Unified Native Model Picker and MCP Bridge for Google Antigravity. Connecting configures both the MCP bridge and the standalone Native Model Picker.' },
  zed: {
    description: 'A high-performance collaborative code editor with built-in AI assistance.',
    websiteUrl: 'https://zed.dev/download',
  },
};

function appInfo(profile: SystemProxyProfileSummary): { description: string; websiteUrl?: string } {
  const builtIn = BUILT_IN_APP_INFO[profile.name];
  if (builtIn) return builtIn;
  const domain = profile.domains[0];
  return {
    description: profile.custom
      ? 'A custom AI application routed through Torve.'
      : `${profile.displayName} is configured to use Torve for AI requests.`,
    ...(domain ? { websiteUrl: `https://${domain}` } : {}),
  };
}

/** Two-pane modal navigation: the main pane slides to the application list
    the same way the app's screens slide ('none' = no animation on open). */
type ModalPane = { pane: 'main' | 'apps'; dir: 'none' | 'forward' | 'back' };

type GuiTestResult = {
  ok: boolean;
  proxyConfigured: boolean;
  proxyReachable: boolean;
  guiTrustOk: boolean;
  certTrustError: boolean;
  appRunning: boolean;
  needsAppRestart: boolean;
  appPid?: number;
  statusCode?: number;
  error?: string;
};

type CloudActivity = { id: string; timestamp: number; appId: string | null; protocol: string; requestedModel: string | null; resolvedModel: string | null; statusCode: number; latencyMs: number; stream: boolean; usage: { inputTokens: number; outputTokens: number } | null; errorSummary: string | null };

type AntigravityBridgeExtras = {
  antigravityStandaloneCloseAndEnable?: () => Promise<{ ok: boolean; status?: AntigravityStandalonePatchStatus; error?: string }>;
  antigravityLaunch?: () => Promise<{ ok: boolean; targetPath?: string; error?: string }>;
};

function antigravityStatusSummary(patch: AntigravityStandalonePatchStatus | null): {
  text: string;
  tone: 'default' | 'ok' | 'warn' | 'error';
} {
  if (!patch) return { text: 'Checking standalone Antigravity…', tone: 'default' };
  if (!patch.installed) return { text: 'MCP Bridge only (standalone Antigravity not found)', tone: 'default' };
  if (patch.enabled && patch.running) return { text: 'Native Model Picker: Active (Close Antigravity to disconnect)', tone: 'warn' };
  if (patch.enabled) return { text: 'Native Model Picker: Active', tone: 'ok' };
  if (patch.state === 'needs-reapply' && !patch.running) {
    return { text: 'Native Model Picker: Needs re-apply after Antigravity update', tone: 'warn' };
  }
  if (patch.running || patch.state === 'close-antigravity') {
    return { text: 'Close Antigravity to apply Native Model Picker', tone: 'warn' };
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
  'cursor',
  'windsurf',
  'vscode',
  'zed',
  'hermes',
  't3code',
  'gooeypi',
  'opencode',
  'codex',
  'goose',
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

function isActiveProgressStage(stage: ConnectLifecycleProgress['stage'] | undefined): boolean {
  return stage === 'checking-proxy'
    || stage === 'backing-up'
    || stage === 'patching'
    || stage === 'restarting-app'
    || stage === 'verifying';
}

const BRIDGE_HARNESSES: BridgeBrand[] = [
  {
    id: 'codex',
    name: 'Codex',
    colors: ['#14FF73', '#D8FF0A'],
    logo: <BrandIcon brand="codex" size={24} />,
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    colors: ['#D8FF0A', '#14FF73'],
    logo: (
      <svg viewBox="0 0 24 24" className="size-6" fill="none" aria-hidden="true">
        <path
          d="M12 3.2L19.2 19.6L12 15.8L4.8 19.6L12 3.2Z"
          stroke="#D8FF0A"
          strokeWidth="1.9"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="11.5" r="2" fill="#14FF73" />
      </svg>
    ),
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    colors: ['#38BDF8', '#14FF73'],
    logo: <BrandIcon brand="opencode" size={24} />,
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    colors: ['#D97757', '#F59E0B'],
    logo: <BrandIcon brand="anthropic" size={24} />,
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    colors: ['#D97757', '#EC4899'],
    logo: <BrandIcon brand="anthropic" size={24} />,
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    colors: ['#4285F4', '#A855F7'],
    logo: <BrandIcon brand="gemini" size={24} />,
  },
  {
    id: 'aider',
    name: 'Aider',
    colors: ['#14FF73', '#A855F7'],
    logo: <Bot className="size-6 text-[#14FF73]" strokeWidth={1.85} aria-hidden="true" />,
  },
  {
    id: 'continue',
    name: 'Continue',
    colors: ['#38BDF8', '#14FF73'],
    logo: <FastForward className="size-6 text-[#38BDF8]" strokeWidth={1.85} aria-hidden="true" />,
  },
];

const BRIDGE_HARNESS_IDS = new Set(BRIDGE_HARNESSES.map((harness) => harness.id));

export function VprToolsView() {
  const actions = useActions();
  const toast = useTorveToast();
  const snap = useUiSelector((state) => ({
    lastPeers: state.lastPeers,
    discoverRows: state.vprRoutableRows,
    selection: state.vprRouteSelection,
    preferences: state.vprRoutingPreferences,
  }), shallowEqual);
  const proxyResource = useCachedResource(systemProxyResource);
  const profiles = proxyResource.data?.profiles ?? [];
  const proxyState = proxyResource.data?.state ?? null;
  // First-ever visit to this screen (however the user got here): play the
  // coach-mark walkthrough once, and mark it seen immediately so the nav dot
  // never comes back.
  const [showOnboarding, setShowOnboarding] = useState(() => !isAppsOnboardingSeen());
  useEffect(() => {
    if (showOnboarding) persistAppsOnboardingSeen();
  }, [showOnboarding]);
  const [busy, setBusy] = useState<string | null>(null);
  // The app being connected right now. Connecting also restarts an app that
  // was already running, so the row has to stay busy well past the click.
  const [connecting, setConnecting] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [progressByApp, setProgressByApp] = useState<Record<string, ConnectLifecycleProgress>>({});
  const lastLaunchedOrRestartedRef = useRef<string[]>([]);
  const [guiTest, setGuiTest] = useState<GuiTestResult | null>(null);
  const [trustBusy, setTrustBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [cloudModels, setCloudModels] = useState<Array<{ id: string }>>(() => cachedCloudModelsSnapshot);
  const [modelOverrides, setModelOverrides] = useState<Record<string, { modelId: string; enabled: boolean }>>({});
  const [modelsRefreshing, setModelsRefreshing] = useState(false);
  const [cloudConnected, setCloudConnected] = useState(false);
  const [antigravityPatch, setAntigravityPatch] = useState<AntigravityStandalonePatchStatus | null>(null);
  const [antigravityPatchBusy, setAntigravityPatchBusy] = useState(false);
  const [antigravityInlineNotice, setAntigravityInlineNotice] = useState<string | null>(null);
  const [backupsByApp, setBackupsByApp] = useState<Record<string, { filesCount: number; updatedAt: number }>>({});
  const [appsRefreshing, setAppsRefreshing] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activities, setActivities] = useState<CloudActivity[]>([]);
  const [activityFilter, setActivityFilter] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [addUrl, setAddUrl] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  // Application picked for a new custom app — supplies its display name and
  // icon, replacing the favicon fetch.
  const [addApp, setAddApp] = useState<InstalledAppEntry | null>(null);
  const [addPane, setAddPane] = useState<ModalPane>({ pane: 'main', dir: 'none' });
  const [addSearch, setAddSearch] = useState('');
  // Add-app wizard: 1 = URL + application, 2 = trust the CA, 3 = connect.
  // Step 2 is skipped when the certificate is already trusted.
  const [addStep, setAddStep] = useState<1 | 2 | 3>(1);
  const [addedName, setAddedName] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  // The endpoint probe could not confirm the URL is an AI API — the error is
  // shown as a warning and the submit button becomes "Add anyway".
  const [addUnverified, setAddUnverified] = useState(false);
  const [caInfo, setCaInfo] = useState<{ path: string; exists: boolean } | null>(null);
  const [caTrust, setCaTrust] = useState<'trusted' | 'stale' | 'absent' | 'unknown'>('unknown');
  const [caCopied, setCaCopied] = useState(false);
  // Certificate card expansion: the user's explicit toggle wins; until they
  // touch it, the card only opens itself when an action is actually needed.
  const [caOpenOverride, setCaOpenOverride] = useState<boolean | null>(null);
  // "What are connected apps?" explainer modal.
  const [helpOpen, setHelpOpen] = useState(false);
  // Per-app settings modal: which profile it edits, which pane is showing
  // (main settings vs. the application list it slides to), its search text,
  // the client-identity draft, and the lazily fetched installed-apps list.
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [settingsPane, setSettingsPane] = useState<ModalPane>({ pane: 'main', dir: 'none' });
  const [pickerSearch, setPickerSearch] = useState('');
  const [identityDraft, setIdentityDraft] = useState('');
  // Drafted "Open with" pick — undefined until the user touches it, applied
  // together with the identity draft by the modal's Save button.
  const [launchDraft, setLaunchDraft] = useState<InstalledAppEntry | null | undefined>(undefined);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const installedAppsResourceSnapshot = useCachedResource(installedAppsResource, false);
  const installedApps = installedAppsResourceSnapshot.data;
  const installedAppsError = installedAppsResourceSnapshot.error;

  // lastPeers is the raw scan, so it has to be filtered too — otherwise an
  // excluded seller would still be offerable as a per-app route here.
  const peerOptions = useMemo(
    () => buildVprPeerOptions(snap.lastPeers, snap.discoverRows)
      .filter((peer) => isPeerRoutable(peer.peerId, snap.preferences)),
    [snap.lastPeers, snap.discoverRows, snap.preferences],
  );
  const modelRoutes = useMemo(() => routesForSelectedModel(snap.discoverRows, snap.selection.model), [snap.discoverRows, snap.selection.model]);
  const bestRoute = useMemo(() => chooseBestVprRoute(modelRoutes, snap.preferences), [modelRoutes, snap.preferences]);
  const defaultPeerId = snap.selection.peerId || bestRoute?.peerId || peerOptions[0]?.peerId || '';
  const defaultModel = snap.selection.model?.serviceId || peerOptions.find((peer) => peer.peerId === defaultPeerId)?.services[0] || '';
  const activeProfiles = useMemo(() => activeProfilesFromRuntimeState(proxyState), [proxyState]);
  const activeProfileNames = useMemo(() => activeProfiles ? [...activeProfiles] : [], [activeProfiles]);
  const connectedBridgeIds = useMemo(() => {
    const set = new Set<string>();
    for (const name of activeProfileNames) {
      if (BRIDGE_HARNESS_IDS.has(name)) set.add(name);
    }
    return set;
  }, [activeProfileNames]);
  const displayNameFor = useCallback((profileName: string) => (
    profiles.find((profile) => profile.name === profileName)?.displayName
    ?? BRIDGE_HARNESSES.find((harness) => harness.id === profileName)?.name
    ?? profileName
  ), [profiles]);
  const setupProfiles = useMemo(() => {
    const metadata = proxyState as (Record<string, unknown> | null);
    return new Set(Array.isArray(metadata?.setupProfileNames) ? metadata.setupProfileNames.filter((name): name is string => typeof name === 'string') : []);
  }, [proxyState]);
  const hasConnectedProxyProfile = useMemo(() => (
    profiles.some((profile) => profile.kind === 'proxy' && (activeProfiles?.has(profile.name) ?? false))
  ), [activeProfiles, profiles]);

  const hasProxyProfile = useMemo(() => profiles.some((profile) => profile.kind === 'proxy'), [profiles]);

  const refresh = systemProxyResource.refresh;

  const refreshCloudModels = useCallback(async (force = false) => {
    const bridge = window.torveDesktop;
    setModelsRefreshing(force);
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
    } finally {
      setModelsRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    void refreshCloudModels(false);
    const bridge = window.torveDesktop;
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

  const refreshAntigravityPatch = useCallback(async (bypassCache = false) => {
    try {
      const status = await window.torveDesktop?.antigravityStandaloneStatus?.(bypassCache ? { bypassCache: true } : undefined) ?? null;
      setAntigravityPatch(status);
      if (status && !status.running) setAntigravityInlineNotice(null);
      return status;
    } catch {
      setAntigravityPatch(null);
      return null;
    }
  }, []);
  useEffect(() => { void refreshAntigravityPatch(false); }, [refreshAntigravityPatch]);

  const applyAntigravityPicker = useCallback(async () => {
    setAntigravityPatchBusy(true);
    setMessage(null);
    setAntigravityInlineNotice(null);
    try {
      const result = await window.torveDesktop?.antigravityStandaloneSet?.(true);
      if (result?.status) setAntigravityPatch(result.status);
      else await refreshAntigravityPatch(true);
      if (!result?.ok) throw new Error(result?.error ?? 'Unable to apply the Antigravity native picker patch.');
      toast.push({
        kind: 'success',
        title: 'Antigravity picker applied',
        description: 'Native Model Picker is now active.',
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setMessage(errMsg);
      setAntigravityInlineNotice(errMsg);
      toast.push({ kind: 'error', title: 'Antigravity patch failed', description: errMsg });
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
      if (!result?.ok) throw new Error(result?.error ?? 'Unable to close Antigravity and apply the native picker patch.');
      toast.push({
        kind: 'success',
        title: 'Antigravity updated',
        description: 'Closed Antigravity and enabled Native Model Picker.',
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setMessage(errMsg);
      setAntigravityInlineNotice(errMsg);
      toast.push({ kind: 'error', title: 'Could not patch Antigravity', description: errMsg });
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
        const errMsg = result.error ?? 'Unable to launch Antigravity.';
        setMessage(errMsg);
        toast.push({ kind: 'error', title: 'Could not launch Antigravity', description: errMsg });
      } else {
        window.setTimeout(() => { void refreshAntigravityPatch(true); }, 1000);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setMessage(errMsg);
      toast.push({ kind: 'error', title: 'Could not launch Antigravity', description: errMsg });
    } finally {
      setAntigravityPatchBusy(false);
    }
  }, [refreshAntigravityPatch, toast]);

  useEffect(() => {
    const bridge = window.torveDesktop;
    void bridge?.torveActivityGet?.().then((items) => setActivities(items ?? [])).catch(() => undefined);
    return bridge?.onTorveActivity?.((item) => setActivities((current) => [item, ...current.filter((entry) => entry.id !== item.id)].slice(0, 100)));
  }, []);

  useEffect(() => {
    const bridge = window.torveDesktop;
    return bridge?.onConnectProgress?.((event) => {
      if (!event?.appId) return;
      setProgressByApp((prev) => ({ ...prev, [event.appId]: event }));
      if (event.stage === 'error') {
        toast.push({
          kind: 'error',
          title: `${displayNameFor(event.appId)} error`,
          description: event.detail ?? event.label,
        });
      }
      if (event.stage === 'done' || event.stage === 'error') {
        window.setTimeout(() => {
          setProgressByApp((prev) => {
            const current = prev[event.appId];
            if (!current || current.timestamp !== event.timestamp) return prev;
            const next = { ...prev };
            delete next[event.appId];
            return next;
          });
        }, event.stage === 'done' ? 2500 : 5000);
      }
    });
  }, []);

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

  // Direct Cloud profiles persist independently of the legacy P2P runtime.
  // Restore their connected rows once the normal catalog is available.
  useEffect(() => {
    if (proxyState?.running || profiles.length === 0) return;
    void window.torveDesktop?.torveDirectState?.().then((state) => {
      if (state?.activeProfileNames?.length) systemProxyResource.setData({ profiles, state });
    }).catch(() => undefined);
  }, [profiles, proxyState?.running]);

  // Trust state shells out to the CLI (which queries the OS keychain), so it is
  // fetched on demand — mount, after adding an app, after trusting — never on
  // the 3s poll above.
  const refreshCaTrust = useCallback(async (): Promise<'trusted' | 'stale' | 'absent' | 'unknown'> => {
    const bridge = window.torveDesktop;
    if (!bridge?.systemProxyCaTrustState) return 'unknown';
    try {
      const result = await bridge.systemProxyCaTrustState();
      const trust = result.ok ? result.trust : 'unknown';
      setCaTrust(trust);
      return trust;
    } catch {
      setCaTrust('unknown');
      return 'unknown';
    }
  }, []);

  useEffect(() => {
    void refreshCaTrust();
    void window.torveDesktop?.systemProxyCaInfo?.().then(setCaInfo);
  }, [refreshCaTrust]);

  const testGui = useCallback(async () => {
    const bridge = window.torveDesktop;
    if (!bridge?.systemProxyTestGui) return;
    try {
      setGuiTest(await bridge.systemProxyTestGui({ port: DEFAULT_PORT }));
    } catch (err) {
      setGuiTest({
        ok: false,
        proxyConfigured: false,
        proxyReachable: false,
        guiTrustOk: false,
        certTrustError: false,
        appRunning: false,
        needsAppRestart: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  useEffect(() => {
    if (!hasConnectedProxyProfile) {
      setGuiTest(null);
      return;
    }
    void testGui();
  }, [hasConnectedProxyProfile, testGui]);

  // Every connected app follows the default AI VPN route; the model itself is
  // resolved live by the buyer (the `torve` alias), so there are no per-app
  // model overrides here anymore.
  const startProfiles = useCallback(async (names: string[]): Promise<boolean> => {
    const bridge = window.torveDesktop;
    lastLaunchedOrRestartedRef.current = [];
    setBusy(names.join(','));
    setMessage(null);
    const account = await bridge?.torveAccountGet?.();
    if (!account?.connected || !bridge?.torveDirectStart) {
      setBusy(null);
      const warnMsg = 'Sign in to Torve Desktop on Overview before connecting apps.';
      setMessage(warnMsg);
      toast.push({ kind: 'warning', title: 'Sign in required', description: warnMsg });
      return false;
    }
    const result = await bridge.torveDirectStart(names);
    setBusy(null);
    if (!result.ok) {
      const errMsg = result.error ?? 'Unable to connect tool profile to Torve Cloud';
      setMessage(errMsg);
      toast.push({ kind: 'error', title: 'Connection failed', description: errMsg });
      return false;
    }
    lastLaunchedOrRestartedRef.current = Array.isArray(result.launchedOrRestartedApps) ? result.launchedOrRestartedApps : [];
    systemProxyResource.setData({ profiles, state: result.state ?? null });
    void refreshCloudModels(false);
    return true;
  }, [profiles, refreshCloudModels, toast]);

  const disconnect = useCallback(async (appName?: string) => {
    const bridge = window.torveDesktop;
    recordUserAction('app_disconnect', 'apps', appName !== undefined ? normalizeTelemetryAppName(appName) : undefined);
    setBusy('stop');
    const result = proxyState?.peerId === 'direct'
      ? await bridge?.torveDirectStop?.()
      : await bridge?.systemProxyStop?.();
    setBusy(null);
    if (result?.ok) {
      systemProxyResource.setData({ profiles, state: result.state ?? null });
      toast.push({
        kind: 'info',
        title: appName ? `${displayNameFor(appName)} disconnected` : 'Apps disconnected',
        description: 'Restored original configuration.',
      });
    } else {
      const errMsg = result?.error ?? 'Unable to disconnect tools';
      setMessage(errMsg);
      toast.push({ kind: 'error', title: 'Disconnect failed', description: errMsg });
    }
  }, [displayNameFor, profiles, proxyState?.peerId, toast]);

  const openUrl = useCallback(async (url: string) => {
    const result = await window.torveDesktop?.openExternalUrl?.(url);
    if (result && !result.ok) {
      const errMsg = result.error ?? 'Could not open tool';
      setMessage(errMsg);
      toast.push({ kind: 'error', title: 'Could not open URL', description: errMsg });
    }
  }, [toast]);

  const openTool = useCallback(async (toolName: string) => {
    const result = await window.torveDesktop?.openTool?.(toolName);
    if (result && !result.ok) {
      const errMsg = result.error ?? 'Could not open tool';
      setMessage(errMsg);
      toast.push({ kind: 'error', title: `Could not open ${displayNameFor(toolName)}`, description: errMsg });
    }
  }, [displayNameFor, toast]);

  const connectProfile = useCallback(async (profileName: string) => {
    recordUserAction('app_connect', 'apps', normalizeTelemetryAppName(profileName));
    const names = Array.from(new Set([...activeProfileNames, profileName]));
    setConnecting(profileName);
    if (profileName === 'antigravity') setAntigravityInlineNotice(null);
    const label = displayNameFor(profileName);
    try {
      if (!await startProfiles(names)) return;
      if (profileName === 'antigravity') {
        const currentPatch = await refreshAntigravityPatch(true) ?? antigravityPatch;
        if (currentPatch?.installed) {
          if (currentPatch.running || currentPatch.state === 'close-antigravity') {
            toast.push({
              kind: 'warning',
              title: 'Antigravity connected (picker pending)',
              description: 'Click "Close Antigravity & Apply Picker" to enable the Native Model Picker.',
            });
            return;
          }
          if (!currentPatch.enabled) {
            setAntigravityPatchBusy(true);
            try {
              const patchResult = await window.torveDesktop?.antigravityStandaloneSet?.(true);
              if (patchResult?.status) {
                setAntigravityPatch(patchResult.status);
              } else {
                await refreshAntigravityPatch(true);
              }
              if (patchResult && !patchResult.ok && patchResult.error) {
                setMessage(patchResult.error);
                setAntigravityInlineNotice(patchResult.error);
                toast.push({ kind: 'error', title: 'Antigravity patch failed', description: patchResult.error });
                return;
              }
            } finally {
              setAntigravityPatchBusy(false);
            }
          }
        }
        toast.push({
          kind: 'success',
          title: `${label} connected`,
          description: 'MCP bridge and Native Model Picker are ready.',
        });
        return;
      }
      toast.push({
        kind: 'success',
        title: `${label} connected`,
        description: 'AI requests now route through Torve.',
      });
      const profile = profiles.find((entry) => entry.name === profileName);
      if (!profile) return;
      const alreadyHandledByLifecycle = lastLaunchedOrRestartedRef.current.includes(profileName);
      if (profile.appAction === 'open-url' && profile.openUrl && !profile.launchAppName) {
        await openUrl(profile.openUrl);
      } else if (!alreadyHandledByLifecycle && (profile.launchAppName || profile.appAction === 'open-tool')) {
        await openTool(profile.toolName ?? profile.name);
      }
    } finally {
      setConnecting(null);
    }
  }, [activeProfileNames, antigravityPatch, displayNameFor, openTool, openUrl, profiles, refreshAntigravityPatch, startProfiles, toast]);

  const disconnectProfile = useCallback(async (profileName: string) => {
    if (profileName === 'antigravity') {
      setAntigravityInlineNotice(null);
      setMessage(null);
      const currentPatch = await refreshAntigravityPatch(true) ?? antigravityPatch;
      if (currentPatch?.enabled) {
        if (currentPatch.running || currentPatch.state === 'close-antigravity') {
          const notice = 'Close Antigravity first before disconnecting so Torve can restore the original app bundle cleanly.';
          setAntigravityInlineNotice(notice);
          setMessage(notice);
          toast.push({ kind: 'warning', title: 'Close Antigravity first', description: notice });
          return;
        }
        setAntigravityPatchBusy(true);
        try {
          const patchResult = await window.torveDesktop?.antigravityStandaloneSet?.(false);
          if (patchResult?.status) {
            setAntigravityPatch(patchResult.status);
          } else {
            await refreshAntigravityPatch(true);
          }
          if (patchResult && !patchResult.ok && patchResult.error) {
            setMessage(patchResult.error);
            setAntigravityInlineNotice(patchResult.error);
            toast.push({ kind: 'error', title: 'Antigravity restore failed', description: patchResult.error });
          }
        } finally {
          setAntigravityPatchBusy(false);
        }
      }
    }
    const remaining = activeProfileNames.filter((name) => name !== profileName);
    if (remaining.length === 0) {
      await disconnect(profileName);
      return;
    }
    recordUserAction('app_disconnect', 'apps', normalizeTelemetryAppName(profileName));
    const ok = await startProfiles(remaining);
    if (ok) {
      toast.push({
        kind: 'info',
        title: `${displayNameFor(profileName)} disconnected`,
        description: 'Restored original configuration.',
      });
    }
  }, [activeProfileNames, antigravityPatch, disconnect, displayNameFor, refreshAntigravityPatch, startProfiles, toast]);

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

  const trustCa = useCallback(async () => {
    const bridge = window.torveDesktop;
    if (!bridge?.systemProxyInstallCa) return;
    setTrustBusy(true);
    setMessage(null);
    try {
      const result = await bridge.systemProxyInstallCa();
      if (!result.ok) {
        const errMsg = result.error ?? 'CA install failed';
        setMessage(errMsg);
        toast.push({ kind: 'error', title: 'Certificate trust failed', description: errMsg });
        return;
      }
      const trust = await refreshCaTrust();
      await testGui();
      // The CLI's login-keychain fallback reports "system-wide trust was
      // skipped" even when the cert ends up trusted for this user — which is
      // all intercepted GUI apps need. Only surface the warning when the
      // keychain still doesn't verify the cert as trusted.
      if (result.warning && trust !== 'trusted') {
        setMessage(result.warning);
        toast.push({ kind: 'warning', title: 'Certificate trust warning', description: result.warning });
      } else if (trust === 'trusted') {
        toast.push({ kind: 'success', title: 'HTTPS certificate trusted', description: 'Intercepted apps can connect securely.' });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setMessage(errMsg);
      toast.push({ kind: 'error', title: 'Certificate trust failed', description: errMsg });
    } finally {
      setTrustBusy(false);
    }
  }, [refreshCaTrust, testGui, toast]);

  const revealCa = useCallback(async () => {
    const result = await window.torveDesktop?.systemProxyRevealCa?.();
    if (result && !result.ok) {
      const errMsg = result.error ?? 'Could not reveal the certificate';
      setMessage(errMsg);
      toast.push({ kind: 'error', title: 'Could not reveal certificate', description: errMsg });
    }
  }, [toast]);

  const copyCaPath = useCallback(async () => {
    if (!caInfo?.path) return;
    try {
      await navigator.clipboard.writeText(caInfo.path);
      setCaCopied(true);
      window.setTimeout(() => setCaCopied(false), 1500);
    } catch {
      setCaCopied(false);
    }
  }, [caInfo?.path]);

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

  // Picking an application only stages a draft — it applies on Save.
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
  // The drafted pick wins over the persisted one for everything the modal shows.
  const settingsLaunchName = launchDraft === undefined
    ? settingsProfile?.launchAppName ?? null
    : launchDraft?.name ?? null;

  // Apply the drafted settings. A connected app disconnects first — the proxy
  // runtime only reads profiles on connect, so edits never apply mid-session;
  // reconnecting stays on the apps list row.
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
      // Sync drafts to the normalized values the main process persisted —
      // including a custom app renamed after its application pick.
      const listed = (await bridge.systemProxyListProfiles?.()) ?? [];
      systemProxyResource.setData({ profiles: listed, state: proxyState });
      setLaunchDraft(undefined);
      const updated = listed.find((profile) => profile.name === settingsFor);
      if (updated) setIdentityDraft((updated.toolSlugs?.length ? updated.toolSlugs : [updated.name]).join(', '));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSettingsSaving(false);
    }
  }, [activeProfileNames, disconnect, identityDirty, identityDraft, launchDirty, launchDraft, proxyState, settingsFor, startProfiles]);

  const advanceAddStep = useCallback((step: 2 | 3) => {
    setAddStep(step);
    setAddPane({ pane: 'main', dir: 'forward' });
  }, []);

  const addCustomApp = useCallback(async (force = false) => {
    const bridge = window.torveDesktop;
    if (!bridge?.systemProxyAddCustomApp) return;
    setAddBusy(true);
    setAddError(null);
    try {
      const result = await bridge.systemProxyAddCustomApp({
        apiUrl: addUrl,
        app: addApp ? { name: addApp.name, path: addApp.path } : null,
        force,
      });
      if (!result.ok) {
        setAddUnverified(result.unverified === true);
        setAddError(result.error ?? 'Unable to add custom app');
        return;
      }
      setAddUnverified(false);
      setAddedName(result.name ?? null);
      await refresh();
      // Intercepting a custom app's HTTPS needs the local CA trusted, so the
      // trust step comes next — skipped when the CA is already trusted.
      const trust = await refreshCaTrust();
      advanceAddStep(trust === 'trusted' ? 3 : 2);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err));
    } finally {
      setAddBusy(false);
    }
  }, [addApp, addUrl, advanceAddStep, refresh, refreshCaTrust]);

  // Wizard variant of Trust: advance to the connect step once the keychain
  // confirms the CA is trusted (trustCa surfaces its own errors via message).
  const trustCaFromWizard = useCallback(async () => {
    await trustCa();
    const trust = await refreshCaTrust();
    if (trust === 'trusted') advanceAddStep(3);
  }, [advanceAddStep, refreshCaTrust, trustCa]);

  const removeCustomApp = useCallback(async (profileName: string, connected: boolean) => {
    const bridge = window.torveDesktop;
    if (!bridge?.systemProxyRemoveCustomApp) return;
    setActionBusy(profileName);
    setMessage(null);
    try {
      if (connected) {
        const remaining = activeProfileNames.filter((name) => name !== profileName);
        if (remaining.length === 0) {
          await disconnect(profileName);
        } else {
          await startProfiles(remaining);
        }
      }
      const result = await bridge.systemProxyRemoveCustomApp(profileName);
      if (!result.ok) {
        const errMsg = result.error ?? 'Unable to remove app';
        setMessage(errMsg);
        toast.push({ kind: 'error', title: 'Could not remove app', description: errMsg });
        return;
      }
      await refresh();
      toast.push({ kind: 'info', title: 'Custom app removed' });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setMessage(errMsg);
      toast.push({ kind: 'error', title: 'Could not remove app', description: errMsg });
    } finally {
      setActionBusy(null);
    }
  }, [activeProfileNames, disconnect, refresh, startProfiles, toast]);

  const orderedProfiles = useMemo(() => {
    // Connected apps float to the top; the sort is stable, so each group keeps
    // its original order.
    const isConnected = (name: string): boolean => activeProfiles?.has(name) ?? false;
    return [...profiles].sort((a, b) => Number(isConnected(b.name)) - Number(isConnected(a.name)));
  }, [profiles, activeProfiles]);

  // Certificate trust presentation. A live probe failure (certTrustError) or a
  // stale/absent keychain state all mean the same thing to the user: press
  // Trust. `stale` is the CERT_SIGNATURE_FAILURE case — an older CA trusted
  // under the same name that re-trusting will replace.
  const certNeedsTrust = guiTest?.certTrustError === true || caTrust === 'stale' || caTrust === 'absent';
  const certBadgeLabel = guiTest?.certTrustError ? 'Not trusted'
    : caTrust === 'trusted' ? 'Trusted'
    : caTrust === 'stale' ? 'Update needed'
    : caTrust === 'absent' ? 'Not trusted'
    : caInfo?.exists ? 'Installed' : 'Not created yet';
  const certBadgeTone: 'green' | 'neutral' = certNeedsTrust
    ? 'neutral'
    : caTrust === 'trusted' || caInfo?.exists ? 'green' : 'neutral';

  const activeProgressBanner = useMemo(() => {
    const entries = Object.values(progressByApp);
    return entries.find((entry) => isActiveProgressStage(entry.stage)) ?? null;
  }, [progressByApp]);

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
              brands={BRIDGE_HARNESSES}
              connectedIds={[...connectedBridgeIds]}
              autoplay={false}
              hub={<TorveMark size={38} />}
              title="Torve App Bridge"
              description="Click any harness tile to route its AI traffic through Torve, or manage per-app models and settings below."
              onToggle={(id, nextConnected) => {
                if (busy !== null || connecting !== null) return;
                if (!nextConnected) {
                  void disconnectProfile(id);
                  return;
                }
                if (!cloudConnected && !defaultPeerId) {
                  const label = displayNameFor(id);
                  const warnMsg = 'Sign in to Torve Desktop on Overview before connecting apps.';
                  setMessage(warnMsg);
                  toast.push({
                    kind: 'warning',
                    title: `Sign in to connect ${label}`,
                    description: warnMsg,
                  });
                  return;
                }
                void connectProfile(id);
              }}
            />
          </div>

          <div className={styles.appList}>
            <CursorAppCard appId="cline-roo" label="Cline / Roo Code" brand="generic" />
            {orderedProfiles.map((profile) => {
              const connected = activeProfiles?.has(profile.name) ?? false;
              const setupComplete = setupProfiles.has(profile.name);
              const rowProgress = progressByApp[profile.name];
              const progressActive = isActiveProgressStage(rowProgress?.stage);
              const rowBusy = connecting === profile.name || actionBusy === profile.name || progressActive;
              const canOpenApp = Boolean(
                profile.launchAppName
                || profile.appAction === 'open-url'
                || profile.appAction === 'open-tool'
                || OPENABLE_PROFILE_NAMES.has(profile.name),
              );
              const brandKey = resolveBrandKey(profile.name, profile.displayName);
              const profileCard = (
                <div key={profile.name} className={`${styles.appPill}${connected ? ` ${styles.appPillConnected}` : ''}`}>
                  <div className={styles.appHead}>
                    <span className={styles.appIdentity}>
                      {profile.iconDataUri && !isThemeAwareAppBrand(brandKey) ? (
                        <img src={profile.iconDataUri} alt="" className={styles.appIcon} />
                      ) : (
                        <BrandIcon brand={brandKey} size={24} />
                      )}
                      <span className={styles.appText}>
                        <span className={styles.appNameRow}>
                          {/* The name itself launches the associated app when
                              one is available — no separate app link line. */}
                          {profile.launchAppName || profile.appAction === 'open-url' || profile.appAction === 'open-tool' ? (
                            <button
                              type="button"
                              className={styles.appNameLink}
                              onClick={() => { void openConnectedApp(profile); }}
                              title={`Open ${profile.launchAppName ?? profile.displayName}`}
                            >
                              {profile.displayName}
                            </button>
                          ) : (
                            <span className={styles.appName}>{profile.displayName}</span>
                          )}
                          {profile.name === 'claude-desktop' ? <span className={styles.claudeCodeBadge}>&lt;/&gt; Code</span> : null}
                          {profile.name === 'antigravity' ? <span className={styles.torveBetaBadge}>Beta</span> : null}
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
                    <div className={styles.quickActionBar} role="group" aria-label={`${profile.displayName} quick actions`}>
                      {rowBusy ? (
                        <span
                          className={styles.appBusy}
                          role="status"
                          aria-label={rowProgress?.label ?? `Working on ${profile.displayName}`}
                          title={rowProgress?.label ?? `Working on ${profile.displayName}`}
                        />
                      ) : null}
                      <button
                        type="button"
                        className={styles.quickActionBtn}
                        disabled={rowBusy || !canOpenApp}
                        onClick={() => { void openConnectedApp(profile); }}
                        aria-label={`Open ${profile.displayName}`}
                        title={canOpenApp
                          ? `Open ${profile.launchAppName ?? profile.displayName}`
                          : `${profile.displayName} is a terminal CLI — launch it from your terminal`}
                      >
                        <QuickOpenIcon />
                      </button>
                      <button
                        type="button"
                        className={`${styles.quickActionBtn}${connected && profile.needsRestart ? ` ${styles.appRestartNeeded}` : ''}`}
                        disabled={rowBusy || !connected}
                        onClick={() => { void restartApp(profile.name, profile.displayName); }}
                        aria-label={`Restart ${profile.displayName}`}
                        title={!connected
                          ? `Connect ${profile.displayName} first to restart`
                          : profile.needsRestart
                            ? `Restart ${profile.displayName} to apply the connection`
                            : `Restart GUI or verify CLI session for ${profile.displayName}`}
                      >
                        <QuickRestartIcon />
                      </button>
                      <button
                        type="button"
                        className={styles.quickActionBtn}
                        disabled={rowBusy || !connected}
                        onClick={() => { void refreshConnectedApp(profile.name, profile.displayName); }}
                        aria-label={`Refresh and verify ${profile.displayName}`}
                        title={!connected
                          ? `Connect ${profile.displayName} first to refresh`
                          : `Re-patch config and verify proxy for ${profile.displayName}`}
                      >
                        <QuickRefreshIcon />
                      </button>
                      <button
                        type="button"
                        className={`${styles.configAction}${settingsFor === profile.name ? ` ${styles.configActionActive}` : ''}`}
                        onClick={() => openSettings(profile)}
                        aria-haspopup="dialog"
                        aria-label={`${profile.displayName} settings`}
                        title={`${profile.displayName} settings`}
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
                        disabled={busy !== null || (!connected && !cloudConnected && !defaultPeerId)}
                        onClick={() => {
                          if (connected) void disconnectProfile(profile.name);
                          else void connectProfile(profile.name);
                        }}
                        aria-label={`${connected ? 'Disconnect' : 'Connect'} ${profile.displayName}`}
                        title={`${connected ? 'Disconnect' : 'Connect'} ${profile.displayName}`}
                      >
                        <span />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={styles.connectAction}
                        disabled={busy !== null || (!cloudConnected && !defaultPeerId)}
                        onClick={() => { void connectProfile(profile.name); }}
                      >
                        Connect
                      </button>
                    )}
                  </div>
                  {profile.name === 'antigravity' ? (() => {
                    const statusSummary = antigravityStatusSummary(antigravityPatch);
                    const statusClass = statusSummary.tone === 'ok'
                      ? styles.antigravityStatusOk
                      : statusSummary.tone === 'warn'
                        ? styles.antigravityStatusWarn
                        : statusSummary.tone === 'error'
                          ? styles.antigravityStatusError
                          : '';
                    const showCloseAndApply = Boolean(
                      antigravityPatch?.installed &&
                      (antigravityPatch.running || antigravityPatch.state === 'close-antigravity') &&
                      !antigravityPatch.enabled,
                    );
                    const showApplyReapply = Boolean(
                      antigravityPatch?.installed &&
                      antigravityPatch.state === 'needs-reapply' &&
                      !antigravityPatch.running,
                    );
                    const showLaunch = Boolean(
                      antigravityPatch?.installed &&
                      antigravityPatch.enabled &&
                      !antigravityPatch.running,
                    );
                    const showRefreshWhileRunning = Boolean(
                      antigravityPatch?.installed &&
                      antigravityPatch.enabled &&
                      antigravityPatch.running,
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
                  {profile.name === 'codex' ? (
                    <p className={styles.codexRestartNote}>Restart Codex if it was open so it connects cleanly to 127.0.0.1:8378.</p>
                  ) : null}
                  {profile.name === 'claude-desktop' ? (
                    <p className={styles.mcpModelNote}>Applies to Claude Desktop&apos;s Code (&lt;/&gt;) tab &amp; Claude Code CLI (claude.ai Chat tab uses Anthropic cloud directly).</p>
                  ) : null}
                  {cloudModels.length > 0 && profile.kind === 'config-patch' && profile.name !== 'antigravity' ? (
                    <label className={styles.modelPicker}>
                      <span>Model</span>
                      <select
                        value={modelOverrides[profile.name]?.modelId ?? ''}
                        onChange={(event) => void setAppModel(profile.name, event.target.value)}
                        aria-label={`${profile.displayName} Torve model`}
                      >
                        <option value="">Automatic</option>
                        {cloudModels.map((model) => <option key={model.id} value={model.id}>{model.id}</option>)}
                      </select>
                    </label>
                  ) : null}
                  {backupsByApp[profile.name] ? (
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
                                title: `${profile.displayName} backup restored`,
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
              return profile.name === 'claude-desktop'
                ? [profileCard, <CursorAppCard key="cursor" />]
                : profileCard;
            })}
          </div>

          {/* The certificate only matters for intercepted (mitm proxy) apps —
              keep the card hidden until one is connected, or one exists and
              the cert still needs trusting to let it connect. */}
          {caInfo && (hasConnectedProxyProfile || (hasProxyProfile && certNeedsTrust)) ? (() => {
            const caExpanded = caOpenOverride ?? certNeedsTrust;
            return (
              <div className={styles.caCard}>
                <button
                  type="button"
                  className={styles.caHead}
                  aria-expanded={caExpanded}
                  onClick={() => setCaOpenOverride(!caExpanded)}
                >
                  <HugeiconsIcon icon={SquareLock01Icon} size={14} strokeWidth={2} />
                  <span className={styles.caTitle}>HTTPS certificate</span>
                  <VprBadge tone={certBadgeTone}>{certBadgeLabel}</VprBadge>
                  <HugeiconsIcon
                    icon={ArrowDown01Icon}
                    size={14}
                    strokeWidth={2}
                    className={`${styles.caChevron}${caExpanded ? ` ${styles.caChevronOpen}` : ''}`}
                  />
                </button>
                {caExpanded ? (
                  <>
                    <p className={styles.caHint}>
                      {caTrust === 'stale'
                        ? 'An older Torve certificate is still trusted on this device — trust the current one to replace it, otherwise intercepted apps fail with an SSL certificate error.'
                        : 'Apps whose HTTPS traffic is intercepted trust a certificate generated locally on this device. It never leaves your machine — inspect it any time.'}
                    </p>
                    <button type="button" className={styles.caPath} onClick={() => { void copyCaPath(); }} title={caInfo.path}>
                      <code>{caInfo.path}</code>
                      <HugeiconsIcon icon={caCopied ? Tick02Icon : Copy01Icon} size={13} strokeWidth={2} />
                      <span>{caCopied ? 'Copied' : 'Copy'}</span>
                    </button>
                    {caInfo.exists || certNeedsTrust ? (
                      <div className={styles.actions}>
                        {caInfo.exists ? (
                          <button type="button" onClick={() => { void revealCa(); }}>Reveal certificate</button>
                        ) : null}
                        {certNeedsTrust ? (
                          <button type="button" onClick={() => { void trustCa(); }} disabled={trustBusy}>
                            {trustBusy ? 'Trusting...' : 'Trust certificate'}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            );
          })() : null}
        </div>

        <div className={styles.appFooter}>
          <button
            type="button"
            className={styles.addAppButton}
            onClick={() => {
              setAddOpen(true);
              setAddUrl('');
              setAddApp(null);
              setAddPane({ pane: 'main', dir: 'none' });
              setAddSearch('');
              setAddStep(1);
              setAddedName(null);
              setAddError(null);
              setAddUnverified(false);
              setMessage(null);
              ensureInstalledApps();
            }}
          >
            <HugeiconsIcon icon={Add01Icon} size={14} strokeWidth={2} />
            Add custom app
          </button>

          <button type="button" className={styles.learnMore} onClick={() => setHelpOpen(true)}>
            What are connected apps?
          </button>
        </div>
      </div>
      </VprPage>

      {showOnboarding && <AppsOnboarding onDone={() => setShowOnboarding(false)} />}

      {/* Connected-apps explainer. */}
      <Modal
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
        size="sm"
        title="Connected apps"
        subtitle="How AI VPN works with your tools"
        bodyClassName={styles.settingsBody}
      >
        <section className={styles.settingSection}>
          <div className={styles.settingHead}>
            <span className={styles.settingTitle}>What connecting does</span>
          </div>
          <p className={styles.settingHint}>
            Connecting an app routes its AI requests through AI VPN. The app works exactly
            as usual — its model calls are served by the Torve network and paid from
            your balance instead of a subscription or API key. Click an app&apos;s name
            any time to open it.
          </p>
        </section>
        <section className={styles.settingSection}>
          <div className={styles.settingHead}>
            <span className={styles.settingTitle}>How apps connect</span>
          </div>
          <p className={styles.settingHint}>
            Most tools are pointed at AI VPN through a small change to their own config
            file — written locally on Connect and removed again on Disconnect (a backup
            of the original is kept next to it). Apps marked HTTPS proxy are instead
            intercepted on this device, which needs the locally generated certificate
            below to be trusted. After connecting, start a new session in the tool so
            it picks up the routing.
          </p>
        </section>
        <section className={styles.settingSection}>
          <div className={styles.settingHead}>
            <span className={styles.settingTitle}>Models and chats</span>
          </div>
          <p className={styles.settingHint}>
            Connected apps follow the model selected on the AI VPN home screen. Each chat
            then sticks to the model that served its first request — pin a different
            one per chat from Recent chats or the floating pill.
          </p>
        </section>
        <section className={styles.settingSection}>
          <div className={styles.settingHead}>
            <span className={styles.settingTitle}>Custom apps and settings</span>
          </div>
          <p className={styles.settingHint}>
            Add any other app by the API URL it calls — its requests are redirected to
            AI VPN on this device (localhost). Each app&apos;s gear opens its settings:
            the application to open, the client names that attribute its chats, and
            Disconnect or Remove.
          </p>
        </section>
      </Modal>

      {/* Per-app settings: application to open and request-identity client
          names, edited as drafts and applied by the footer Save (which
          disconnects a connected app first), plus Disconnect / Remove. */}
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
                  noneLabel={settingsProfile.custom ? 'No application' : 'Default action'}
                  noneMeta={settingsProfile.custom
                    ? 'No application associated with this app'
                    : 'Use the app’s built-in open behavior'}
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
                        ? `${settingsProfile.displayName}'s AI requests currently route through AI VPN. Disconnecting restores its direct connection.${settingsDirty ? ' Saving these changes disconnects it first — reconnect from the apps list.' : ''}`
                        : `Connect from the apps list to route ${settingsProfile.displayName}'s AI requests through AI VPN — served by the Torve network and paid from your balance.`}
                    </p>
                  </section>

                  <section className={styles.settingSection}>
                    <div className={styles.settingHead}>
                      <span className={styles.settingTitle}>Application</span>
                    </div>
                    <p className={styles.settingHint}>
                      The installed application AI VPN launches for {settingsProfile.displayName} —
                       used by the restart button and when jumping back into a chat session.
                    </p>
                    <button
                      type="button"
                      className={styles.settingValueRow}
                      onClick={() => setSettingsPane({ pane: 'apps', dir: 'forward' })}
                    >
                      {settingsProfile.iconDataUri
                        ? <img src={settingsProfile.iconDataUri} alt="" className={styles.pickerIcon} />
                        : <BrandIcon name={settingsProfile.name} hints={[settingsProfile.displayName]} size={20} />}
                      <span className={styles.settingValueName}>
                        {settingsLaunchName
                          ?? (settingsProfile.custom ? 'No application' : 'Default action')}
                      </span>
                      <HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={2} className={styles.settingValueChevron} />
                    </button>
                  </section>

                  <section className={styles.settingSection}>
                    <div className={styles.settingHead}>
                      <span className={styles.settingTitle}>Request identity</span>
                    </div>
                    <p className={styles.settingHint}>
                      AI VPN matches requests to {settingsProfile.displayName} by the client name they
                      carry on the wire — the User-Agent product or session header, like{' '}
                      <code>opencode</code> or <code>codex</code>. Separate multiple names with commas.
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

                  {settingsProfile.custom ? (
                    <section className={styles.settingSection}>
                      <div className={styles.settingHead}>
                        <span className={styles.settingTitle}>Remove</span>
                      </div>
                      <p className={styles.settingHint}>
                        Removes {settingsProfile.displayName} from AI VPN — its requests go directly
                        to {settingsProfile.domains[0] ?? 'the API'} again.
                      </p>
                      <div className={styles.settingActions}>
                        <button
                          type="button"
                          className={styles.settingDanger}
                          disabled={actionBusy === settingsProfile.name || busy !== null}
                          onClick={() => {
                            if (window.confirm(`Remove ${settingsProfile.displayName}? Its requests will no longer route through AI VPN.`)) {
                              setSettingsFor(null);
                              void removeCustomApp(settingsProfile.name, connected);
                            }
                          }}
                        >
                          Remove app
                        </button>
                      </div>
                    </section>
                  ) : null}

                  {/* Connect lives on the apps list row — the footer only
                      saves drafted changes or disconnects a connected app. */}
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

      {/* Add custom app: a 3-step wizard — the API URL to intercept plus an
          optional installed application, then trusting the local CA (skipped
          when already trusted), then connecting the new app. */}
      <Modal
        isOpen={addOpen}
        onClose={() => { if (!addBusy) setAddOpen(false); }}
        size="sm"
        title={addPane.pane === 'apps' ? (
          <span className={styles.modalBackTitle}>
            <button
              type="button"
              className={styles.paneBackButton}
              onClick={() => setAddPane({ pane: 'main', dir: 'back' })}
              aria-label="Back"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={15} strokeWidth={2} />
            </button>
            Choose application
          </span>
        ) : 'Add custom app'}
        subtitle={addPane.pane === 'apps' ? undefined
          : addStep === 1 ? 'Route another app through AI VPN'
          : addStep === 2 ? 'Trust the HTTPS certificate'
          : 'Connect the app'}
        bodyClassName={styles.settingsBody}
      >
        {addPane.pane !== 'apps' ? (
          <div className={styles.wizardSteps} aria-hidden="true">
            {(['Add', 'Trust', 'Connect'] as const).map((label, index) => {
              const step = index + 1;
              const state = addStep === step ? styles.wizardStepActive : addStep > step ? styles.wizardStepDone : '';
              return (
                <span key={label} className={`${styles.wizardStep}${state ? ` ${state}` : ''}`}>
                  <span className={styles.wizardStepNum}>
                    {addStep > step ? <HugeiconsIcon icon={Tick02Icon} size={11} strokeWidth={2.4} /> : step}
                  </span>
                  {label}
                </span>
              );
            })}
          </div>
        ) : null}
        <div key={`${addPane.pane}-${addStep}`} className={`${styles.pane}${addPane.dir === 'forward' ? ` ${styles.paneForward}` : addPane.dir === 'back' ? ` ${styles.paneBack}` : ''}`}>
          {addPane.pane === 'apps' ? (
            <AppPickerPane
              apps={installedApps}
              error={installedAppsError}
              search={addSearch}
              onSearch={setAddSearch}
              activeName={addApp?.name ?? null}
              onChoose={(app) => {
                setAddApp(app);
                setAddPane({ pane: 'main', dir: 'back' });
              }}
              noneLabel="No application"
              noneMeta="Use the API host's name and icon"
            />
          ) : addStep === 1 ? (
            <form
              className={styles.settingsBody}
              onSubmit={(event) => {
                event.preventDefault();
                void addCustomApp(addUnverified);
              }}
            >
              <section className={styles.settingSection}>
                <div className={styles.settingHead}>
                  <span className={styles.settingTitle}>API URL</span>
                  <span className={styles.settingTag}>Required</span>
                </div>
                <p className={styles.settingHint}>
                  AI requests the app sends to this URL are redirected to AI VPN on this
                  device (localhost) and served by the Torve network instead.
                </p>
                <input
                  type="text"
                  className={styles.settingInput}
                  value={addUrl}
                  placeholder="https://api.example.com/v1"
                  autoFocus
                  spellCheck={false}
                  onChange={(event) => {
                    setAddUrl(event.currentTarget.value);
                    // A changed URL invalidates the previous probe result.
                    setAddUnverified(false);
                  }}
                  disabled={addBusy}
                />
              </section>

              <section className={styles.settingSection}>
                <div className={styles.settingHead}>
                  <span className={styles.settingTitle}>Application</span>
                  <span className={styles.settingTag}>Optional</span>
                </div>
                <p className={styles.settingHint}>
                  Pick the installed application that talks to this API — its name and icon
                  identify the new entry, and the open arrow launches it.
                </p>
                <button
                  type="button"
                  className={styles.settingValueRow}
                  onClick={() => setAddPane({ pane: 'apps', dir: 'forward' })}
                >
                  {addApp?.iconDataUri
                    ? <img src={addApp.iconDataUri} alt="" className={styles.pickerIcon} />
                    : null}
                  <span className={styles.settingValueName}>{addApp?.name ?? 'No application'}</span>
                  <HugeiconsIcon icon={ArrowRight01Icon} size={14} strokeWidth={2} className={styles.settingValueChevron} />
                </button>
              </section>

              {addError ? <p className={styles.note} role="alert">{addError}</p> : null}

              <div className={styles.wizardFooter}>
                <button
                  type="button"
                  className={styles.settingQuiet}
                  onClick={() => setAddOpen(false)}
                  disabled={addBusy}
                >
                  Cancel
                </button>
                <button type="submit" className={styles.settingPrimary} disabled={addBusy || addUrl.trim().length === 0}>
                  {addBusy ? (addUnverified ? 'Adding...' : 'Checking...') : addUnverified ? 'Add anyway' : 'Continue'}
                </button>
              </div>
            </form>
          ) : addStep === 2 ? (
            <>
              <section className={styles.settingSection}>
                <div className={styles.settingHead}>
                  <span className={styles.settingTitle}>HTTPS certificate</span>
                  <VprBadge tone={certBadgeTone}>{certBadgeLabel}</VprBadge>
                </div>
                <p className={styles.settingHint}>
                  {caTrust === 'stale'
                    ? 'An older Torve certificate is still trusted on this device — trust the current one to replace it, otherwise the app fails with an SSL certificate error.'
                    : 'Custom apps connect over HTTPS intercepted on this device, which needs the certificate generated locally by Torve to be trusted. It never leaves your machine.'}
                </p>
                {caInfo?.path ? (
                  <button type="button" className={styles.caPath} onClick={() => { void copyCaPath(); }} title={caInfo.path}>
                    <code>{caInfo.path}</code>
                    <HugeiconsIcon icon={caCopied ? Tick02Icon : Copy01Icon} size={13} strokeWidth={2} />
                    <span>{caCopied ? 'Copied' : 'Copy'}</span>
                  </button>
                ) : null}
              </section>

              {message ? <p className={styles.note} role="status">{message}</p> : null}

              <div className={styles.wizardFooter}>
                <button
                  type="button"
                  className={styles.settingQuiet}
                  onClick={() => advanceAddStep(3)}
                  disabled={trustBusy}
                >
                  Skip for now
                </button>
                <button type="button" className={styles.settingPrimary} onClick={() => { void trustCaFromWizard(); }} disabled={trustBusy}>
                  {trustBusy ? 'Trusting...' : 'Trust certificate'}
                </button>
              </div>
            </>
          ) : (() => {
            const addedProfile = addedName ? profiles.find((entry) => entry.name === addedName) ?? null : null;
            const addedLabel = addedProfile?.displayName ?? addApp?.name ?? 'the app';
            return (
              <>
                <section className={styles.settingSection}>
                  <div className={styles.settingHead}>
                    <span className={styles.settingTitle}>Ready to connect</span>
                  </div>
                  <p className={styles.settingHint}>
                    Connecting routes {addedLabel}&apos;s AI requests through AI VPN — served by
                    the Torve network and paid from your balance. The app opens after
                    connecting; start a new session there so it picks up the routing.
                  </p>
                  {addedProfile ? (
                    <div className={styles.wizardApp}>
                      {addedProfile.iconDataUri
                        ? <img src={addedProfile.iconDataUri} alt="" className={styles.pickerIcon} />
                        : <BrandIcon name={addedProfile.name} hints={[addedProfile.displayName]} size={20} />}
                      <span className={styles.settingValueName}>{addedProfile.displayName}</span>
                    </div>
                  ) : null}
                </section>

                {addError ? <p className={styles.note} role="alert">{addError}</p> : null}

                <div className={styles.wizardFooter}>
                  <button type="button" className={styles.settingQuiet} onClick={() => setAddOpen(false)}>
                    Later
                  </button>
                  <button
                    type="button"
                    className={styles.settingPrimary}
                    disabled={busy !== null || !defaultPeerId || !addedName}
                    onClick={() => {
                      if (!addedName) return;
                      setAddOpen(false);
                      void connectProfile(addedName);
                    }}
                  >
                    Connect
                  </button>
                </div>
              </>
            );
          })()}
        </div>
      </Modal>
    </section>
  );
}

/** Application-list pane the settings and add-app modals slide to: a
    searchable list with a "none" row first. The back affordance lives in
    the modal header (title swaps to back + "Choose application"). */
function AppPickerPane({ apps, error, search, onSearch, activeName, onChoose, noneLabel, noneMeta }: {
  apps: InstalledAppEntry[] | null;
  error: string | null;
  search: string;
  onSearch: (value: string) => void;
  /** Currently associated application name, or null when none is set. */
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
              {app.iconDataUri
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
