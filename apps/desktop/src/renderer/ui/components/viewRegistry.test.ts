import { describe, expect, it } from 'vitest';
import { VIEW_NAMES, type ViewName } from '../types';
import { VIEW_WINDOW_PRESETS } from '../../../shared/view-windows';
import { getViewRegistryEntry, navViews, preloadView, preloadViews, viewsForPreload, VIEW_REGISTRY } from './viewRegistry';

describe('view registry', () => {
  it('registers exactly one lazy component for every known view', () => {
    expect(Object.keys(VIEW_REGISTRY).sort()).toEqual([...VIEW_NAMES].sort());

    for (const view of VIEW_NAMES) {
      const entry = getViewRegistryEntry(view);
      expect(entry.component).toBe(VIEW_REGISTRY[view].component);
      expect(typeof entry.preload).toBe('function');
      expect(typeof entry.receivesOnSelectView).toBe('boolean');
    }
  });

  it('passes navigation callbacks to every view', () => {
    const navigationViews = VIEW_NAMES.filter((view) => getViewRegistryEntry(view).receivesOnSelectView);
    expect(navigationViews).toEqual([...VIEW_NAMES]);
  });

  it('reuses the same preload promise for repeated preload requests', () => {
    const entry = getViewRegistryEntry('explore');
    expect(entry.preload()).toBe(entry.preload());
  });

  it('can preload multiple views through the public helper', async () => {
    const loaded = await preloadViews(['explore']);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toBe(await preloadView('explore'));
  });

  it('derives the clean 4-tab Torve Desktop nav rail without P2P clutter', () => {
    expect(navViews('main').map((entry) => entry.view)).toEqual(
      ['home', 'tools', 'explore'] satisfies ViewName[],
    );
    expect(navViews('bottom').map((entry) => entry.view)).toEqual(['preferences'] satisfies ViewName[]);
    expect(getViewRegistryEntry('home').nav?.label).toBe('Overview');
    expect(getViewRegistryEntry('tools').nav?.label).toBe('Connected Apps');
    expect(getViewRegistryEntry('explore').nav?.label).toBe('Models & Usage');
    expect(getViewRegistryEntry('preferences').nav?.label).toBe('Settings');
    for (const removedNav of ['tunnels', 'rewards', 'credits', 'chat', 'torve-account'] as const) {
      expect(getViewRegistryEntry(removedNav).nav).toBeNull();
    }
    for (const entry of [...navViews('main'), ...navViews('bottom')]) {
      expect(entry.nav.label).toBeTruthy();
      expect(entry.nav.icon).toBeTruthy();
    }
  });

  it('splits route preloading into startup and idle tiers', () => {
    expect(viewsForPreload('eager')).toEqual(
      ['home', 'tools', 'explore', 'preferences'] satisfies ViewName[],
    );
    expect(viewsForPreload('idle')).toEqual(['model'] satisfies ViewName[]);
  });

  it('assigns every view a slide position', () => {
    for (const view of VIEW_NAMES) {
      expect(getViewRegistryEntry(view).slideIndex).toBeGreaterThanOrEqual(0);
    }
    expect(getViewRegistryEntry('model').slideIndex).toBeGreaterThan(getViewRegistryEntry('explore').slideIndex);
  });

  it('covers every view in the shared window-preset map', () => {
    expect(Object.keys(VIEW_WINDOW_PRESETS).sort()).toEqual([...VIEW_NAMES].sort());
  });
});
