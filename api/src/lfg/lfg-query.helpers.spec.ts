/**
 * ROK-1451 — unit coverage for the pure derived-state / viability helpers.
 *
 * TDD spec written BEFORE the implementation, so these imports do not resolve
 * yet. They pin the contract the spec's "LFG vs LFM is DERIVED" rule needs:
 *
 *   `./lfg.constants`     → LFG_EXPIRY_DAYS, LFG_STATUSES, LFG_VISIBILITIES,
 *                           computeExpiresAt(from?)
 *   `./lfg-query.helpers` → deriveLfgState(activeCount)
 *                           deriveViability(activeCount, threshold)
 */
import {
  LFG_EXPIRY_DAYS,
  LFG_STATUSES,
  LFG_VISIBILITIES,
  computeExpiresAt,
} from './lfg.constants';
import { deriveLfgState, deriveViability } from './lfg-query.helpers';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('deriveLfgState', () => {
  it.each([
    [0, null],
    [1, 'lfg'],
    [2, 'lfm'],
    [3, 'lfm'],
    [17, 'lfm'],
  ])('maps an active count of %i to %s', (count, expected) => {
    expect(deriveLfgState(count)).toBe(expected);
  });
});

describe('deriveViability', () => {
  it('is false when the game has no Co-Optimus threshold, however big the group', () => {
    expect(deriveViability(0, null)).toBe(false);
    expect(deriveViability(1, null)).toBe(false);
    expect(deriveViability(99, null)).toBe(false);
  });

  it.each([
    [1, 4, false],
    [3, 4, false],
    [4, 4, true],
    [9, 4, true],
  ])(
    'with %i active and a threshold of %i reports isViable=%s',
    (count, threshold, expected) => {
      expect(deriveViability(count, threshold)).toBe(expected);
    },
  );

  it('is not viable at zero active intents even when the threshold is zero', () => {
    expect(deriveViability(0, 0)).toBe(false);
  });
});

describe('expiry constant', () => {
  it('is a single global 14-day horizon', () => {
    expect(LFG_EXPIRY_DAYS).toBe(14);
  });

  it('computes an expiry exactly LFG_EXPIRY_DAYS after the supplied instant', () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    expect(computeExpiresAt(from).toISOString()).toBe(
      new Date(from.getTime() + LFG_EXPIRY_DAYS * DAY_MS).toISOString(),
    );
  });

  it('defaults to now when no instant is supplied', () => {
    const delta = computeExpiresAt().getTime() - Date.now();
    expect(delta / DAY_MS).toBeGreaterThan(LFG_EXPIRY_DAYS - 0.01);
    expect(delta / DAY_MS).toBeLessThanOrEqual(LFG_EXPIRY_DAYS);
  });
});

describe('status + visibility unions', () => {
  it('enumerates exactly the four intent statuses the CHECK constraint allows', () => {
    expect([...LFG_STATUSES].sort()).toEqual([
      'active',
      'cleared',
      'converted',
      'expired',
    ]);
  });

  it('ships the cross-community visibility seam alongside local', () => {
    expect([...LFG_VISIBILITIES].sort()).toEqual(['cross-community', 'local']);
  });
});
