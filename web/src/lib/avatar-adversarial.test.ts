import { describe, it, expect, vi } from 'vitest';
import { resolveAvatar, toAvatarUser, type AvatarUser } from './avatar';

// Mock config module so API_BASE_URL is defined for custom avatar URL resolution
vi.mock('./config', () => ({
    API_BASE_URL: 'http://localhost:3000',
}));

describe('resolveAvatar — adversarial edge cases (ROK-352) — part 1', () => {
    describe('Malformed / invalid avatarPreference objects', () => {
        it('falls through to default when preference type is an unrecognized string', () => {
            const user = {
                avatar: 'https://discord.com/avatar.png',
                customAvatarUrl: '/avatars/custom.png',
                avatarPreference: { type: 'emoji' as 'custom' },
            } satisfies AvatarUser;

            const result = resolveAvatar(user);

            expect(result).toEqual({
                url: 'http://localhost:3000/avatars/custom.png',
                type: 'custom',
            });
        });

        it('falls through when avatarPreference has type="character" but no characterName', () => {
            const user: AvatarUser = {
                avatar: 'https://discord.com/avatar.png',
                customAvatarUrl: null,
                characters: [
                    { gameId: 'world-of-warcraft', name: 'Thrall', avatarUrl: 'https://example.com/thrall.png' },
                ],
                avatarPreference: { type: 'character' },
            };

            const result = resolveAvatar(user);

            expect(result).toEqual({
                url: 'https://discord.com/avatar.png',
                type: 'discord',
            });
        });

        it('falls through when preferred character exists but has null avatarUrl', () => {
            const user: AvatarUser = {
                avatar: 'https://discord.com/avatar.png',
                customAvatarUrl: null,
                characters: [
                    { gameId: 'world-of-warcraft', name: 'Thrall', avatarUrl: null },
                ],
                avatarPreference: { type: 'character', characterName: 'Thrall' },
            };

            const result = resolveAvatar(user);

            expect(result).toEqual({
                url: 'https://discord.com/avatar.png',
                type: 'discord',
            });
        });

        it('falls through to initials when all sources unavailable and preference set', () => {
            const user: AvatarUser = {
                avatar: null,
                customAvatarUrl: null,
                characters: [],
                avatarPreference: { type: 'discord' },
            };

            const result = resolveAvatar(user);

            expect(result).toEqual({ url: null, type: 'initials' });
        });
    });

});

describe('resolveAvatar — adversarial edge cases (ROK-352) — part 2', () => {
    describe('Preference for character that no longer exists', () => {
        it('falls through when character was deleted (no longer in characters array)', () => {
            const user: AvatarUser = {
                avatar: 'https://discord.com/avatar.png',
                customAvatarUrl: '/avatars/custom.png',
                characters: [],
                avatarPreference: { type: 'character', characterName: 'DeletedChar' },
            };

            const result = resolveAvatar(user);

            expect(result).toEqual({
                url: 'http://localhost:3000/avatars/custom.png',
                type: 'custom',
            });
        });

        it('falls through when characters array is undefined and character pref has no avatarUrl', () => {
            const user: AvatarUser = {
                avatar: 'https://discord.com/avatar.png',
                customAvatarUrl: null,
                avatarPreference: { type: 'character', characterName: 'Thrall' },
            };

            const result = resolveAvatar(user);

            expect(result).toEqual({
                url: 'https://discord.com/avatar.png',
                type: 'discord',
            });
        });

        it('falls through to discord when characters array is undefined and character pref set', () => {
            const user: AvatarUser = {
                avatar: 'https://discord.com/avatar.png',
                customAvatarUrl: null,
                avatarPreference: { type: 'character', characterName: 'Thrall' },
            };

            const result = resolveAvatar(user);

            expect(result).toEqual({
                url: 'https://discord.com/avatar.png',
                type: 'discord',
            });
        });

        it('uses discord when preferred character is deleted and no custom fallback', () => {
            const user: AvatarUser = {
                avatar: 'https://discord.com/avatar.png',
                customAvatarUrl: null,
                characters: [
                    { gameId: 'world-of-warcraft', name: 'Jaina', avatarUrl: 'https://example.com/jaina.png' },
                ],
                avatarPreference: { type: 'character', characterName: 'Thrall' },
            };

            const result = resolveAvatar(user);

            expect(result).toEqual({
                url: 'https://discord.com/avatar.png',
                type: 'discord',
            });
        });
    });

});

describe('resolveAvatar — adversarial edge cases (ROK-352) — part 3', () => {
    describe('Custom avatar URL edge cases', () => {
        it('custom preference builds correct full URL with API_BASE_URL prefix', () => {
            const user: AvatarUser = {
                avatar: null,
                customAvatarUrl: '/avatars/user-42.webp',
                avatarPreference: { type: 'custom' },
            };

            const result = resolveAvatar(user);

            expect(result.url).toBe('http://localhost:3000/avatars/user-42.webp');
            expect(result.type).toBe('custom');
        });

        it('default path also builds correct full URL for custom when no preference', () => {
            const user: AvatarUser = {
                avatar: null,
                customAvatarUrl: '/avatars/user-42.webp',
                avatarPreference: null,
            };

            const result = resolveAvatar(user);

            expect(result.url).toBe('http://localhost:3000/avatars/user-42.webp');
            expect(result.type).toBe('custom');
        });
    });

    describe('Preference does not bypass gameId-based character lookup', () => {
        it('preference lookup uses characterName not gameId — finds by name', () => {
            const user: AvatarUser = {
                avatar: null,
                customAvatarUrl: null,
                characters: [
                    { gameId: 'world-of-warcraft', name: 'Thrall', avatarUrl: 'https://example.com/thrall.png' },
                    { gameId: 'final-fantasy-xiv-online', name: 'Y\'shtola', avatarUrl: 'https://example.com/yshtola.png' },
                ],
                avatarPreference: { type: 'character', characterName: "Y'shtola" },
            };

            const result = resolveAvatar(user);

            expect(result).toEqual({
                url: "https://example.com/yshtola.png",
                type: 'character',
            });
        });

        it('preference is case-sensitive for characterName', () => {
            const user: AvatarUser = {
                avatar: 'https://discord.com/avatar.png',
                customAvatarUrl: null,
                characters: [
                    { gameId: 'world-of-warcraft', name: 'Thrall', avatarUrl: 'https://example.com/thrall.png' },
                ],
                avatarPreference: { type: 'character', characterName: 'thrall' },
            };

            const result = resolveAvatar(user);

            expect(result).toEqual({
                url: 'https://discord.com/avatar.png',
                type: 'discord',
            });
        });
    });

});

