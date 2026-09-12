/**
 * Read-path dimensions normaliser (ROK-1102 item 5, decision D8).
 *
 * Between the API deploy and the forced backfill completing, stored
 * `dimensions` jsonb has the OLD pool shape while the contract demands the
 * new one — and `web/src/lib/api/games-api.ts` parses responses with the
 * Zod schema, so a missing key is a thrown error in the browser.
 * `normalizeDimensions` closes that window for `fps` and for every future
 * pool addition.
 */
import {
  TASTE_PROFILE_AXIS_POOL,
  TasteProfileDimensionsSchema,
} from '@raid-ledger/contract';
import { normalizeDimensions } from './dimensions.helpers';

/** A stored row written before the axis was appended: every key but the last. */
function legacyDimensions(): Record<string, number> {
  const dims: Record<string, number> = {};
  for (const axis of TASTE_PROFILE_AXIS_POOL.slice(0, -1)) dims[axis] = 10;
  return dims;
}

describe('normalizeDimensions (ROK-1102 #5 D8)', () => {
  const newestAxis =
    TASTE_PROFILE_AXIS_POOL[TASTE_PROFILE_AXIS_POOL.length - 1];

  it('fills the pool axis missing from a legacy row with 0', () => {
    const normalized = normalizeDimensions(legacyDimensions());
    expect(normalized[newestAxis]).toBe(0);
  });

  it('returns exactly one key per pool axis', () => {
    const normalized = normalizeDimensions(legacyDimensions());
    expect(Object.keys(normalized).sort()).toEqual(
      [...TASTE_PROFILE_AXIS_POOL].sort(),
    );
  });

  it('produces a payload the contract schema accepts', () => {
    expect(() =>
      TasteProfileDimensionsSchema.parse(
        normalizeDimensions(legacyDimensions()),
      ),
    ).not.toThrow();
  });

  it('preserves stored values rather than zeroing them', () => {
    const normalized = normalizeDimensions({
      ...legacyDimensions(),
      co_op: 73,
    });
    expect(normalized.co_op).toBe(73);
  });

  it('drops keys that are no longer in the pool', () => {
    const normalized = normalizeDimensions({
      ...legacyDimensions(),
      retired_axis: 55,
    });
    expect(normalized).not.toHaveProperty('retired_axis');
  });

  it('coerces a non-numeric or absent value to 0', () => {
    const normalized = normalizeDimensions({ co_op: null, pvp: 'nope' });
    expect(normalized.co_op).toBe(0);
    expect(normalized.pvp).toBe(0);
  });

  it('returns an all-zero profile for a null/undefined row', () => {
    const normalized = normalizeDimensions(null);
    expect(Object.values(normalized).every((v) => v === 0)).toBe(true);
    expect(Object.keys(normalized)).toHaveLength(
      TASTE_PROFILE_AXIS_POOL.length,
    );
  });
});
