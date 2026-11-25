import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ViewErrorBoundary } from '../ViewErrorBoundary';
import { VprPreferencesView } from './VprPreferencesView';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('VprPreferencesView safety and rendering', () => {
  it('renders cleanly in default node/SSR environment without window or backups', () => {
    vi.stubGlobal('document', { body: { classList: { contains: () => true } } });
    const markup = renderToStaticMarkup(<VprPreferencesView />);
    expect(markup).toContain('Activity &amp; Settings');
    expect(markup).toContain('Live Request Activity (0)');
    expect(markup).toContain('Backup &amp; Restore');
    expect(markup).toContain('Launch at Login');
  });

  it('renders cleanly when window.torveDesktop has partial/empty bridge methods', () => {
    vi.stubGlobal('document', { body: { classList: { contains: () => true } } });
    vi.stubGlobal('window', {
      torveDesktop: {
        torveAccountGet: async () => ({
          connected: true,
          authMode: 'oauth',
          email: 'user@torveai.com',
          keyHint: 'sk-trv-1…9999',
          keyMeta: null,
          userMeta: { id: 'u1', email: 'user@torveai.com', name: 'User', plan: 'pro', status: 'active' },
          updatedAt: Date.now(),
          secureStorage: true,
        }),
        torveBackupsList: async () => ([
          { appId: 'opencode', files: [{ originalPath: '/home/.config/opencode/opencode.json', existedBefore: true }] },
        ]),
      },
    });
    const markup = renderToStaticMarkup(<VprPreferencesView />);
    expect(markup).toContain('Activity &amp; Settings');
    expect(markup).toContain('Torve Desktop');
  });

  it('ViewErrorBoundary derives error state cleanly and renders recovery fallback', () => {
    const onGoHome = vi.fn();
    const derived = ViewErrorBoundary.getDerivedStateFromError(new Error('simulated settings crash'));
    expect(derived.error?.message).toBe('simulated settings crash');

    const boundary = new ViewErrorBoundary({ resetKey: 'preferences', onGoHome, children: null });
    boundary.state = derived;
    const fallbackMarkup = renderToStaticMarkup(boundary.render());
    expect(fallbackMarkup).toContain('simulated settings crash');
    expect(fallbackMarkup).toContain('Retry');
    expect(fallbackMarkup).toContain('Back to Overview');
  });
});