describe('toAvatarUser — adversarial edge cases (ROK-352) — part 1', () => {
    describe('avatarPreference passthrough', () => {
        it('passes through avatarPreference: null as null', () => {
            const result = toAvatarUser({
                avatar: null,
                discordId: null,
                customAvatarUrl: null,
                avatarPreference: null,
            });

            expect(result.avatarPreference).toBeNull();
        });

        it('passes through avatarPreference: undefined as undefined', () => {
            const result = toAvatarUser({
                avatar: null,
                discordId: null,
                customAvatarUrl: null,
            });

            expect(result.avatarPreference).toBeUndefined();
        });

        it('passes through character preference with characterName intact', () => {
            const result = toAvatarUser({
                avatar: null,
                discordId: 'discord-123',
                customAvatarUrl: null,
                avatarPreference: { type: 'character', characterName: 'Thrall' },
            });

            expect(result.avatarPreference).toEqual({ type: 'character', characterName: 'Thrall' });
        });

        it('passes through discord preference intact', () => {
            const result = toAvatarUser({
                avatar: 'abc123',
                discordId: 'discord-123',
                customAvatarUrl: null,
                avatarPreference: { type: 'discord' },
            });

            expect(result.avatarPreference).toEqual({ type: 'discord' });
        });

        it('passes through custom preference intact', () => {
            const result = toAvatarUser({
                avatar: null,
                discordId: null,
                customAvatarUrl: '/avatars/custom.png',
                avatarPreference: { type: 'custom' },
            });

            expect(result.avatarPreference).toEqual({ type: 'custom' });
        });
    });

});

describe('toAvatarUser — adversarial edge cases (ROK-352) — part 2', () => {
    describe('Discord avatar URL construction', () => {
        it('builds Discord CDN URL from discordId + avatar hash', () => {
            const result = toAvatarUser({
                avatar: 'abc123hash',
                discordId: '111222333',
                customAvatarUrl: null,
            });

            expect(result.avatar).toBe('https://cdn.discordapp.com/avatars/111222333/abc123hash.png');
        });

        it('returns null avatar when discordId is null even if avatar hash is set', () => {
            const result = toAvatarUser({
                avatar: 'abc123hash',
                discordId: null,
                customAvatarUrl: null,
            });

            expect(result.avatar).toBeNull();
        });

        it('returns null avatar when avatar hash is null', () => {
            const result = toAvatarUser({
                avatar: null,
                discordId: '111222333',
                customAvatarUrl: null,
            });

            expect(result.avatar).toBeNull();
        });

        it('preserves full Discord URL passed as avatar field (already a URL)', () => {
            const fullUrl = 'https://cdn.discordapp.com/avatars/111/hash.png';
            const result = toAvatarUser({
                avatar: fullUrl,
                discordId: null,
                customAvatarUrl: null,
            });

            expect(result.avatar).toBe(fullUrl);
        });

        it('passes through characters array unchanged when no overlay', () => {
            const chars = [
                { gameId: 'world-of-warcraft', name: 'Thrall', avatarUrl: 'https://example.com/thrall.png' },
            ];
            const result = toAvatarUser({
                avatar: null,
                discordId: null,
                customAvatarUrl: null,
                characters: chars,
            });

            expect(result.characters).toBe(chars);
        });
    });

});

describe('toAvatarUser — adversarial edge cases (ROK-352) — part 3', () => {
    describe('Integration: toAvatarUser -> resolveAvatar with preference', () => {
        it('resolves correct avatar end-to-end with character preference', () => {
            const rawUser = {
                avatar: 'abc123',
                discordId: '111222333',
                customAvatarUrl: '/avatars/custom.png',
                characters: [
                    { gameId: 'world-of-warcraft', name: 'Thrall', avatarUrl: 'https://example.com/thrall.png' },
                ],
                avatarPreference: { type: 'character' as const, characterName: 'Thrall' },
            };

            const avatarUser = toAvatarUser(rawUser);
            const result = resolveAvatar(avatarUser);

            expect(result).toEqual({
                url: 'https://example.com/thrall.png',
                type: 'character',
            });
        });

        it('falls through to discord end-to-end when character pref name does not match', () => {
            const rawUser = {
                avatar: 'abc123',
                discordId: '111222333',
                customAvatarUrl: null,
                characters: [
                    { gameId: 'world-of-warcraft', name: 'Jaina', avatarUrl: 'https://example.com/jaina.png' },
                ],
                avatarPreference: { type: 'character' as const, characterName: 'Thrall' },
            };

            const avatarUser = toAvatarUser(rawUser);
            const result = resolveAvatar(avatarUser);

            expect(result.type).toBe('discord');
            expect(result.url).toBe('https://cdn.discordapp.com/avatars/111222333/abc123.png');
        });
    });

});
