import type { DesktopBridge } from './bridge';

declare global {
  interface Window {
    torveDesktop?: DesktopBridge;
  }
}

export {};
