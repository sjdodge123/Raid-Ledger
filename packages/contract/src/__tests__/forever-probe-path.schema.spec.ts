import { describe, expect, it } from 'vitest';
import { FOREVER_PROBE_PATH_RE, ForeverProbeConfigSchema } from '../blizzard.schema.js';

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
