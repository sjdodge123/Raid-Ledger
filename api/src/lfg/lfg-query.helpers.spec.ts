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
import {
  DEFAULT_VIABILITY_THRESHOLD,
  effectiveViabilityThreshold,
  playersStillNeeded,
} from '@raid-ledger/contract';
import {
  deriveLfgState,
  deriveViability,
  listGroupMembers,
  toGroupSummary,
  type LfgDb,
  type LfgGroupAggregate,
} from './lfg-query.helpers';
import { createDrizzleMock } from '../common/testing/drizzle-mock';
import { LFG_URGENCIES } from './lfg.constants';

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

  // ROK-1532 — `cooptimus_online_max` is 0 for a game with no Co-Optimus
  // co-op entry (the sync's `markNoEntry` marker, which is what PEAK stores)
  // and can be 1 for a matched one. Read literally either made a group of ONE
  // "viable", so the page printed "You have a full group" under
  // "one more makes it a group". The floor is shared with the copy helper.
  it.each([
    [1, 0],
    [1, 1],
    [1, 2],
  ])(
    'refuses to call a group of %i viable against a stored threshold of %i',
    (count, threshold) => {
      expect(deriveViability(count, threshold)).toBe(false);
    },
  );

  it('is viable at two even when the stored threshold is below the floor', () => {
    expect(deriveViability(2, 0)).toBe(true);
    expect(deriveViability(2, 1)).toBe(true);
  });

  it('floors the threshold at the shared default, never below it', () => {
    expect(effectiveViabilityThreshold(0)).toBe(DEFAULT_VIABILITY_THRESHOLD);
    expect(effectiveViabilityThreshold(1)).toBe(DEFAULT_VIABILITY_THRESHOLD);
    expect(effectiveViabilityThreshold(null)).toBe(DEFAULT_VIABILITY_THRESHOLD);
    expect(effectiveViabilityThreshold(4)).toBe(4);
  });

  it('never tells a lone player they need zero more (copy/banner parity)', () => {
    expect(playersStillNeeded(1, 0)).toBe(1);
    expect(playersStillNeeded(1, 1)).toBe(1);
    expect(playersStillNeeded(1, null)).toBe(1);
    // The contradiction ROK-1532 reported, pinned as ONE assertion: whenever
    // the copy still asks for more players the banner must stay away.
    for (const threshold of [0, 1, 2, 4]) {
      const active = 1;
      const stillNeeded = playersStillNeeded(active, threshold);
      expect(deriveViability(active, threshold)).toBe(stillNeeded === 0);
    }
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

describe('urgency union', () => {
  it('enumerates exactly the two urgency classes the CHECK constraint allows', () => {
    expect([...LFG_URGENCIES].sort()).toEqual(['now', 'week']);
  });
});

/**
 * ROK-1479 — `activeCount` deliberately keeps counting BOTH classes, so every
 * pre-1479 consumer (chip copy, LFM threshold, embeds) stays true. `nowCount`
 * is an ADDITIONAL projection, never a split of the existing one.
 */
describe('toGroupSummary — now projections', () => {
  const aggregate: LfgGroupAggregate = {
    gameId: 22,
    gameName: 'Deep Rock Galactic',
    gameSlug: 'deep-rock-galactic',
    gameCoverUrl: null,
    viabilityThreshold: 4,
    activeCount: 3,
    soonestExpiresAt: new Date('2026-09-19T00:00:00.000Z'),
    hasOwnIntent: true,
    nowCount: 1,
    soonestNowExpiresAt: new Date('2026-09-05T12:30:00.000Z'),
  };

  it('projects nowCount and the soonest now-expiry as an ISO string', () => {
    const dto = toGroupSummary(aggregate);
    expect(dto.nowCount).toBe(1);
    expect(dto.soonestNowExpiresAt).toBe('2026-09-05T12:30:00.000Z');
  });

  it('keeps activeCount counting BOTH classes, not just the weekly ones', () => {
    expect(toGroupSummary(aggregate).activeCount).toBe(3);
  });

  it('reports a null soonest now-expiry for a group with nobody looking now', () => {
    const dto = toGroupSummary({
      ...aggregate,
      nowCount: 0,
      soonestNowExpiresAt: null,
    });
    expect(dto.nowCount).toBe(0);
    expect(dto.soonestNowExpiresAt).toBeNull();
  });
});

describe('listGroupMembers — per-member urgency', () => {
  it("projects each member's stored urgency onto the wire DTO", async () => {
    const mockDb = createDrizzleMock();
    mockDb.orderBy.mockResolvedValue([
      {
        userId: 1,
        username: 'kestrel',
        displayName: 'Kestrel',
        avatar: null,
        customAvatarUrl: null,
        urgency: 'now',
        expiresAt: new Date('2026-09-05T12:30:00.000Z'),
        joinedAt: new Date('2026-09-05T12:00:00.000Z'),
      },
      {
        userId: 2,
        username: 'wren',
        displayName: 'Wren',
        avatar: null,
        customAvatarUrl: null,
        urgency: 'week',
        expiresAt: new Date('2026-09-19T00:00:00.000Z'),
        joinedAt: new Date('2026-09-04T12:00:00.000Z'),
      },
    ]);
    const members = await listGroupMembers(mockDb as unknown as LfgDb, 22);
    expect(members.map((m) => m.urgency)).toEqual(['now', 'week']);
  });
});
