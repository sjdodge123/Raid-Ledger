/**
 * Failing-first unit tests for the fit-category precedence rule (ROK-1401).
 *
 * ── The seam this spec PRESCRIBES ────────────────────────────────────
 * `computeFitCategory` is currently a module-private, DB-bound function in
 * `lineups-matching.helpers.ts` (it SELECTs the game row itself), so its
 * precedence logic cannot be unit-tested. ROK-1401 requires the dev to split
 * the pure classification out and EXPORT it:
 *
 *   export function classifyFit(
 *     bounds: {
 *       cooptimusOnlineMax: number | null;
 *       playerCount: { min: number; max: number } | null;
 *     },
 *     voterCount: number,
 *   ): FitCategory
 *
 * `computeFitCategory` stays as the thin DB wrapper — it SELECTs
 * `{ playerCount, cooptimusOnlineMax }` and delegates to `classifyFit`.
 * Until that export exists this file fails at compile time
 * (fails-by-construction: TS2305 "has no exported member 'classifyFit'").
 *
 * ── The rule under test (spec §"Operator decisions", rule 2) ─────────
 * This is the CAPACITY concern, NOT the co-op-claim concern. It follows the
 * same precedence as the exported `resolvePlayerCap`
 * (`lineups-match-response.helpers.ts`), which `classifyFit` MUST reuse
 * rather than re-implement:
 *
 *   max = resolvePlayerCap(cooptimusOnlineMax, playerCount?.max ?? null)
 *         → positive cooptimus WINS
 *         → cooptimus 0 is a co-op-capability claim, not a capacity of zero,
 *           so it falls THROUGH to IGDB player_count.max
 *         → cooptimus NULL (never synced) falls THROUGH to IGDB
 *   min = playerCount?.min  (always IGDB — Co-Optimus publishes no minimum)
 *
 * Do NOT conflate this with rule 1 (the "✓ fits N" / "⚠ N-player co-op"
 * badges), which is Co-Optimus-positive-ONLY and never consults IGDB. Two
 * rules, two concerns — see `web/src/components/lineups/coop-fit.ts`.
 */
import { classifyFit, type FitCategory } from './lineups-matching.helpers';

/** Convenience: build the bounds argument with explicit nulls. */
function bounds(
  cooptimusOnlineMax: number | null,
  playerCount: { min: number; max: number } | null,
) {
  return { cooptimusOnlineMax, playerCount };
}

describe('classifyFit — Co-Optimus vs IGDB capacity precedence (ROK-1401)', () => {
  describe('positive cooptimus_online_max WINS over IGDB player_count.max', () => {
    it('oversubscribes against the cooptimus cap even when IGDB says the lobby is huge', () => {
      // The canonical regression guard. IGDB max 100 is a LOBBY size (PUBG
      // et al); Co-Optimus says 4 players can actually co-op. 8 voters must
      // read as oversubscribed. If the IGDB max leaked through, this would
      // be 'perfect'.
      const result: FitCategory = classifyFit(
        bounds(4, { min: 1, max: 100 }),
        8,
      );
      expect(result).toBe('oversubscribed');
    });

    it('is perfect when the voter count fits inside the cooptimus cap', () => {
      expect(classifyFit(bounds(8, { min: 2, max: 100 }), 6)).toBe('perfect');
    });

    it('is perfect at exactly the cooptimus cap (boundary, not over)', () => {
      expect(classifyFit(bounds(4, { min: 1, max: 100 }), 4)).toBe('perfect');
    });

    it('still takes `min` from IGDB when cooptimus supplies the max', () => {
      // min stays IGDB — Co-Optimus publishes no minimum. 2 voters against
      // an IGDB min of 4 is undersubscribed even though 2 <= cooptimus 8.
      expect(classifyFit(bounds(8, { min: 4, max: 100 }), 2)).toBe(
        'undersubscribed',
      );
    });

    it('uses the cooptimus cap as the only bound when IGDB player_count is null', () => {
      // A known max IS a usable bound: 6 > 4 ⇒ oversubscribed.
      expect(classifyFit(bounds(4, null), 6)).toBe('oversubscribed');
    });

    it('is perfect when only the cooptimus cap is known and the group fits', () => {
      // max known and satisfied, min unknown ⇒ nothing to under-shoot.
      expect(classifyFit(bounds(4, null), 2)).toBe('perfect');
    });
  });

  describe('cooptimus_online_max = 0 falls THROUGH to IGDB', () => {
    it('does not treat a synced zero as a capacity of zero', () => {
      // 0 means "Co-Optimus was asked and this game has no online co-op" —
      // a capability claim, not a cap. If 0 were used as the max, 8 voters
      // would be oversubscribed. It must fall through to IGDB max 10.
      expect(classifyFit(bounds(0, { min: 2, max: 10 }), 8)).toBe('perfect');
    });

    it('oversubscribes against the IGDB max when cooptimus is 0', () => {
      expect(classifyFit(bounds(0, { min: 2, max: 4 }), 9)).toBe(
        'oversubscribed',
      );
    });

    it('undersubscribes against the IGDB min when cooptimus is 0', () => {
      expect(classifyFit(bounds(0, { min: 5, max: 10 }), 2)).toBe(
        'undersubscribed',
      );
    });

    it("is 'normal' when cooptimus is 0 and IGDB has no player_count", () => {
      // Zero is not a usable bound and there is nothing to fall through to.
      expect(classifyFit(bounds(0, null), 5)).toBe('normal');
    });
  });

  describe('cooptimus_online_max = NULL falls THROUGH to IGDB (unchanged legacy path)', () => {
    it('oversubscribes against the IGDB max', () => {
      expect(classifyFit(bounds(null, { min: 2, max: 4 }), 9)).toBe(
        'oversubscribed',
      );
    });

    it('undersubscribes against the IGDB min', () => {
      expect(classifyFit(bounds(null, { min: 5, max: 10 }), 3)).toBe(
        'undersubscribed',
      );
    });

    it('is perfect inside the IGDB band', () => {
      expect(classifyFit(bounds(null, { min: 2, max: 10 }), 6)).toBe('perfect');
    });

    it('is perfect at both IGDB boundaries', () => {
      expect(classifyFit(bounds(null, { min: 2, max: 10 }), 2)).toBe('perfect');
      expect(classifyFit(bounds(null, { min: 2, max: 10 }), 10)).toBe(
        'perfect',
      );
    });
  });

  describe("both sources absent ⇒ 'normal'", () => {
    it("returns 'normal' when cooptimus is NULL and player_count is null", () => {
      expect(classifyFit(bounds(null, null), 7)).toBe('normal');
    });

    it("returns 'normal' regardless of voter count when no bounds exist", () => {
      expect(classifyFit(bounds(null, null), 0)).toBe('normal');
      expect(classifyFit(bounds(null, null), 999)).toBe('normal');
    });
  });

  describe('negative / defensive cooptimus values fall through (never a cap)', () => {
    it('treats a negative cooptimus value like absent data', () => {
      // resolvePlayerCap only accepts `> 0`; anything else defers to IGDB.
      expect(classifyFit(bounds(-1, { min: 2, max: 10 }), 8)).toBe('perfect');
    });
  });
});
