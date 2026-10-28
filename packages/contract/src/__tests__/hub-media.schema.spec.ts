import { describe, expect, it } from 'vitest';
import {
    HUB_MEDIA_UPLOAD_MAX_BYTES,
    HUB_MEDIA_UPLOAD_TYPES,
    HubMediaItemSchema,
    HubMediaUploadErrorCodeSchema,
    isSafeHubMediaHref,
} from '../hub-media.schema.js';

const item = (href: string) => ({
    id: 1,
    kind: 'death',
    authorName: null,
    caption: null,
    capturedAt: '2026-10-20T12:00:00.000Z',
    width: 10,
    height: 10,
    thumbPath: '/hubs/1/media/1/thumb',
    fullPath: '/hubs/1/media/1/full',
    source: { type: 'discord', label: 'Discord' },
    link: { label: 'On the map', href },
    hidden: false,
    canRemove: false,
});

/** A valid upload item; `over` replaces or adds top-level keys. */
const upload = (over: Record<string, unknown> = {}) => ({
    ...item('/hubs/1/map'),
    kind: 'upload',
    source: { type: 'upload', label: 'Uploaded' },
    link: null,
    canRemove: true,
    ...over,
});

describe('HubMediaItemSchema link.href (ROK-1942)', () => {
    it.each(['/hubs/1/map?pin=2', 'https://example.com/a', 'HTTPS://example.com'])('accepts %s', (href) => {
        expect(isSafeHubMediaHref(href)).toBe(true);
        expect(HubMediaItemSchema.safeParse(item(href)).success).toBe(true);
    });

    it.each([
        'javascript:alert(1)',
        'JavaScript:alert(1)',
        ' javascript:alert(1)',
        'data:text/html,<b>x</b>',
        'http://example.com',
        '//evil.example/x',
        '/\\evil.example/x',
        'hubs/1/map',
        '',
    ])('refuses %s', (href) => {
        expect(isSafeHubMediaHref(href)).toBe(false);
        expect(HubMediaItemSchema.safeParse(item(href)).success).toBe(false);
    });
});

describe('HubMediaItemSchema uploads (ROK-1965)', () => {
    it('accepts kind "upload" from source "upload"', () => {
        const parsed = HubMediaItemSchema.safeParse(upload());
        expect(parsed.error?.issues ?? []).toEqual([]);
        expect(parsed.data?.kind).toBe('upload');
        expect(parsed.data?.source.type).toBe('upload');
    });

    it('still accepts a Discord source', () => {
        const parsed = HubMediaItemSchema.safeParse(upload({ source: { type: 'discord', label: 'Discord' } }));
        expect(parsed.error?.issues ?? []).toEqual([]);
    });

    it('refuses an unknown source type', () => {
        const parsed = HubMediaItemSchema.safeParse(upload({ source: { type: 'email', label: null } }));
        expect(parsed.error?.issues.map((i) => i.path.join('.'))).toEqual(['source.type']);
    });

    it('requires canRemove', () => {
        const { canRemove: _omit, ...rest } = upload();
        const parsed = HubMediaItemSchema.safeParse(rest);
        expect(parsed.error?.issues.map((i) => i.path.join('.'))).toEqual(['canRemove']);
    });

    it('stays strict: an unknown key is refused', () => {
        const parsed = HubMediaItemSchema.safeParse(upload({ uploadedBy: 7 }));
        expect(parsed.error?.issues.map((i) => i.code)).toEqual(['unrecognized_keys']);
    });
});

describe('upload constants (ROK-1965)', () => {
    it('caps a raw upload at 9 MiB, under nginx 10m', () => {
        expect(HUB_MEDIA_UPLOAD_MAX_BYTES).toBe(9 * 1024 * 1024);
    });

    it('offers PNG, JPEG and WebP only (no GIF)', () => {
        expect([...HUB_MEDIA_UPLOAD_TYPES]).toEqual(['image/png', 'image/jpeg', 'image/webp']);
    });

    it('names every upload error code the web maps', () => {
        expect(HubMediaUploadErrorCodeSchema.options).toEqual([
            'not_image',
            'too_large',
            'cap',
            'removed',
            'rate_limited',
            'busy',
        ]);
    });
});
