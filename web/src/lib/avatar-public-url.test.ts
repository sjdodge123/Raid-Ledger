/**
 * ROK-1629: anonymous viewers of public roster routes receive a server-built
 * avatar URL and NO Discord id. The avatar must survive that payload.
 */
import { describe, it, expect } from 'vitest';
import { buildDiscordAvatarUrl, toAvatarUser } from './avatar';

const CDN_URL = 'https://cdn.discordapp.com/avatars/111/abc.png';

describe('buildDiscordAvatarUrl — server-built URL without a discordId (ROK-1629)', () => {
    it('passes an http(s) avatar URL through when discordId is undefined', () => {
        expect(buildDiscordAvatarUrl(undefined, CDN_URL)).toBe(CDN_URL);
    });

    it('passes an http(s) avatar URL through when discordId is null or empty', () => {
        expect(buildDiscordAvatarUrl(null, CDN_URL)).toBe(CDN_URL);
        expect(buildDiscordAvatarUrl('', CDN_URL)).toBe(CDN_URL);
    });

    it('still returns null for a bare hash with no discordId', () => {
        expect(buildDiscordAvatarUrl(undefined, 'abc')).toBeNull();
    });

    it('still builds the CDN URL from a discordId + hash (member payload unchanged)', () => {
        expect(buildDiscordAvatarUrl('111', 'abc')).toBe(CDN_URL);
    });

    it('returns null when there is no avatar at all', () => {
        expect(buildDiscordAvatarUrl('111', null)).toBeNull();
        expect(buildDiscordAvatarUrl(undefined, undefined)).toBeNull();
    });
});

describe('toAvatarUser — public roster member (ROK-1629)', () => {
    it('keeps the server-built avatar URL when the payload has no discordId', () => {
        expect(toAvatarUser({ id: 7, avatar: CDN_URL }).avatar).toBe(CDN_URL);
    });
});
