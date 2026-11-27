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

  it('renders About & Updates card with Check for Updates and all update states', () => {
    vi.stubGlobal('document', { body: { classList: { contains: () => true } } });

    const defaultMarkup = renderToStaticMarkup(<VprPreferencesView />);
    expect(defaultMarkup).toContain('About Torve Desktop');
    expect(defaultMarkup).toContain('Check for Updates');
    expect(defaultMarkup).toContain('Last checked: Never');
    expect(defaultMarkup).toContain('Torve Desktop is up to date');

    const checkingMarkup = renderToStaticMarkup(
      <VprPreferencesView
        initialUpdateStatus={{
          status: 'checking',
          version: '0.2.58',
          currentVersion: '0.2.58',
        }}
      />,
    );
    expect(checkingMarkup).toContain('Checking…');
    expect(checkingMarkup).toContain('v0.2.58');

    const ts = new Date('2026-11-25T20:00:00Z').getTime();
    const upToDateMarkup = renderToStaticMarkup(
      <VprPreferencesView
        initialUpdateStatus={{
          status: 'up-to-date',
          version: '0.2.58',
          currentVersion: '0.2.58',
          latestVersion: '0.2.58',
          lastCheckedAt: ts,
        }}
      />,
    );
    expect(upToDateMarkup).toContain('Torve Desktop is up to date');
    expect(upToDateMarkup).not.toContain('Last checked: Never');

    const availableMarkup = renderToStaticMarkup(
      <VprPreferencesView
        initialUpdateStatus={{
          status: 'available',
          version: '0.2.59',
          currentVersion: '0.2.58',
          latestVersion: '0.2.59',
          lastCheckedAt: ts,
        }}
      />,
    );
    expect(availableMarkup).toContain('Torve Desktop v0.2.59 is available');
    expect(availableMarkup).toContain('Download &amp; Update');

    const downloadingMarkup = renderToStaticMarkup(
      <VprPreferencesView
        initialUpdateStatus={{
          status: 'downloading',
          version: '0.2.59',
          percent: 42,
          downloadPercent: 42,
          currentVersion: '0.2.58',
        }}
      />,
    );
    expect(downloadingMarkup).toContain('Downloading 42%');
    expect(downloadingMarkup).toContain('role="progressbar"');

    const readyMarkup = renderToStaticMarkup(
      <VprPreferencesView
        initialUpdateStatus={{
          status: 'ready',
          version: '0.2.59',
          currentVersion: '0.2.58',
        }}
      />,
    );
    expect(readyMarkup).toContain('Torve Desktop v0.2.59 is ready to install');
    expect(readyMarkup).toContain('Restart to Install');

    const errorMarkup = renderToStaticMarkup(
      <VprPreferencesView
        initialUpdateStatus={{
          status: 'error',
          version: null,
          message: 'Network offline',
          details: 'ENOTFOUND api.github.com',
          lastCheckedAt: ts,
        }}
      />,
    );
    expect(errorMarkup).toContain('Network offline');
  });
});
