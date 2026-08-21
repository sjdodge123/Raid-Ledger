/**
 * Failing-first unit tests for `coopFitLabel` (ROK-1401).
 *
 * ── The contract this spec PRESCRIBES ────────────────────────────────
 * A new export in `web/src/components/lineups/coop-fit.ts`, alongside the
 * existing `resolveEffectiveOnlineMax` (ROK-1400):
 *
 *   export function coopFitLabel(
 *     onlineMax: number | null | undefined,
 *     groupSize: number,
 *   ): { fits: boolean; label: string } | null
 *
 * Until that export exists this file fails at compile/import time
 * (fails-by-construction). Both VotingRow and MatchCard must consume THIS
 * helper — the label copy is asserted in exactly one place.
 *
 * ── The rule (spec §"Badge copy", operator decision rule 1) ──────────
 * The badge is a CO-OP CLAIM, so it is Co-Optimus-verified ONLY:
 *   onlineMax > 0 and groupSize > 0  → a badge
 *   onlineMax 0 / null / undefined   → null (never synced, or synced with no
 *                                      online co-op — no badge, no layout
 *                                      hole, no IGDB fallback)
 *   groupSize <= 0                   → null (nothing to evaluate fit against)
 *
 * Copy, verbatim (glyphs included — do not "clean up" to ASCII):
 *   onlineMax >= groupSize → { fits: true,  label: `✓ fits ${groupSize}` }
 *   onlineMax <  groupSize → { fits: false, label: `⚠ ${onlineMax}-player co-op` }
 *
 * Note the asymmetry, and keep it: the FITS label names the GROUP size, the
 * WARNING label names the GAME's cap. That is what makes the warning
 * actionable ("this game only does 4") rather than a restatement.
 *
 * This helper deliberately does NOT consult IGDB `playerCount`. The API's
 * `resolvePlayerCap` / `classifyFit` (ROK-1411 / ROK-1401) do, because they
 * answer the CAPACITY question. Two rules, two concerns — do not unify them.
 */
import { describe, it, expect } from 'vitest';
import { coopFitLabel } from './coop-fit';

describe('coopFitLabel — absent data renders nothing', () => {
    it('returns null for null onlineMax (never synced)', () => {
        expect(coopFitLabel(null, 4)).toBeNull();
    });

    it('returns null for undefined onlineMax (stale cached row missing the field)', () => {
        expect(coopFitLabel(undefined, 4)).toBeNull();
    });

    it('returns null for a synced ZERO (no online co-op)', () => {
        // 0 is real data, but it is not a co-op CLAIM — there is nothing to
        // advertise, so the badge stays off rather than reading "0-player".
        expect(coopFitLabel(0, 4)).toBeNull();
    });

    it('returns null for a negative onlineMax (defensive)', () => {
        expect(coopFitLabel(-1, 4)).toBeNull();
    });
});

describe('coopFitLabel — group size must be evaluable', () => {
    it('returns null when groupSize is 0', () => {
        expect(coopFitLabel(4, 0)).toBeNull();
    });

    it('returns null when groupSize is negative', () => {
        expect(coopFitLabel(4, -2)).toBeNull();
    });

    it('returns null when BOTH inputs are unusable', () => {
        expect(coopFitLabel(null, 0)).toBeNull();
    });
});

describe('coopFitLabel — fits (onlineMax >= groupSize)', () => {
    it('labels a comfortable fit with the GROUP size', () => {
        expect(coopFitLabel(8, 4)).toEqual({ fits: true, label: '✓ fits 4' });
    });

    it('fits at the exact boundary (onlineMax === groupSize)', () => {
        expect(coopFitLabel(4, 4)).toEqual({ fits: true, label: '✓ fits 4' });
    });

    it('fits a solo group', () => {
        expect(coopFitLabel(4, 1)).toEqual({ fits: true, label: '✓ fits 1' });
    });

    it('names the group size, not the game cap, in the fits label', () => {
        // Regression guard against the easy copy/paste slip of interpolating
        // onlineMax on both branches.
        const result = coopFitLabel(64, 12);
        expect(result?.label).toBe('✓ fits 12');
        expect(result?.label).not.toContain('64');
    });
});

describe('coopFitLabel — too small (onlineMax < groupSize)', () => {
    it('warns with the GAME cap when the group overflows it', () => {
        expect(coopFitLabel(4, 5)).toEqual({
            fits: false,
            label: '⚠ 4-player co-op',
        });
    });

    it('warns one over the boundary', () => {
        expect(coopFitLabel(2, 3)).toEqual({
            fits: false,
            label: '⚠ 2-player co-op',
        });
    });

    it('names the game cap, not the group size, in the warning label', () => {
        const result = coopFitLabel(4, 12);
        expect(result?.label).toBe('⚠ 4-player co-op');
        expect(result?.label).not.toContain('12');
    });

    it('flips from fits to warning as the group grows past the cap', () => {
        // The MatchCard bandwagon case, at the helper level.
        expect(coopFitLabel(4, 4)?.fits).toBe(true);
        expect(coopFitLabel(4, 5)?.fits).toBe(false);
    });
});
