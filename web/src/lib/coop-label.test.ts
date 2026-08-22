/**
 * Unit tests for the shared co-op label helper (ROK-1401 round 3).
 *
 * This is the single source of the three labels every co-op surface renders,
 * so the priority order and the thresholds are pinned here rather than in
 * each component spec.
 */
import { describe, it, expect } from 'vitest';
import { coopLabel, coopAriaLabel } from './coop-label';

describe('coopLabel — priority: combo beats online beats local', () => {
    it('labels a combo game "combo co-op" even when both counts qualify', () => {
        expect(coopLabel({ online: 5, couch: 4, combo: true })).toEqual({
            count: 5,
            kind: 'combo',
            label: '👥 5 combo co-op',
        });
    });

    it('labels a combo game "combo co-op" even with only an online count', () => {
        // combo is Co-Optimus's own flag, not something we derive from the
        // two counts — it wins whatever the counts say.
        expect(coopLabel({ online: 5, couch: null, combo: true })?.kind).toBe(
            'combo',
        );
    });

    it('labels a combo game "combo co-op" even with only a couch count', () => {
        expect(coopLabel({ online: null, couch: 4, combo: true })).toEqual({
            count: 4,
            kind: 'combo',
            label: '👥 4 combo co-op',
        });
    });

    it('falls to "online co-op" when the combo flag is false', () => {
        expect(coopLabel({ online: 5, couch: 4, combo: false })).toEqual({
            count: 5,
            kind: 'online',
            label: '👥 5 online co-op',
        });
    });

    it('falls to "online co-op" when the combo flag is absent', () => {
        expect(coopLabel({ online: 5, couch: 4 })?.kind).toBe('online');
    });

    it('prefers the ONLINE count over the couch count for online games', () => {
        const r = coopLabel({ online: 5, couch: 4 });
        expect(r?.count).toBe(5);
        expect(r?.label).not.toContain('4');
    });

    it('labels a couch-only game "local co-op" with the couch count', () => {
        expect(coopLabel({ online: null, couch: 2 })).toEqual({
            count: 2,
            kind: 'local',
            label: '👥 2 local co-op',
        });
    });

    it('treats a synced online ZERO as no online claim, so couch wins', () => {
        expect(coopLabel({ online: 0, couch: 4 })?.kind).toBe('local');
    });
});

describe('coopLabel — a combo game with no usable count is label-only', () => {
    it('renders the bare label when both counts are absent', () => {
        expect(coopLabel({ online: null, couch: null, combo: true })).toEqual({
            count: null,
            kind: 'combo',
            label: '👥 combo co-op',
        });
    });

    it('renders the bare label when the counts are a synced zero and a lone couch seat', () => {
        expect(coopLabel({ online: 0, couch: 1, combo: true })).toEqual({
            count: null,
            kind: 'combo',
            label: '👥 combo co-op',
        });
    });
});

describe('coopLabel — thresholds', () => {
    it('counts an online max of 1 as an online claim', () => {
        // Co-Optimus records 1 for co-op-adjacent online modes; still a claim.
        expect(coopLabel({ online: 1, couch: null })?.kind).toBe('online');
    });

    it('does NOT count a couch max of 1 as local co-op', () => {
        // One player on a sofa is single-player, not local co-op.
        expect(coopLabel({ online: null, couch: 1 })).toBeNull();
    });

    it('counts a couch max of exactly 2 as local co-op (boundary)', () => {
        expect(coopLabel({ online: null, couch: 2 })?.kind).toBe('local');
    });
});

describe('coopLabel — no claim renders nothing', () => {
    it.each([
        ['both null', { online: null, couch: null }],
        ['both undefined', { online: undefined, couch: undefined }],
        ['synced zeroes', { online: 0, couch: 0 }],
        ['online zero, couch one', { online: 0, couch: 1 }],
        ['negative values', { online: -1, couch: -4 }],
        ['NaN', { online: Number.NaN, couch: Number.NaN }],
        ['combo explicitly false with no counts', { online: 0, couch: 0, combo: false }],
        ['combo null with no counts', { online: null, couch: null, combo: null }],
    ])('returns null for %s', (_name, counts) => {
        expect(coopLabel(counts)).toBeNull();
    });

    it('never consults an IGDB-style lobby size — there is no such input', () => {
        // Regression guard on the SHAPE: the helper takes co-op fields only,
        // so a 100-player PvP lobby cannot leak in through it.
        expect(Object.keys(coopLabel({ online: 4, couch: null })!)).toEqual([
            'count',
            'kind',
            'label',
        ]);
    });
});

describe('coopAriaLabel', () => {
    it('names the count and the kind', () => {
        expect(coopAriaLabel(coopLabel({ online: 5, couch: null })!)).toBe(
            'Co-op: up to 5 players online',
        );
    });

    it('names local co-op with the couch count', () => {
        expect(coopAriaLabel(coopLabel({ online: null, couch: 2 })!)).toBe(
            'Co-op: up to 2 players local',
        );
    });

    it('drops the count for a label-only combo game', () => {
        expect(
            coopAriaLabel(coopLabel({ online: null, couch: null, combo: true })!),
        ).toBe('Co-op: combo');
    });
});
