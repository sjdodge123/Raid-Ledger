import { describe, expect, it } from 'vitest';
import {
    FOREVER_PROBE_PATH_RE,
    ForeverProbeCellSchema,
    ForeverProbeConfigSchema,
    ForeverProbeEndpointSchema,
    ForeverProbeValuesShapeSchema,
} from '../blizzard.schema.js';

describe('FOREVER_PROBE_PATH_RE (ROK-2102, ROK-2104)', () => {
    it.each([
        'Thrall-Stormborn',
        'Zoë-Ashbringer',
        'Ånäl-Mörkö',
        'dreamscythe/Thrall',
        'crusader-strike/Zoë',
    ])('accepts %s', (path) => {
        expect(FOREVER_PROBE_PATH_RE.test(path)).toBe(true);
    });

    it.each([
        'realm/..',
        'realm/.',
        'a/b/c',
        'name?x=1',
        'name surname',
        'na.me',
        '',
        'a'.repeat(65),
    ])('rejects %s', (path) => {
        expect(FOREVER_PROBE_PATH_RE.test(path)).toBe(false);
    });

    it('parses an accented realmless character path through the config schema', () => {
        const parsed = ForeverProbeConfigSchema.safeParse({
            extraCandidates: [],
            characterPath: ' Zoë-Ashbringer ',
            guildPath: null,
        });
        expect(parsed.success && parsed.data.characterPath).toBe('Zoë-Ashbringer');
    });
});

describe('ROK-2143 quest + item probe endpoints', () => {
    it.each(['quest-index', 'quest-area', 'quest', 'item'])('accepts endpoint %s', (e) => {
        expect(ForeverProbeEndpointSchema.safeParse(e).success).toBe(true);
    });

    it('parses a flattened values shape', () => {
        const shape = {
            topLevelKeys: ['id', 'rewards'],
            entryCount: 3,
            values: { id: 378, 'rewards.items[0].item.name': 'Belt', 'is_daily': false, 'area': null },
        };
        expect(ForeverProbeValuesShapeSchema.parse(shape)).toEqual(shape);
    });

    it('rejects a values shape with a nested object value or a negative count', () => {
        const base = { topLevelKeys: [], entryCount: 0, values: {} };
        expect(ForeverProbeValuesShapeSchema.safeParse({ ...base, values: { a: { b: 1 } } }).success).toBe(false);
        expect(ForeverProbeValuesShapeSchema.safeParse({ ...base, entryCount: -1 }).success).toBe(false);
    });

    it('rejects a value string over 200 chars', () => {
        const shape = { topLevelKeys: [], entryCount: 1, values: { a: 'x'.repeat(201) } };
        expect(ForeverProbeValuesShapeSchema.safeParse(shape).success).toBe(false);
    });

    it('caps a values shape at 120 entries', () => {
        const entries = (n: number): Record<string, number> =>
            Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, i]));
        const shape = (n: number) => ({ topLevelKeys: [], entryCount: n, values: entries(n) });
        expect(ForeverProbeValuesShapeSchema.safeParse(shape(120)).success).toBe(true);
        expect(ForeverProbeValuesShapeSchema.safeParse(shape(121)).success).toBe(false);
    });

    it('keeps an optional truncated flag on a values shape', () => {
        const shape = { topLevelKeys: ['a'], entryCount: 2, values: { a: 1 }, truncated: true };
        expect(ForeverProbeValuesShapeSchema.parse(shape)).toEqual(shape);
    });

    it('keeps an optional per-id target on a cell; cells without one still parse', () => {
        const cell = { prefix: 'forever', region: 'us', endpoint: 'quest', status: 200 };
        expect(ForeverProbeCellSchema.parse({ ...cell, target: 'quest:378' })).toEqual({ ...cell, target: 'quest:378' });
        expect(ForeverProbeCellSchema.parse(cell)).toEqual(cell);
    });
});
