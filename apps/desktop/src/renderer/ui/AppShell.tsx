import { useCallback, useEffect, useRef, useState } from 'react';
import { ViewErrorBoundary } from './components/ViewErrorBoundary';
import { ViewHost } from './components/ViewHost';
import { preloadViews, viewsForPreload } from './components/viewRegistry';
import { VIEW_NAMES, type ViewName } from './types';
import { VprShell } from './components/VprShell';
import { recordUserAction, telemetrySurfaceForView } from '../modules/telemetry/actions';

type IdleCallbackHandle = ReturnType<typeof setTimeout> | number;

function scheduleRoutePreload(callback: () => void): () => void {
  const win = window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

  if (win.requestIdleCallback) {
    const handle = win.requestIdleCallback(callback, { timeout: 1_500 });
    return () => win.cancelIdleCallback?.(handle);
  }

  const handle: IdleCallbackHandle = window.setTimeout(callback, 250);
  return () => window.clearTimeout(handle);
}

export function AppShell() {
  const [activeView, setActiveView] = useState<ViewName>('home');

  const viewHistoryRef = useRef<ViewName[]>([]);
  const activeViewRef = useRef<ViewName>(activeView);

  const handleSelectView = useCallback((view: ViewName) => {
    const current = activeViewRef.current;
    if (view === current) return;
    recordUserAction('view_opened', telemetrySurfaceForView(view));
    const stack = viewHistoryRef.current;
    stack.push(current);
    if (stack.length > 32) stack.shift();
    activeViewRef.current = view;
    setActiveView(view);
  }, []);

  const handleNavigateBack = useCallback((fallback: ViewName) => {
    const current = activeViewRef.current;
    const stack = viewHistoryRef.current;
    let target = stack.pop();
    while (target === current) target = stack.pop();
    const next = target ?? fallback;
    if (next === current) return;
    recordUserAction('view_opened', telemetrySurfaceForView(next));
    activeViewRef.current = next;
    setActiveView(next);
  }, []);

  useEffect(() => {
    return window.torveDesktop?.onNavigateView?.((viewName) => {
      if (!(VIEW_NAMES as readonly string[]).includes(viewName)) return;
      handleSelectView(viewName as ViewName);
    });
  }, [handleSelectView]);

  useEffect(() => {
    void preloadViews(viewsForPreload('eager'));

    return scheduleRoutePreload(() => {
      void preloadViews(viewsForPreload('idle'));
    });
  }, []);

  useEffect(() => {
    void window.torveDesktop?.applyWindowView?.(activeView);
  }, [activeView]);

  return (
    <VprShell activeView={activeView} onSelectView={handleSelectView} onNavigateBack={handleNavigateBack}>
      <ViewErrorBoundary resetKey={activeView} onGoHome={() => handleSelectView('home')}>
        <ViewHost activeView={activeView} onSelectView={handleSelectView} />
      </ViewErrorBoundary>
    </VprShell>
  );
}
