import type {
  BuyerConversationSummary,
  InstalledAppEntry,
  RuntimeProcessState,
  SystemProxyProfileSummary,
} from '../../types/bridge';
import { createCachedResource } from './cached-resource';

const POLL_MS = 3_000;
const PROFILES_POLL_MS = 30_000;

export const buyerConversationsResource = createCachedResource<BuyerConversationSummary[]>({
  pollMs: POLL_MS,
  async load() {
    const conversations = await window.torveDesktop?.buyerConversationsList?.();
    if (conversations === null || conversations === undefined) throw new Error('Buyer unavailable');
    return conversations;
  },
});

export type SystemProxySnapshot = {
  profiles: SystemProxyProfileSummary[];
  state: RuntimeProcessState | null;
};

export const systemProxyResource = createCachedResource<SystemProxySnapshot>({
  pollMs: PROFILES_POLL_MS,
  async load() {
    const bridge = window.torveDesktop;
    const [profiles, state] = await Promise.all([
      bridge?.systemProxyListProfiles?.() ?? Promise.resolve([]),
      bridge?.systemProxyGetState?.() ?? Promise.resolve(null),
    ]);
    return { profiles, state };
  },
});

export async function refreshSystemProxyProfilesForce(): Promise<void> {
  const bridge = window.torveDesktop;
  if (!bridge) return;
  const [profiles, state] = await Promise.all([
    bridge.systemProxyListProfiles?.({ refresh: true }) ?? Promise.resolve([]),
    bridge.systemProxyGetState?.() ?? Promise.resolve(null),
  ]);
  systemProxyResource.setData({ profiles, state });
}

export const installedAppsResource = createCachedResource<InstalledAppEntry[]>({
  async load() {
    const result = await window.torveDesktop?.listInstalledApps?.();
    if (!result?.ok) throw new Error(result?.error ?? 'Could not list applications');
    return result.apps ?? [];
  },
});
