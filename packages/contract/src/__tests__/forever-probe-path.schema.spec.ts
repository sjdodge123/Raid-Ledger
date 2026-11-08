import { describe, expect, it } from 'vitest';
import {
    FOREVER_PROBE_PATH_RE,
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
});
