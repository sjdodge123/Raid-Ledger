/** ROK-1965 — the upload's pure parts: browser pre-shrink above the cap, response parsing, error copy. */
import { describe, expect, it, vi } from 'vitest';
import { HUB_MEDIA_UPLOAD_ERROR_CODES, HUB_MEDIA_UPLOAD_MAX_BYTES, HUB_MEDIA_UPLOAD_TYPES } from '@raid-ledger/contract';
import { hubMediaItem } from '../test/mocks/hub-media-handlers';
import { shrinkForUpload, SHRINK_MAX_EDGE, type JpegEncoder } from './hub-media-shrink';
import { settle } from './hub-media-upload-api';
import {
    HUB_MEDIA_UPLOAD_ACCEPT, HUB_MEDIA_UPLOAD_ERROR_COPY, HUB_MEDIA_UPLOAD_FALLBACK, HubMediaUploadError, hubMediaUploadErrorCopy,
} from './hub-media-upload-copy';

/** A picked file reporting `size` bytes without allocating them. */
function picked(name: string, size: number, type = 'image/png'): File {
    const file = new File([new Uint8Array(4)], name, { type });
    Object.defineProperty(file, 'size', { value: size });
    return file;
}
const blobOf = (size: number): Blob => {
    const blob = new Blob([new Uint8Array(4)], { type: 'image/jpeg' });
    Object.defineProperty(blob, 'size', { value: size });
    return blob;
};

describe('shrinkForUpload (ruling 5)', () => {
    it('sends a file at or under the cap untouched — the encoder is never called', async () => {
        const encode = vi.fn<JpegEncoder>();
        const file = picked('ok.png', HUB_MEDIA_UPLOAD_MAX_BYTES);
        expect(await shrinkForUpload(file, encode)).toBe(file);
        expect(encode).not.toHaveBeenCalled();
    });

    it('re-encodes a file over the cap as JPEG within 4096px at q0.92', async () => {
        const encode = vi.fn<JpegEncoder>().mockResolvedValue(blobOf(2_000_000));
        const out = await shrinkForUpload(picked('huge.png', HUB_MEDIA_UPLOAD_MAX_BYTES + 1), encode);
        expect(encode).toHaveBeenCalledTimes(1);
        expect(encode.mock.calls[0]?.slice(1)).toEqual([SHRINK_MAX_EDGE, 0.92]);
        expect({ name: out.name, type: out.type }).toEqual({ name: 'huge.jpg', type: 'image/jpeg' });
    });

    it('tries q0.8 when q0.92 is still over the cap', async () => {
        const encode = vi.fn<JpegEncoder>()
            .mockResolvedValueOnce(blobOf(HUB_MEDIA_UPLOAD_MAX_BYTES + 5)).mockResolvedValueOnce(blobOf(10));
        const out = await shrinkForUpload(picked('noisy.webp', HUB_MEDIA_UPLOAD_MAX_BYTES * 2), encode);
        expect(encode.mock.calls.map((c) => c[2])).toEqual([0.92, 0.8]);
        expect(out.type).toBe('image/jpeg');
    });

    it('sends the original when the browser cannot decode it (the server answers 415)', async () => {
        const file = picked('weird.heic', HUB_MEDIA_UPLOAD_MAX_BYTES + 1, 'image/heic');
        expect(await shrinkForUpload(file, vi.fn<JpegEncoder>().mockResolvedValue(null))).toBe(file);
        expect(await shrinkForUpload(file, vi.fn<JpegEncoder>().mockRejectedValue(new Error('decode')))).toBe(file);
    });
});

describe('settle — the POST response', () => {
    it('201 is a new picture, 200 the one already in the gallery', () => {
        const item = hubMediaItem(7, 'upload', { canRemove: true });
        expect(settle(201, JSON.stringify(item))).toEqual({ item, duplicate: false });
        expect(settle(200, JSON.stringify(item)).duplicate).toBe(true);
    });

    it.each(HUB_MEDIA_UPLOAD_ERROR_CODES)('an error body with code %s maps to its plain copy', (code) => {
        let caught: unknown = null;
        try { settle(413, JSON.stringify({ statusCode: 413, code, message: 'x' })); } catch (err) { caught = err; }
        expect(caught).toBeInstanceOf(HubMediaUploadError);
        expect(hubMediaUploadErrorCopy(caught)).toBe(HUB_MEDIA_UPLOAD_ERROR_COPY[code]);
    });

    it('a code-less 413 (nginx) reads as too big; 400 asks for a picture; anything else falls back', () => {
        const copy = (status: number, body: string): string => {
            try { settle(status, body); } catch (err) { return hubMediaUploadErrorCopy(err); }
            return 'resolved';
        };
        expect(copy(413, '<html>413</html>')).toBe(HUB_MEDIA_UPLOAD_ERROR_COPY.too_large);
        expect(copy(400, '{"statusCode":400,"message":"No file"}')).toBe('Choose a picture to upload.');
        expect(copy(404, '{"statusCode":404,"code":"nope"}')).toBe(HUB_MEDIA_UPLOAD_FALLBACK);
        expect(hubMediaUploadErrorCopy(new Error('network'))).toBe(HUB_MEDIA_UPLOAD_FALLBACK);
    });
});

it('the picker accept list mirrors HUB_MEDIA_UPLOAD_TYPES', () => {
    expect(HUB_MEDIA_UPLOAD_ACCEPT).toBe(HUB_MEDIA_UPLOAD_TYPES.join(','));
});
