import type { RendererUiState } from '../../core/state';
import { notifyUiStateChanged } from '../../core/store';
import type { DesktopBridge } from '../../types/bridge';

type AppSetupModuleOptions = {
  uiState: RendererUiState;
  bridge: DesktopBridge | null;
};

/**
 * Normal Torve Desktop runs directly against api.torveai.com via the local
 * loopback proxy (127.0.0.1:8378) and never blocks startup on P2P router plugin
 * installation.
 */
export function initAppSetupModule({ uiState, bridge }: AppSetupModuleOptions) {
  uiState.appSetupNeeded = false;
  uiState.appSetupComplete = true;
  uiState.appSetupStatusKnown = true;
  notifyUiStateChanged();

  if (!bridge) return;
  return () => {};
}
