import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BridgeBrand } from '../../../components/motion-brew/brand-bridge';
import type {
  AntigravityStandalonePatchStatus,
  ConnectLifecycleProgress,
  RuntimeProcessState,
  SystemProxyProfileSummary,
} from '../../../types/bridge';
import { BrandIcon } from '../brand/BrandIcon';
import { useTorveToast } from './TorveToastContext';
import { recordUserAction } from '../../../modules/telemetry/actions';
import { normalizeTelemetryAppName } from '../../../../shared/telemetry.js';

export const ACTIVE_APP_ROSTER = [
  { id: 'antigravity', displayName: 'Google Antigravity' },
  { id: 'codex', displayName: 'Codex' },
  { id: 'opencode', displayName: 'OpenCode' },
  { id: 'claude-desktop', displayName: 'Claude Desktop' },
  { id: 'claude-code', displayName: 'Claude Code CLI' },
  { id: 'gemini-cli', displayName: 'Gemini CLI' },
] as const;

export type ActiveAppId = (typeof ACTIVE_APP_ROSTER)[number]['id'];

export const ACTIVE_APP_IDS: ReadonlySet<string> = new Set(ACTIVE_APP_ROSTER.map((app) => app.id));

export const ACTIVE_APP_DISPLAY_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  ACTIVE_APP_ROSTER.map((app) => [app.id, app.displayName]),
);

export const ACTIVE_APP_ORDER: Readonly<Record<string, number>> = Object.fromEntries(
  ACTIVE_APP_ROSTER.map((app, index) => [app.id, index]),
);

export const BRIDGE_HARNESSES: BridgeBrand[] = [
  {
    id: 'antigravity',
    name: 'Google Antigravity',
    colors: ['#4285F4', '#FABB05'],
    logo: <BrandIcon brand="antigravity" size={24} />,
  },
  {
    id: 'codex',
    name: 'Codex',
    colors: ['#10A37F', '#D8FF0A'],
    logo: <BrandIcon brand="openai" size={24} style={{ color: '#10A37F' }} />,
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    colors: ['#F4F4F5', '#14FF73'],
    logo: <BrandIcon brand="opencode" size={24} style={{ color: '#F4F4F5' }} />,
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    colors: ['#D97757', '#F59E0B'],
    logo: <BrandIcon brand="anthropic" size={24} />,
  },
  {
    id: 'claude-code',
    name: 'Claude Code CLI',
    colors: ['#D97757', '#EC4899'],
    logo: <BrandIcon brand="claude-code" size={24} />,
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    colors: ['#4285F4', '#9B72CB'],
    logo: (
      <svg viewBox="0 0 24 24" className="size-6" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="gem-bridge-grad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#4285F4" />
            <stop offset="55%" stopColor="#9B72CB" />
            <stop offset="100%" stopColor="#D96570" />
          </linearGradient>
        </defs>
        <path
          d="M12 2.5c.6 5.3 4.2 8.9 9.5 9.5-5.3.6-8.9 4.2-9.5 9.5-.6-5.3-4.2-8.9-9.5-9.5 5.3-.6 8.9-4.2 9.5-9.5z"
          fill="url(#gem-bridge-grad)"
        />
      </svg>
    ),
  },
];

export const BRIDGE_HARNESS_IDS = new Set(BRIDGE_HARNESSES.map((harness) => harness.id));

export function isActiveProgressStage(stage: ConnectLifecycleProgress['stage'] | undefined): boolean {
  return stage === 'checking-proxy'
    || stage === 'backing-up'
    || stage === 'patching'
    || stage === 'restarting-app'
    || stage === 'verifying';
}

export function buildBridgeHarnesses(
  profiles: SystemProxyProfileSummary[],
  activeProfiles: ReadonlySet<string> | null,
): BridgeBrand[] {
  return BRIDGE_HARNESSES.map((harness) => {
    const profile = profiles.find((entry) => entry.name === harness.id);
    const connected = activeProfiles?.has(harness.id) ?? false;
    const installed = profile
      ? (connected || profile.installed !== false)
      : profiles.length === 0;
    return {
      ...harness,
      installed,
    };
  });
}

export function getConnectedBridgeIds(activeProfileNames: string[]): string[] {
  const connected: string[] = [];
  for (const name of activeProfileNames) {
    if (BRIDGE_HARNESS_IDS.has(name) && !connected.includes(name)) {
      connected.push(name);
    }
  }
  return connected;
}

type UseHarnessBridgeOptions = {
  profiles: SystemProxyProfileSummary[];
  activeProfileNames: string[];
  cloudConnected: boolean;
  proxyPeerId?: string | null;
  antigravityPatch: AntigravityStandalonePatchStatus | null;
  setAntigravityPatch: (status: AntigravityStandalonePatchStatus) => void;
  onRuntimeStateUpdated: (state: RuntimeProcessState | null, activeNames: string[]) => void;
  onAfterStartSuccess?: () => void;
  onMessage?: (message: string | null) => void;
  onInlineAntigravityNotice?: (notice: string | null) => void;
  launchAfterConnect?: boolean;
};

