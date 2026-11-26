import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react';
import { ToastStack, type ToastItem, type ToastStackHandle } from '../../../components/motion-brew/toast-stack';

type ToastApi = {
  push: (toast: ToastItem) => string | undefined;
  dismiss: (id: string) => void;
  clear: () => void;
};

const NOOP_API: ToastApi = {
  push: () => undefined,
  dismiss: () => {},
  clear: () => {},
};

const TorveToastContext = createContext<ToastApi>(NOOP_API);

export function TorveToastProvider({ children }: { children: ReactNode }) {
  const stackRef = useRef<ToastStackHandle>(null);

  const push = useCallback((toast: ToastItem) => stackRef.current?.push(toast), []);
  const dismiss = useCallback((id: string) => { stackRef.current?.dismiss(id); }, []);
  const clear = useCallback(() => { stackRef.current?.clear(); }, []);

  const value = useMemo(() => ({ push, dismiss, clear }), [push, dismiss, clear]);

  return (
    <TorveToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        style={{
          position: 'fixed',
          right: 20,
          bottom: 38,
          zIndex: 70,
          pointerEvents: 'none',
          maxWidth: 'min(420px, calc(100vw - 32px))',
        }}
      >
        <div style={{ pointerEvents: 'auto' }}>
          <ToastStack ref={stackRef} initial={[]} triggers={false} duration={5000} visible={3} />
        </div>
      </div>
    </TorveToastContext.Provider>
  );
}

export function useTorveToast(): ToastApi {
  return useContext(TorveToastContext);
}
