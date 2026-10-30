import { describe, it, expect, vi } from 'vitest';
import { GUILD_CREST_MAX_EDGE } from '@raid-ledger/contract';
import { shrinkCrestForUpload } from './crest-upload-shrink';

const file = new File(['abc'], 'crest.png', { type: 'image/png' });

describe('shrinkCrestForUpload', () => {
    it('leaves a small image untouched', async () => {
        const encode = vi.fn();
        const out = await shrinkCrestForUpload(file, { measure: async () => ({ width: 512, height: 512 }), encode });
        expect(out).toBe(file);
        expect(encode).not.toHaveBeenCalled();
    });

    it('re-encodes an image over 1024 px to the max edge', async () => {
        const encode = vi.fn(async () => new Blob(['z'], { type: 'image/jpeg' }));
        const out = await shrinkCrestForUpload(file, { measure: async () => ({ width: 3000, height: 2000 }), encode });
        expect(encode).toHaveBeenCalledWith(file, GUILD_CREST_MAX_EDGE, 0.92);
        expect(out.name).toBe('crest.jpg');
        expect(out.type).toBe('image/jpeg');
    });

    it('sends the original when the browser cannot decode it', async () => {
        const out = await shrinkCrestForUpload(file, { measure: async () => null, encode: vi.fn() });
        expect(out).toBe(file);
    });
});
