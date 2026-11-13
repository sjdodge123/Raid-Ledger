import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetchApi = vi.fn();

vi.mock('./fetch-api', () => ({
    fetchApi: (...args: unknown[]) => mockFetchApi(...args),
}));
vi.mock('../config', () => ({ API_BASE_URL: 'http://api.test' }));

import { getGgYear } from './gg-api';

const MASCOT = {
    emojiName: 'wololo',
    imageUrl: '/uploads/gg-mascot/123-webp?v=abc',
    soundUrl: '/uploads/gg-mascot/456-ogg?v=def',
    volume: 0.8,
};

describe('getGgYear mascot URLs (ROK-2187)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('prefixes the API-relative mascot image and sound with API_BASE_URL', async () => {
        mockFetchApi.mockResolvedValue({ year: 2026, mascot: MASCOT });
        const out = await getGgYear(2026);
        expect(out.mascot?.imageUrl).toBe('http://api.test/uploads/gg-mascot/123-webp?v=abc');
        expect(out.mascot?.soundUrl).toBe('http://api.test/uploads/gg-mascot/456-ogg?v=def');
        expect(out.mascot?.volume).toBe(0.8);
    });

    it('keeps a null sound null', async () => {
        mockFetchApi.mockResolvedValue({ year: 2026, mascot: { ...MASCOT, soundUrl: null } });
        const out = await getGgYear(2026);
        expect(out.mascot?.soundUrl).toBeNull();
        expect(out.mascot?.imageUrl).toBe('http://api.test/uploads/gg-mascot/123-webp?v=abc');
    });

    it('leaves a missing or null mascot alone', async () => {
        mockFetchApi.mockResolvedValue({ year: 2026, mascot: null });
        expect((await getGgYear(2026)).mascot).toBeNull();
        mockFetchApi.mockResolvedValue({ year: 2026 });
        expect((await getGgYear(2026)).mascot).toBeUndefined();
    });

    it('does not double-prefix an already absolute URL', async () => {
        const abs = { ...MASCOT, imageUrl: 'http://api.test/uploads/gg-mascot/123-webp' };
        mockFetchApi.mockResolvedValue({ year: 2026, mascot: abs });
        expect((await getGgYear(2026)).mascot?.imageUrl).toBe('http://api.test/uploads/gg-mascot/123-webp');
    });
});
