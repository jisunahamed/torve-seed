import { useCallback, useEffect, useState } from 'react';
import type { TorveAccountStatus, TorveDesktopMeResponse } from '../../../types/bridge';
import { VprPage } from '../vpr/VprKit';
import { TorveAuthCard } from '../torve/TorveAuthCard';

type Props = { onSelectView?: (view: import('../../types').ViewName) => void };

export function TorveAccountView(_props: Props) {
  const [account, setAccount] = useState<TorveAccountStatus | null>(null);
  const [me, setMe] = useState<TorveDesktopMeResponse | null>(null);
  const [pkcePending, setPkcePending] = useState(false);
  const [authError, setAuthError] = useState<{ message: string; statusCode?: number; code?: string } | null>(null);

  const load = useCallback(async () => {
    const bridge = window.torveDesktop;
    if (!bridge) return;
    const [acct, meRes] = await Promise.all([
      bridge.torveAccountGet?.(),
      bridge.torveMeGet?.(),
    ]);
    if (acct) setAccount(acct);
    if (meRes) setMe(meRes.me ?? null);
  }, []);

  useEffect(() => {
    void load();
    return window.torveDesktop?.onTorveAuthEvent?.((event) => {
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
  }, [load]);

  return (
    <section className="view view-torve-account view-pinned-header" role="tabpanel">
      <VprPage title="Torve Account" backFallback="home">
        <TorveAuthCard
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
      </VprPage>
    </section>
  );
}
