/** ROK-1875 — the `/hubs` URL <-> params mapping for the Kind filter. */
import { describe, expect, it } from 'vitest';
import { directoryActiveCount, readDirectoryParams, writeDirectoryParams } from './use-hubs-directory';

const read = (qs: string) => readDirectoryParams(new URLSearchParams(qs));

describe('directory URL kind slugs', () => {
    it.each([
        ['server', 'game_server'], ['community', 'game_community'], ['guild', 'wow_guild'],
    ] as const)('?kind=%s reads as %s and writes back to the same slug', (slug, kind) => {
        const params = read(`kind=${slug}`);
        expect(params.kind).toBe(kind);
        expect(writeDirectoryParams(params).toString()).toBe(`kind=${slug}`);
    });

    it('an unknown or raw-enum slug reads as no kind filter', () => {
        expect(read('kind=bogus').kind).toBeUndefined();
        expect(read('kind=game_server').kind).toBeUndefined();
    });

    it('the funnel badge counts the kind filter', () => {
        expect(directoryActiveCount({ membership: 'all', sort: 'members' })).toBe(0);
        expect(directoryActiveCount({ membership: 'joined', sort: 'members', kind: 'wow_guild' })).toBe(2);
    });
});
