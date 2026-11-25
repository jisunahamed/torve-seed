import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TeeEvidence } from '@torveai/node/tee-status';
import { createInitialUiState } from '../../../core/state';
import { initStore } from '../../../core/store';
import { normalizeDiscoverRow } from '../../../modules/catalog/discover-rows';
import { projectRowsToVprModelCatalog } from '../../../modules/catalog/model-catalog';
import { teeBrowseCache } from '../../../modules/catalog/tee-browse';
import { VprModelRowList } from '../vpr/VprModelRows';
import { VprExploreView } from './VprExploreView';
import { VprModelView } from './VprModelView';
import { VprPreferencesView } from './VprPreferencesView';
import styles from './VprModelView.module.scss';

const { action } = vi.hoisted(() => ({ action: vi.fn() }));
const verification = vi.hoisted(() => ({ evidence: [] as TeeEvidence[] }));
vi.mock('../../hooks/useActions', () => ({ useActions: () => new Proxy({}, { get: () => action }) }));
vi.mock('../../hooks/useTeeVerification', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../hooks/useTeeVerification')>(),
  useTeeVerification: () => ({
    status: { snapshot: { sessionId: 'buyer', verificationEnabled: true, evidence: verification.evidence } },
    now: 1000, checking: [], peerErrors: {},
  }),
}));

afterEach(() => {
  teeBrowseCache.filter = 'all';
  action.mockClear();
  verification.evidence = [];
  vi.unstubAllGlobals();
});

function initialize() {
  const state = createInitialUiState();
  const rows = [
    normalizeDiscoverRow({ peerId: 'standard', serviceId: 'gpt-test', provider: 'openai', protocol: 'openai-chat-completions', peerDisplayName: 'Standard Seller', inputUsdPerMillion: 0, outputUsdPerMillion: 0, effectiveReputationScore: 90 }),
    normalizeDiscoverRow({ peerId: 'tee', serviceId: 'gpt-test', provider: 'openai', protocol: 'openai-chat-completions', peerDisplayName: 'TEE Seller', advertisedVerifierIds: ['torve-verifier'], inputUsdPerMillion: 2, outputUsdPerMillion: 4, effectiveReputationScore: 90 }),
  ];
  assert.ok(rows[0] && rows[1]);
  state.vprRoutableRows = [rows[0], rows[1]];
  state.vprModelCatalog = projectRowsToVprModelCatalog(state.vprRoutableRows);
  state.chatDiscoverRowsLoaded = true;
  state.vprRouteSelection = { model: { provider: 'openai', serviceId: 'gpt-test', label: 'GPT Test', categories: [] }, mode: 'pinned-peer', peerId: 'standard' };
  initStore(state);
  return state;
}

test('TEE availability badges do not appear in Home/chat row lists', () => {
  const state = initialize();
  const props = { entries: state.vprModelCatalog, onSelect: action, emptyLabel: 'Empty' };
  assert.doesNotMatch(renderToStaticMarkup(<VprModelRowList {...props} />), /TEE available/);

});

test('Models & Usage omits P2P TEE availability badges and seller routing clutter', () => {
  const state = initialize();
  const selection = structuredClone(state.vprRouteSelection);
  for (const filter of ['all', 'tee'] as const) {
    teeBrowseCache.filter = filter;
    const markup = renderToStaticMarkup(<VprExploreView />);
    assert.match(markup, /Models &amp; Usage/);
    assert.doesNotMatch(markup, /TEE available|All sellers/);
  }
  assert.deepEqual(state.vprRouteSelection, selection);
  assert.equal(action.mock.calls.length, 0);
});

test('Settings does not expose P2P TEE or seller routing controls', () => {
  vi.stubGlobal('document', { body: { classList: { contains: () => false } } });
  const state = initialize();
  const selection = structuredClone(state.vprRouteSelection);
  const markup = renderToStaticMarkup(<VprPreferencesView />);
  assert.match(markup, /Activity &amp; Settings/);
  assert.doesNotMatch(markup, /Auto select seller|Require.*verification|Seller-node verification|Reapply saved setting|routing is paused/);
  assert.deepEqual(state.vprRouteSelection, selection);
  assert.equal(action.mock.calls.length, 0);
});

