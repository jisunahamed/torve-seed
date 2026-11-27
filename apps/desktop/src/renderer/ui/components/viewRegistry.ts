import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import type { IconSvgElement } from '@hugeicons/react';
import {
  ConnectIcon,
  DiscoverCircleIcon,
  Settings02Icon,
  SquarePowerIcon,
} from '@hugeicons/core-free-icons';
import type { ViewName } from '../types';

// ViewHost only mounts the active view (plus the outgoing one during the
// slide transition), so views don't receive an `active` flag — mounted means
// visible.
export type RoutedViewProps = {
  onSelectView?: (view: ViewName) => void;
};

export type ViewNavConfig = {
  /** 'main' renders in the nav rail's primary group; 'bottom' pinned to the
      rail's bottom. */
  slot: 'main' | 'bottom';
  label: string;
  icon: IconSvgElement;
};

export type ViewRegistryEntry = {
  component: LazyExoticComponent<ComponentType<RoutedViewProps>>;
  preload: () => Promise<ComponentType<RoutedViewProps>>;
  receivesOnSelectView: boolean;
  /** Position on the screen-slide axis: navigating to a higher index slides
      the new view in from the right, a lower one from the left. */
  slideIndex: number;
  /** When AppShell warms this view's chunk: at startup, on first idle, or
      only when navigated to. */
  preloadPriority: 'eager' | 'idle' | 'none';
  /** Nav-rail placement. */
  nav: ViewNavConfig | null;
};

type ViewEntryConfig = {
  receivesOnSelectView: boolean;
  slideIndex: number;
  preloadPriority: ViewRegistryEntry['preloadPriority'];
  nav?: ViewNavConfig;
};

function createViewEntry(
  loader: () => Promise<ComponentType<RoutedViewProps>>,
  config: ViewEntryConfig,
): ViewRegistryEntry {
  let loadPromise: Promise<ComponentType<RoutedViewProps>> | null = null;
  const preload = () => {
    loadPromise ??= loader();
    return loadPromise;
  };

  return {
    component: lazy(async () => ({ default: await preload() })),
    preload,
    receivesOnSelectView: config.receivesOnSelectView,
    slideIndex: config.slideIndex,
    preloadPriority: config.preloadPriority,
    nav: config.nav ?? null,
  };
}

export const VIEW_REGISTRY = {
  home: createViewEntry(
    async () => (await import('./views/VprHomeView')).VprHomeView as ComponentType<RoutedViewProps>,
    {
      receivesOnSelectView: true,
      slideIndex: 0,
      preloadPriority: 'eager',
      nav: { slot: 'main', label: 'Overview', icon: SquarePowerIcon },
    },
  ),
  tools: createViewEntry(
    async () => (await import('./views/VprToolsView')).VprToolsView as ComponentType<RoutedViewProps>,
    {
      receivesOnSelectView: true,
      slideIndex: 1,
      preloadPriority: 'eager',
      nav: { slot: 'main', label: 'Connected Apps', icon: ConnectIcon },
    },
  ),
  explore: createViewEntry(
    async () => (await import('./views/VprExploreView')).VprExploreView as ComponentType<RoutedViewProps>,
    {
      receivesOnSelectView: true,
      slideIndex: 2,
      preloadPriority: 'eager',
      nav: { slot: 'main', label: 'Models & Usage', icon: DiscoverCircleIcon },
    },
  ),
  preferences: createViewEntry(
    async () => (await import('./views/VprPreferencesView')).VprPreferencesView as ComponentType<RoutedViewProps>,
    {
      receivesOnSelectView: true,
      slideIndex: 3,
      preloadPriority: 'eager',
      nav: { slot: 'bottom', label: 'Settings', icon: Settings02Icon },
    },
  ),
} satisfies Record<ViewName, ViewRegistryEntry>;

function registryViews(): ViewName[] {
  return Object.keys(VIEW_REGISTRY) as ViewName[];
}

export function getViewRegistryEntry(view: ViewName): ViewRegistryEntry {
  return VIEW_REGISTRY[view];
}

export type NavView = { view: ViewName; nav: ViewNavConfig };

export function navViews(slot: ViewNavConfig['slot']): NavView[] {
  return registryViews()
    .map((view) => ({ view, nav: VIEW_REGISTRY[view].nav }))
    .filter((entry): entry is NavView => entry.nav?.slot === slot)
    .sort((a, b) => VIEW_REGISTRY[a.view].slideIndex - VIEW_REGISTRY[b.view].slideIndex);
}

export function viewsForPreload(priority: 'eager' | 'idle'): ViewName[] {
  return registryViews().filter((view) => VIEW_REGISTRY[view].preloadPriority === priority);
}

export function preloadView(view: ViewName): Promise<ComponentType<RoutedViewProps>> {
  return getViewRegistryEntry(view).preload();
}

export function preloadViews(views: readonly ViewName[]): Promise<unknown[]> {
  return Promise.all(views.map((view) => preloadView(view)));
}
