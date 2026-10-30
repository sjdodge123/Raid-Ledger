import { describe, it, expect, vi } from 'vitest';
import { GUILD_CREST_MAX_EDGE } from '@raid-ledger/contract';
import { shrinkCrestForUpload } from './crest-upload-shrink';

const png = new File(['abc'], 'crest.png', { type: 'image/png' });
const jpeg = new File(['abc'], 'photo.jpeg', { type: 'image/jpeg' });
const big = async (): Promise<{ width: number; height: number }> => ({ width: 3000, height: 2000 });

describe('shrinkCrestForUpload', () => {
    it('leaves a small image untouched', async () => {
        const encode = vi.fn();
        const out = await shrinkCrestForUpload(png, { measure: async () => ({ width: 512, height: 512 }), encode });
        expect(out).toBe(png);
        expect(encode).not.toHaveBeenCalled();
    });

    it('re-encodes an opaque JPEG over 1024 px as JPEG at the max edge', async () => {
        const encode = vi.fn(async () => new Blob(['z'], { type: 'image/jpeg' }));
        const out = await shrinkCrestForUpload(jpeg, { measure: big, encode });
        expect(encode).toHaveBeenCalledWith(jpeg, GUILD_CREST_MAX_EDGE, 0.92, 'image/jpeg');
        expect(out.name).toBe('photo.jpg');
        expect(out.type).toBe('image/jpeg');
    });

    it('keeps transparency: a PNG is re-encoded as WebP, never JPEG', async () => {
        const encode = vi.fn(async () => new Blob(['z'], { type: 'image/webp' }));
        const out = await shrinkCrestForUpload(png, { measure: big, encode });
        expect(encode).toHaveBeenCalledWith(png, GUILD_CREST_MAX_EDGE, 0.92, 'image/webp');
        expect(encode).not.toHaveBeenCalledWith(png, GUILD_CREST_MAX_EDGE, expect.any(Number), 'image/jpeg');
        expect(out.name).toBe('crest.webp');
        expect(out.type).toBe('image/webp');
    });

    it('names the file after what the browser produced (no WebP encoder → PNG)', async () => {
        const encode = vi.fn(async () => new Blob(['z'], { type: 'image/png' }));
        const out = await shrinkCrestForUpload(png, { measure: big, encode });
        expect(out.name).toBe('crest.png');
        expect(out.type).toBe('image/png');
    });

    it('sends the original when the browser cannot decode it', async () => {
        const out = await shrinkCrestForUpload(png, { measure: async () => null, encode: vi.fn() });
        expect(out).toBe(png);
    });
});
