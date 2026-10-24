import { describe, expect, it } from 'vitest';
import { HubMediaItemSchema, isSafeHubMediaHref } from '../hub-media.schema.js';

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
