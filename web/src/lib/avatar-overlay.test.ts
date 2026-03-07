import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    resolveAvatar,
    toAvatarUser,
    setCurrentUserAvatarData,
    getCurrentUserAvatarData,
} from './avatar';

// Mock config module so API_BASE_URL is defined for custom avatar URL resolution
vi.mock('./config', () => ({
    API_BASE_URL: 'http://localhost:3000',
}));

describe('toAvatarUser — current user overlay (ROK-352) — part 1', () => {
    afterEach(() => {
        setCurrentUserAvatarData(null);
    });

    it('overlays avatarPreference when user id matches current user', () => {
        setCurrentUserAvatarData({
            id: 42,
            avatarPreference: { type: 'discord' },
        });

        const result = toAvatarUser({
            id: 42,
            avatar: 'abc123',
            discordId: '111222333',
            customAvatarUrl: '/avatars/custom.png',
        });

        expect(result.avatarPreference).toEqual({ type: 'discord' });
    });

    it('builds synthetic characters entry from resolvedAvatarUrl when character preference is set (ROK-414)', () => {
        setCurrentUserAvatarData({
            id: 42,
            avatarPreference: { type: 'character', characterName: 'Thrall' },
            resolvedAvatarUrl: 'https://example.com/thrall.png',
        });

        const result = toAvatarUser({
            id: 42,
            avatar: null,
            discordId: null,
        });

        expect(result.characters).toEqual([
            { gameId: '__resolved__', name: 'Thrall', avatarUrl: 'https://example.com/thrall.png' },
        ]);
    });

    it('overlays customAvatarUrl when field is omitted from DTO', () => {
        setCurrentUserAvatarData({
            id: 42,
            customAvatarUrl: '/avatars/current-user.webp',
        });

        const result = toAvatarUser({
            id: 42,
            avatar: null,
            discordId: null,
        });

        expect(result.customAvatarUrl).toBe('/avatars/current-user.webp');
    });

    it('overlay wins over caller customAvatarUrl for current user', () => {
        setCurrentUserAvatarData({
            id: 42,
            customAvatarUrl: '/avatars/current-user.webp',
        });

        const result = toAvatarUser({
            id: 42,
            avatar: null,
            discordId: null,
            customAvatarUrl: null,
        });

        expect(result.customAvatarUrl).toBe('/avatars/current-user.webp');
    });

});

describe('toAvatarUser — current user overlay (ROK-352) — part 2', () => {
    afterEach(() => {
        setCurrentUserAvatarData(null);
    });

    it('does NOT overlay when user id does not match current user', () => {
        setCurrentUserAvatarData({
            id: 42,
            avatarPreference: { type: 'discord' },
            resolvedAvatarUrl: 'https://example.com/thrall.png',
        });

        const result = toAvatarUser({
            id: 99,
            avatar: null,
            discordId: null,
        });

        expect(result.avatarPreference).toBeUndefined();
        expect(result.characters).toBeUndefined();
    });

    it('does NOT overlay when no current user data is set', () => {
        const result = toAvatarUser({
            id: 42,
            avatar: null,
            discordId: null,
        });

        expect(result.avatarPreference).toBeUndefined();
        expect(result.characters).toBeUndefined();
    });

    it('does NOT overlay when user has no id', () => {
        setCurrentUserAvatarData({
            id: 42,
            avatarPreference: { type: 'discord' },
        });

        const result = toAvatarUser({
            avatar: null,
            discordId: null,
        });

        expect(result.avatarPreference).toBeUndefined();
    });

    it('overlay wins over caller avatarPreference for current user', () => {
        setCurrentUserAvatarData({
            id: 42,
            avatarPreference: { type: 'discord' },
        });

        const result = toAvatarUser({
            id: 42,
            avatar: null,
            discordId: null,
            avatarPreference: { type: 'custom' },
        });

        expect(result.avatarPreference).toEqual({ type: 'discord' });
    });

});

describe('toAvatarUser — current user overlay (ROK-352) — part 3', () => {
    afterEach(() => {
        setCurrentUserAvatarData(null);
    });

    it('overlay wins over caller null avatarPreference for current user', () => {
        setCurrentUserAvatarData({
            id: 42,
            avatarPreference: { type: 'discord' },
        });

        const result = toAvatarUser({
            id: 42,
            avatar: null,
            discordId: null,
            avatarPreference: null,
        });

        expect(result.avatarPreference).toEqual({ type: 'discord' });
    });

    it('end-to-end: current user discord preference honored in resolveAvatar', () => {
        setCurrentUserAvatarData({
            id: 42,
            avatarPreference: { type: 'discord' },
        });

        const avatarUser = toAvatarUser({
            id: 42,
            avatar: 'abc123',
            discordId: '111222333',
            customAvatarUrl: '/avatars/custom.png',
        });
        const result = resolveAvatar(avatarUser);

        expect(result.type).toBe('discord');
        expect(result.url).toBe('https://cdn.discordapp.com/avatars/111222333/abc123.png');
    });

    it('end-to-end: current user character preference honored via resolvedAvatarUrl (ROK-414)', () => {
        setCurrentUserAvatarData({
            id: 42,
            avatarPreference: { type: 'character', characterName: 'Thrall' },
            resolvedAvatarUrl: 'https://example.com/thrall.png',
        });

        const avatarUser = toAvatarUser({
            id: 42,
            avatar: 'abc123',
            discordId: '111222333',
            customAvatarUrl: '/avatars/custom.png',
        });
        const result = resolveAvatar(avatarUser);

        expect(result.type).toBe('character');
        expect(result.url).toBe('https://example.com/thrall.png');
    });

});

describe('toAvatarUser — current user overlay (ROK-352) — part 4', () => {
    afterEach(() => {
        setCurrentUserAvatarData(null);
    });

    it('end-to-end: resolvedAvatarUrl overlay fixes signupsPreview without character names (ROK-414)', () => {
        setCurrentUserAvatarData({
            id: 42,
            avatarPreference: { type: 'character', characterName: 'Thrall' },
            resolvedAvatarUrl: 'https://example.com/thrall.png',
        });

        const avatarUser = toAvatarUser({
            id: 42,
            avatar: 'abc123',
            discordId: '111222333',
            customAvatarUrl: null,
            characters: [
                { gameId: 'world-of-warcraft', avatarUrl: 'https://example.com/thrall.png' },
            ],
        });
        const result = resolveAvatar(avatarUser);

        expect(result.type).toBe('character');
        expect(result.url).toBe('https://example.com/thrall.png');
    });

    it('end-to-end: other user is not affected by current user overlay', () => {
        setCurrentUserAvatarData({
            id: 42,
            avatarPreference: { type: 'discord' },
        });

        const avatarUser = toAvatarUser({
            id: 99,
            avatar: 'abc123',
            discordId: '999888777',
            customAvatarUrl: '/avatars/other-custom.png',
        });
        const result = resolveAvatar(avatarUser);

        expect(result.type).toBe('custom');
        expect(result.url).toBe('http://localhost:3000/avatars/other-custom.png');
    });

    describe('setCurrentUserAvatarData / getCurrentUserAvatarData', () => {
        it('sets and gets current user data', () => {
            const data = { id: 42, avatarPreference: { type: 'discord' as const } };
            setCurrentUserAvatarData(data);
            expect(getCurrentUserAvatarData()).toBe(data);
        });

        it('clears current user data with null', () => {
            setCurrentUserAvatarData({ id: 42 });
            setCurrentUserAvatarData(null);
            expect(getCurrentUserAvatarData()).toBeNull();
        });
    });

});
