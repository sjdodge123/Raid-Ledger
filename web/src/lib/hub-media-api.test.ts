import { describe, it, expect } from 'vitest';
import { hubMediaListPath } from './hub-media-api';

describe('hubMediaListPath (ROK-2027 subject)', () => {
    it('sends an encoded subject and no kind when a subject scopes the list', () => {
        const path = hubMediaListPath(7, { filter: 'all', limit: 24, subject: 'valheim-death:c42' });
        expect(path).toBe('/hubs/7/media?limit=24&subject=valheim-death%3Ac42');
    });

    it('keeps the cursor alongside the subject', () => {
        const path = hubMediaListPath(7, { filter: 'all', limit: 24, cursor: 'abc', subject: 'valheim-death:n Bob' });
        const params = new URL(path, 'http://x').searchParams;
        expect(params.get('subject')).toBe('valheim-death:n Bob');
        expect(params.get('cursor')).toBe('abc');
        expect(params.has('kind')).toBe(false);
    });

    it('is unchanged without a subject', () => {
        expect(hubMediaListPath(7, { filter: 'death', limit: 24 })).toBe('/hubs/7/media?limit=24&kind=death');
        expect(hubMediaListPath(7, { filter: 'all', limit: 6 })).toBe('/hubs/7/media?limit=6');
    });
});