test('verified TEE badge follows the seller name outside the pin button', () => {
  initialize();
  verification.evidence = [{
    peerId: 'tee', verifierId: 'torve-verifier', fingerprint: 'caps',
    checkedAt: 500, expiresAt: 2000, sellerNodeVerified: true, claims: [],
  }];
  const markup = renderToStaticMarkup(<VprModelView />);
  const nameStart = markup.indexOf(`class="${styles.sellerNameLabel}">TEE Seller</span>`);
  const badgeStart = markup.indexOf(`class="${styles.sellerVerification}"`, nameStart);
  const metaStart = markup.indexOf(`class="${styles.sellerMeta}"`, nameStart);
  assert.ok(nameStart >= 0 && badgeStart > nameStart && badgeStart < metaStart);
  assert.match(markup.slice(badgeStart, metaStart), /tabindex="0".*aria-label="TEE\. We use TEEs to enhance user privacy\."/);
  const button = markup.match(/<button[^>]*aria-label="Pin TEE Seller"[^>]*>(.*?)<\/button>/);
  assert.ok(button);
  assert.equal(button[1], '');
  assert.equal(action.mock.calls.length, 0);
  verification.evidence[0]!.sellerNodeVerified = false;
  assert.ok(!renderToStaticMarkup(<VprModelView />).includes(`class="${styles.sellerVerification}"`));
});

test('identity links and verified TEE badges coexist outside the seller pin button', () => {
  const state = initialize();
  const selection = structuredClone(state.vprRouteSelection);
  const route = state.vprRoutableRows.find((entry) => entry.peerId === 'tee');
  assert.ok(route);
  route.verificationLinks = [
    { kind: 'domain', label: 'example.com', href: 'https://example.com' },
    { kind: 'github', label: 'example', href: 'https://github.com/example' },
  ];
  verification.evidence = [{
    peerId: 'tee', verifierId: 'torve-verifier', fingerprint: 'caps',
    checkedAt: 500, expiresAt: 2000, sellerNodeVerified: true, claims: [],
  }];
  const markup = renderToStaticMarkup(<VprModelView />);
  const nameStart = markup.indexOf(`class="${styles.sellerNameLabel}">TEE Seller</span>`);
  const metaStart = markup.indexOf(`class="${styles.sellerMeta}"`, nameStart);
  const badges = markup.slice(nameStart, metaStart);
  assert.match(badges, /aria-label="Seller identity badges"/);
  assert.match(badges, /href="https:\/\/example.com"/);
  assert.match(badges, /aria-label="Verified GitHub: example"/);
  assert.match(badges, /aria-label="TEE\. We use TEEs to enhance user privacy\."/);
  assert.match(markup, /<button[^>]*aria-label="Pin TEE Seller"[^>]*><\/button>/);
  assert.doesNotMatch(badges, /<button/);
  assert.deepEqual(state.vprRouteSelection, selection);
  assert.equal(action.mock.calls.length, 0);
});

test('TEE detail filtering hides standard sellers without clearing the active pin', () => {
  const state = initialize();
  const selection = structuredClone(state.vprRouteSelection);
  teeBrowseCache.filter = 'tee';
  const markup = renderToStaticMarkup(<VprModelView />);
  assert.match(markup, /TEE Seller/);
  assert.doesNotMatch(markup, /Standard Seller/);
  assert.match(markup, /selected seller is hidden/);
  assert.match(markup, /Show all sellers/);
  assert.match(markup, /automatic routing may use other sellers/);
  assert.match(markup, /aria-label="Auto select seller" aria-checked="false"|aria-checked="false" aria-label="Auto select seller"/);
  assert.deepEqual(state.vprRouteSelection, selection);
  assert.equal(action.mock.calls.length, 0);
  teeBrowseCache.filter = 'all';
  assert.match(renderToStaticMarkup(<VprModelView />), /Standard Seller/);
});

test('TEE empty states preserve loading and offer a way to clear the browse filter on VprModelView', () => {
  const state = initialize();
  state.vprRoutableRows = state.vprRoutableRows.filter((row) => row.peerId === 'standard');
  state.vprModelCatalog = projectRowsToVprModelCatalog(state.vprRoutableRows);
  teeBrowseCache.filter = 'tee';
  assert.match(renderToStaticMarkup(<VprModelView />), /No sellers advertising TEE support match these filters/);
  state.chatDiscoverRowsLoaded = false;
  assert.match(renderToStaticMarkup(<VprModelView />), /Loading sellers/);
  assert.equal(action.mock.calls.length, 0);
});
