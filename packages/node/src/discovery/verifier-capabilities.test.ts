import { describe, expect, it } from 'vitest';
import { advertisesTeeSupport, normalizeAdvertisedVerifierIds, parseVerifierCapabilities } from './verifier-capabilities.js';

describe('advertised verifier capabilities', () => {
  it('preserves supported/default semantics and deduplicates normalized IDs', () => {
    expect(parseVerifierCapabilities([
      'verifier.torve-verifier', 'verifier-default.TORVE-VERIFIER',
      'verifier.acme', 'verifier-default.acme', 'verifier.torve-verifier',
    ])).toEqual({ supported: ['torve-verifier', 'acme'], default: 'acme' });
  });

  it('ignores malformed and missing metadata', () => {
    for (const value of [undefined, null, {}, 'verifier.torve-verifier']) {
      expect(parseVerifierCapabilities(value)).toEqual({ supported: [] });
      expect(normalizeAdvertisedVerifierIds(value)).toEqual([]);
    }
    expect(parseVerifierCapabilities([
      null, 1, {}, 'verifier.', 'verifier.@scope/package', 'verifier.has space',
      'verification.response-auth.v1', 'torve-verifier',
    ])).toEqual({ supported: [] });
  });

  it('recognizes only the supported TEE verifier, not arbitrary verifiers', () => {
    expect(normalizeAdvertisedVerifierIds([' Torve-Verifier ', 'torve-verifier', null, 'bad id']))
      .toEqual(['torve-verifier']);
    expect(advertisesTeeSupport({ advertisedVerifierIds: ['torve-verifier'] })).toBe(true);
    expect(advertisesTeeSupport({ advertisedVerifierIds: ['tee', 'acme', 'torve-verifier-evil'] })).toBe(false);
    expect(advertisesTeeSupport({})).toBe(false);
  });
});
