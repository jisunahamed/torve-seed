import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowReloadHorizontalIcon, ArrowUpRight01Icon } from '@hugeicons/core-free-icons';
import type { TorveAuthMode } from '../../../types/bridge';

export interface SidebarDiagnosticsProps {
  collapsed: boolean;
  proxyActive: boolean;
  proxyPort: number;
  connected: boolean;
  planLabel: string | null;
  statusLabel: string | null;
  keyName: string | null;
  keyPrefix: string | null;
  authMode: TorveAuthMode | null;
  healthy: boolean;
  refreshing: boolean;
  signOutBusy: boolean;
  onRefresh: () => void;
  onCopyProxy: () => void;
  onManageKeys: () => void;
  onSignOut: () => void;
  onSignIn: () => void;
  onOpenOverview: () => void;
}

/**
 * Compact Obsidian Kinetic proxy & account diagnostics card placed in the
 * lower left sidebar between navigation items and the user avatar footer.
 */
export function SidebarDiagnostics({
  collapsed,
  proxyActive,
  proxyPort,
  connected,
  planLabel,
  statusLabel,
  keyName,
  keyPrefix,
  authMode,
  healthy,
  refreshing,
  signOutBusy,
  onRefresh,
  onCopyProxy,
  onManageKeys,
  onSignOut,
  onSignIn,
  onOpenOverview,
}: SidebarDiagnosticsProps) {
  if (collapsed) {
    return (
      <div className="flex w-full justify-center px-3 pb-1">
        <button
          type="button"
          onClick={onCopyProxy}
          title={`Local Proxy 127.0.0.1:${proxyPort} (${proxyActive ? 'Active' : 'Stopped'})${planLabel ? ` · ${planLabel}` : ''}`}
          aria-label={`Local proxy 127.0.0.1:${proxyPort}`}
          className="grid size-10 place-items-center rounded-xl border border-[#222226] bg-[#18181B]/90 text-[#A1A1AA] transition-colors hover:border-[#3F3F46] hover:text-[#F4F4F5]"
        >
          <span
            className="size-2.5 rounded-full"
            style={{
              backgroundColor: proxyActive ? '#14FF73' : '#F59E0B',
              boxShadow: proxyActive ? '0 0 8px rgba(20, 255, 115, 0.55)' : undefined,
            }}
          />
        </button>
      </div>
    );
  }

  const normalizedStatus = (statusLabel || 'active').toUpperCase();
  const isActiveStatus = normalizedStatus === 'ACTIVE';

  return (
    <section
      aria-label="Proxy and account diagnostics"
      className="mx-3 mb-2 flex flex-col gap-2 rounded-xl border border-[#222226] bg-[#161619] p-2.5 text-[#F4F4F5]"
    >
      {/* Row 1: Full Proxy URL + Refresh */}
      <div className="flex items-center justify-between gap-1.5">
        <button
          type="button"
          onClick={onCopyProxy}
          title="Click to copy local proxy endpoint"
          className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-[#27272A] bg-[#09090B] px-2.5 py-1 font-mono text-[11px] text-[#E4E4E7] transition-colors hover:border-[#3F3F46]"
        >
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{
              backgroundColor: proxyActive ? '#14FF73' : '#F59E0B',
              boxShadow: proxyActive ? '0 0 6px rgba(20, 255, 115, 0.55)' : undefined,
            }}
          />
          <span className="whitespace-nowrap">127.0.0.1:{proxyPort}</span>
        </button>

        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Refresh status"
          title="Refresh account & proxy status"
          className="grid size-7 shrink-0 place-items-center rounded-lg border border-[#27272A] bg-[#18181B] text-[#A1A1AA] transition-colors hover:border-[#3F3F46] hover:text-[#F4F4F5] disabled:opacity-50"
        >
          <HugeiconsIcon
            icon={ArrowReloadHorizontalIcon}
            size={13}
            strokeWidth={2}
            className={refreshing ? 'animate-spin' : undefined}
          />
        </button>
      </div>

      {/* Row 2: Health Line (full width, never clipped) */}
      <button
        type="button"
        onClick={onOpenOverview}
        className="flex w-full items-center gap-2 rounded-lg border border-[#222226] bg-[#09090B]/70 px-2.5 py-1.5 text-left transition-colors hover:border-[#3F3F46]"
      >
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: healthy && proxyActive && connected ? '#14FF73' : '#F59E0B' }}
        />
        <span className={`truncate text-[11px] font-medium ${healthy && proxyActive && connected ? 'text-[#D4D4D8]' : 'text-[#FCD34D]'}`}>
          {!connected
            ? 'Sign in required'
            : !proxyActive
              ? 'Local proxy stopped'
              : 'All systems healthy'}
        </span>
      </button>

      {connected ? (
        <>
          {/* Row 3: DESKTOP + Plan + Status Badges */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded border border-[#27272A] bg-[#18181B] px-1.5 py-0.5 font-mono text-[9.5px] font-semibold tracking-wider text-[#A1A1AA]">
              DESKTOP
            </span>
            {planLabel ? (
              <span className="rounded bg-[#D8FF0A]/14 px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase text-[#D8FF0A]">
                {planLabel}
              </span>
            ) : null}
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase ${
                isActiveStatus
                  ? 'bg-[#14FF73]/14 text-[#14FF73]'
                  : 'bg-[#F59E0B]/14 text-[#FCD34D]'
              }`}
            >
              {normalizedStatus}
            </span>
          </div>

          {/* Row 4: Key & Auth Details */}
          <div className="flex flex-col gap-1 rounded-lg border border-[#222226] bg-[#09090B]/60 px-2.5 py-1.5 text-[10.5px]">
            <div className="flex items-center justify-between gap-2">
              <span className="shrink-0 text-[#71717A]">Key</span>
              <span className="min-w-0 truncate font-mono text-[#E4E4E7]" title={keyName || 'Torve Desktop Key'}>
                {keyName || 'Torve Desktop'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="shrink-0 text-[#71717A]">Prefix</span>
              <span className="min-w-0 truncate font-mono text-[#A1A1AA]" title={keyPrefix || 'sk-trv-••••'}>
                {keyPrefix || 'sk-trv-••••'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="shrink-0 text-[#71717A]">Auth</span>
              <span className="truncate font-mono text-[#A1A1AA]">
                {authMode === 'oauth' ? 'Browser PKCE' : 'API Key'}
              </span>
            </div>
          </div>

          {/* Row 5: Single-line crisp actions */}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={onManageKeys}
              className="inline-flex h-7 items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-[#27272A] bg-[#18181B] px-2 text-[10.5px] font-medium text-[#E4E4E7] transition-colors hover:border-[#3F3F46] hover:text-white"
            >
              <span>Keys</span>
              <HugeiconsIcon icon={ArrowUpRight01Icon} size={11} strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={onSignOut}
              disabled={signOutBusy}
              className="inline-flex h-7 items-center justify-center whitespace-nowrap rounded-lg border border-[#27272A] bg-[#18181B] px-2 text-[10.5px] font-medium text-[#A1A1AA] transition-colors hover:border-[#3F3F46] hover:text-[#F4F4F5] disabled:opacity-50"
            >
              {signOutBusy ? 'Signing out…' : 'Sign Out'}
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={onSignIn}
          className="inline-flex h-7 w-full items-center justify-center rounded-lg bg-[#D8FF0A] px-2.5 text-[11px] font-semibold text-[#09090B] transition-opacity hover:opacity-90"
        >
          Sign In to Torve
        </button>
      )}
    </section>
  );
}
