/**
 * ROK-1170 — `summaryPatch` branch logic (pure; the DB write and Sentry are
 * covered by `blizzard-summary-sync.integration.spec.ts` on the fleet).
 */
import type { SummaryFetch } from '../blizzard-forever-guild-summary.helpers';
import { DISBANDED_AFTER_MS, summaryPatch } from './blizzard-summary-apply';

const NOW = new Date('2026-11-12T12:00:00Z');
const FOUNDED = new Date('2024-03-05T00:00:00Z');
const found = (
  blizzardGuildId: number | null,
  faction: 'Alliance' | 'Horde' | null = 'Horde',
): SummaryFetch => ({
  kind: 'found',
  summary: { blizzardGuildId, foundedAt: FOUNDED, faction },
});
const notFound: SummaryFetch = { kind: 'not_found' };
const state = (
  blizzardGuildId: number | null,
  blizzardNotFoundSince: Date | null = null,
) => ({ blizzardGuildId, blizzardNotFoundSince });
const ago = (ms: number): Date => new Date(NOW.getTime() - ms);

describe('summaryPatch — 200', () => {
  it('first 200 writes id, founded, faction, ok and clears since', () => {
    expect(summaryPatch(state(null), found(42), NOW)).toEqual({
      mismatch: false,
      patch: {
        blizzardGuildId: 42,
        foundedAt: FOUNDED,
        faction: 'Horde',
        blizzardSummaryStatus: 'ok',
        blizzardNotFoundSince: null,
      },
    });
  });

  it('a null faction leaves the LedgerLink faction alone', () => {
    const { patch } = summaryPatch(state(42), found(42, null), NOW);
    expect(patch).not.toHaveProperty('faction');
    expect(patch.blizzardSummaryStatus).toBe('ok');
  });

  it('a null mapped id keeps the stored id (not a mismatch)', () => {
    const res = summaryPatch(state(42), found(null), NOW);
    expect(res.mismatch).toBe(false);
    expect(res.patch.blizzardGuildId).toBe(42);
  });

  it('a 200 after disbanded clears it to ok with since null', () => {
    const res = summaryPatch(
      state(42, ago(DISBANDED_AFTER_MS * 2)),
      found(42),
      NOW,
    );
    expect(res.patch.blizzardSummaryStatus).toBe('ok');
    expect(res.patch.blizzardNotFoundSince).toBeNull();
  });

  it('an id change writes only status error and flags a mismatch', () => {
    expect(summaryPatch(state(42), found(99), NOW)).toEqual({
      mismatch: true,
      patch: { blizzardSummaryStatus: 'error' },
    });
  });
});

describe('summaryPatch — 404 two-strike', () => {
  it('a never-200 slug is not_found and nothing else', () => {
    expect(summaryPatch(state(null), notFound, NOW).patch).toEqual({
      blizzardSummaryStatus: 'not_found',
    });
  });

  it('the first 404 after a 200 stamps since = now', () => {
    expect(summaryPatch(state(42), notFound, NOW).patch).toEqual({
      blizzardSummaryStatus: 'not_found',
      blizzardNotFoundSince: NOW,
    });
  });

  it('a second 404 under 6h stays not_found and keeps since', () => {
    const patch = summaryPatch(
      state(42, ago(DISBANDED_AFTER_MS - 1)),
      notFound,
      NOW,
    ).patch;
    expect(patch).toEqual({ blizzardSummaryStatus: 'not_found' });
  });

  it('a second 404 at exactly 6h is disbanded', () => {
    const patch = summaryPatch(
      state(42, ago(DISBANDED_AFTER_MS)),
      notFound,
      NOW,
    ).patch;
    expect(patch).toEqual({ blizzardSummaryStatus: 'disbanded' });
  });

  it('DISBANDED_AFTER_MS is six hours', () => {
    expect(DISBANDED_AFTER_MS).toBe(6 * 60 * 60 * 1000);
  });
});