/**
 * Shared controller for connecting/disconnecting harnesses via the interactive
 * BrandBridge and Connected Apps toggle switches.
 */
export function useHarnessBridge({
  profiles,
  activeProfileNames,
  cloudConnected,
  proxyPeerId,
  antigravityPatch,
  setAntigravityPatch,
  onRuntimeStateUpdated,
  onAfterStartSuccess,
  onMessage,
  onInlineAntigravityNotice,
  launchAfterConnect = true,
}: UseHarnessBridgeOptions) {
  const toast = useTorveToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [antigravityPatchBusy, setAntigravityPatchBusy] = useState(false);
  const [progressByApp, setProgressByApp] = useState<Record<string, ConnectLifecycleProgress>>({});
  const lastLaunchedOrRestartedRef = useRef<string[]>([]);

  const activeSet = useMemo(() => new Set(activeProfileNames), [activeProfileNames]);

  const displayNameFor = useCallback((profileName: string) => (
    ACTIVE_APP_DISPLAY_NAMES[profileName]
    ?? profiles.find((profile) => profile.name === profileName)?.displayName
    ?? profileName
  ), [profiles]);

  const refreshAntigravityPatch = useCallback(async (bypassCache = false) => {
    try {
      const bridge = typeof window !== 'undefined' ? window.torveDesktop : undefined;
      const status = await bridge?.antigravityStandaloneStatus?.(bypassCache ? { bypassCache: true } : undefined) ?? null;
      if (status) setAntigravityPatch(status);
      if (status && !status.running) onInlineAntigravityNotice?.(null);
      return status;
    } catch {
      return null;
    }
  }, [onInlineAntigravityNotice, setAntigravityPatch]);

  useEffect(() => {
    const bridge = typeof window !== 'undefined' ? window.torveDesktop : undefined;
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
  }, [displayNameFor, toast]);

  const activeProgressBanner = useMemo(() => {
    const entries = Object.values(progressByApp);
    return entries.find((entry) => isActiveProgressStage(entry.stage)) ?? null;
  }, [progressByApp]);

  const openUrl = useCallback(async (url: string) => {
    const result = await window.torveDesktop?.openExternalUrl?.(url);
    if (result && !result.ok) {
      const errMsg = result.error ?? 'Could not open tool';
      onMessage?.(errMsg);
      toast.push({ kind: 'error', title: 'Could not open URL', description: errMsg });
    }
  }, [onMessage, toast]);

  const openTool = useCallback(async (toolName: string) => {
    const result = await window.torveDesktop?.openTool?.(toolName);
    if (result && !result.ok) {
      const errMsg = result.error ?? 'Could not open tool';
      onMessage?.(errMsg);
      toast.push({ kind: 'error', title: `Could not open ${displayNameFor(toolName)}`, description: errMsg });
    }
  }, [displayNameFor, onMessage, toast]);

  const startProfiles = useCallback(async (names: string[]): Promise<boolean> => {
    const bridge = window.torveDesktop;
    lastLaunchedOrRestartedRef.current = [];
    setBusy(names.join(','));
    onMessage?.(null);
    const account = await bridge?.torveAccountGet?.();
    if (!account?.connected || !bridge?.torveDirectStart) {
      setBusy(null);
      const warnMsg = 'Sign in to Torve Desktop before connecting apps.';
      onMessage?.(warnMsg);
      toast.push({ kind: 'warning', title: 'Sign in required', description: warnMsg });
      return false;
    }
    const result = await bridge.torveDirectStart(names);
    setBusy(null);
    if (!result.ok) {
      const errMsg = result.error ?? 'Unable to connect tool profile to Torve Cloud';
      onMessage?.(errMsg);
      toast.push({ kind: 'error', title: 'Connection failed', description: errMsg });
      return false;
    }
    lastLaunchedOrRestartedRef.current = Array.isArray(result.launchedOrRestartedApps)
      ? result.launchedOrRestartedApps
      : [];
    const nextNames = result.state?.activeProfileNames ?? names;
    onRuntimeStateUpdated(result.state ?? null, nextNames);
    onAfterStartSuccess?.();
    return true;
  }, [onAfterStartSuccess, onMessage, onRuntimeStateUpdated, toast]);

  const disconnect = useCallback(async (appName?: string) => {
    const bridge = window.torveDesktop;
    recordUserAction('app_disconnect', 'apps', appName !== undefined ? normalizeTelemetryAppName(appName) : undefined);
    setBusy('stop');
    const result = proxyPeerId === 'direct'
      ? await bridge?.torveDirectStop?.()
      : await bridge?.systemProxyStop?.();
    setBusy(null);
    if (result?.ok) {
      const nextNames = Array.isArray(result.state?.activeProfileNames)
        ? result.state.activeProfileNames.filter((name): name is string => typeof name === 'string')
        : [];
      onRuntimeStateUpdated(result.state ?? null, nextNames);
      toast.push({
        kind: 'info',
        title: appName ? `${displayNameFor(appName)} disconnected` : 'Apps disconnected',
        description: 'Restored original configuration.',
      });
    } else {
      const errMsg = result?.error ?? 'Unable to disconnect tools';
      onMessage?.(errMsg);
      toast.push({ kind: 'error', title: 'Disconnect failed', description: errMsg });
    }
  }, [displayNameFor, onMessage, onRuntimeStateUpdated, proxyPeerId, toast]);

  const connectProfile = useCallback(async (profileName: string) => {
    const target = profiles.find((entry) => entry.name === profileName);
    if (target && target.installed === false && !activeSet.has(profileName)) {
      return;
    }
    recordUserAction('app_connect', 'apps', normalizeTelemetryAppName(profileName));
    const names = Array.from(new Set([...activeProfileNames, profileName]));
    setConnecting(profileName);
    if (profileName === 'antigravity') onInlineAntigravityNotice?.(null);
    const label = displayNameFor(profileName);
    try {
      if (!await startProfiles(names)) return;
      if (profileName === 'antigravity') {
        const currentPatch = await refreshAntigravityPatch(true) ?? antigravityPatch;
        if (currentPatch?.installed) {
          if (currentPatch.running || currentPatch.state === 'close-antigravity') {
            toast.push({
              kind: 'warning',
              title: 'Google Antigravity connected (picker pending)',
              description: 'Close Antigravity and click Restart & Apply to enable the Native Model Picker.',
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
                onMessage?.(patchResult.error);
                onInlineAntigravityNotice?.(patchResult.error);
                toast.push({ kind: 'error', title: 'Google Antigravity patch failed', description: patchResult.error });
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
      if (!launchAfterConnect || !target) return;
      const alreadyHandledByLifecycle = lastLaunchedOrRestartedRef.current.includes(profileName);
      if (target.appAction === 'open-url' && target.openUrl && !target.launchAppName) {
        await openUrl(target.openUrl);
      } else if (!alreadyHandledByLifecycle && (target.launchAppName || target.appAction === 'open-tool')) {
        await openTool(target.toolName ?? target.name);
      }
    } finally {
      setConnecting(null);
    }
  }, [
    activeProfileNames,
    activeSet,
    antigravityPatch,
    displayNameFor,
    launchAfterConnect,
    onInlineAntigravityNotice,
    onMessage,
    openTool,
    openUrl,
    profiles,
    refreshAntigravityPatch,
    setAntigravityPatch,
    startProfiles,
    toast,
  ]);

  const disconnectProfile = useCallback(async (profileName: string) => {
    if (profileName === 'antigravity') {
      onInlineAntigravityNotice?.(null);
      onMessage?.(null);
      const currentPatch = await refreshAntigravityPatch(true) ?? antigravityPatch;
      if (currentPatch?.enabled) {
        if (currentPatch.running || currentPatch.state === 'close-antigravity') {
          const notice = 'Close Google Antigravity first before disconnecting so Torve can restore the original app bundle cleanly.';
          onInlineAntigravityNotice?.(notice);
          onMessage?.(notice);
          toast.push({ kind: 'warning', title: 'Close Google Antigravity first', description: notice });
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
            onMessage?.(patchResult.error);
            onInlineAntigravityNotice?.(patchResult.error);
            toast.push({ kind: 'error', title: 'Google Antigravity restore failed', description: patchResult.error });
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
  }, [
    activeProfileNames,
    antigravityPatch,
    disconnect,
    displayNameFor,
    onInlineAntigravityNotice,
    onMessage,
    refreshAntigravityPatch,
    setAntigravityPatch,
    startProfiles,
    toast,
  ]);

  const toggleBridgeHarness = useCallback((id: string, nextConnected: boolean) => {
    if (busy !== null || connecting !== null) return;
    const target = profiles.find((entry) => entry.name === id);
    if (target && target.installed === false && !activeSet.has(id)) return;
    if (!nextConnected) {
      void disconnectProfile(id);
      return;
    }
    if (!cloudConnected) {
      const label = displayNameFor(id);
      const warnMsg = 'Sign in to Torve Desktop before connecting apps.';
      onMessage?.(warnMsg);
      toast.push({
        kind: 'warning',
        title: `Sign in to connect ${label}`,
        description: warnMsg,
      });
      return;
    }
    void connectProfile(id);
  }, [activeSet, busy, cloudConnected, connectProfile, connecting, disconnectProfile, displayNameFor, onMessage, profiles, toast]);

  return {
    busy,
    setBusy,
    connecting,
    antigravityPatchBusy,
    setAntigravityPatchBusy,
    progressByApp,
    activeProgressBanner,
    displayNameFor,
    refreshAntigravityPatch,
    startProfiles,
    disconnect,
    connectProfile,
    disconnectProfile,
    toggleBridgeHarness,
    openUrl,
    openTool,
  };
}
