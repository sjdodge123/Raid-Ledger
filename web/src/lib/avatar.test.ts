import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveAvatar, toAvatarUser, setCurrentUserAvatarData, getCurrentUserAvatarData, type AvatarUser } from './avatar';

// Mock config module so API_BASE_URL is defined for custom avatar URL resolution
vi.mock('./config', () => ({
    API_BASE_URL: 'http://localhost:3000',
}));

describe('resolveAvatar', () => {
    describe('Avatar Preference (ROK-352)', () => {
        it('honors discord preference over custom avatar', () => {
            const user: AvatarUser = {
                avatar: 'https://discord.com/avatar.png',
                customAvatarUrl: '/avatars/custom.png',
                avatarPreference: { type: 'discord' },
            };

            const result = resolveAvatar(user);

            expect(result).toEqual({
                url: 'https://discord.com/avatar.png',
                type: 'discord',
            });
        });

        it('honors character preference over custom avatar', () => {
            const user: AvatarUser = {
                avatar: 'https://discord.com/avatar.png',
                customAvatarUrl: '/avatars/custom.png',
                characters: [
                    { gameId: 'wow', name: 'Thrall', avatarUrl: 'https://example.com/thrall.png' },
                ],
                avatarPreference: { type: 'character', characterName: 'Thrall' },
            };

            const result = resolveAvatar(user);

            expect(result).toEqual({
                url: 'https://example.com/thrall.png',
                type: 'character',
            });
        });

        it('honors custom preference explicitly', () => {
            const user: AvatarUser = {
                avatar: 'https://discord.com/avatar.png',
                customAvatarUrl: '/avatars/custom.png',
                avatarPreference: { type: 'custom' },
            };

            const result = resolveAvatar(user);

            expect(result).toEqual({
                url: 'http://localhost:3000/avatars/custom.png',
                type: 'custom',
            });
        });

        it('falls through when preferred discord source is unavailable', () => {
            const user: AvatarUser = {
                avatar: null,
                customAvatarUrl: '/avatars/custom.png',
                avatarPreference: { type: 'discord' },
            };

            const result = resolveAvatar(user);

            // Falls through to default priority: custom is available
            expect(result).toEqual({
                url: 'http://localhost:3000/avatars/custom.png',
                type: 'custom',
            });
        });

        it('falls through when preferred character is not found', () => {
            const user: AvatarUser = {
                avatar: 'https://discord.com/avatar.png',
                customAvatarUrl: null,
                characters: [
                    { gameId: 'wow', name: 'Jaina', avatarUrl: 'https://example.com/jaina.png' },
                ],
                avatarPreference: { type: 'character', characterName: 'Thrall' },
            };

            const result = resolveAvatar(user);

            // Falls through: character 'Thrall' not found, discord is next
            expect(result).toEqual({
                url: 'https://discord.com/avatar.png',
                type: 'discord',
            });
        });

        it('falls through when preferred custom is unavailable', () => {
            const user: AvatarUser = {
                avatar: 'https://discord.com/avatar.png',
                customAvatarUrl: null,
                avatarPreference: { type: 'custom' },
            };

            const result = resolveAvatar(user);

            // Falls through to discord
            expect(result).toEqual({
                url: 'https://discord.com/avatar.png',
                type: 'discord',
            });
        });

        it('uses default priority when avatarPreference is null', () => {
            const user: AvatarUser = {
                avatar: 'https://discord.com/avatar.png',
                customAvatarUrl: '/avatars/custom.png',
                avatarPreference: null,
            };

            const result = resolveAvatar(user);

            // Default priority: custom > discord
            expect(result).toEqual({
                url: 'http://localhost:3000/avatars/custom.png',
                type: 'custom',
            });
        });
    });

    describe('Character Portrait Resolution', () => {
        it('returns character portrait when gameId matches and avatarUrl exists', () => {
            const user: AvatarUser = {
                avatar: 'https://discord.com/avatar.png',
                characters: [
                    { gameId: 'game-123', avatarUrl: 'https://example.com/char1.png' },
                    { gameId: 'game-456', avatarUrl: 'https://example.com/char2.png' },
                ],
            };

            const result = resolveAvatar(user, 'game-123');

            expect(result).toEqual({
                url: 'https://example.com/char1.png',
                type: 'character',
            });
        });

        it('returns character portrait for correct game when multiple characters exist', () => {
            const user: AvatarUser = {
                avatar: 'https://discord.com/avatar.png',
                characters: [
                    { gameId: 'wow', avatarUrl: 'https://example.com/wow-char.png' },
                    { gameId: 'ffxiv', avatarUrl: 'https://example.com/ffxiv-char.png' },
                ],
            };

            const result = resolveAvatar(user, 'ffxiv');

            expect(result).toEqual({
                url: 'https://example.com/ffxiv-char.png',
                type: 'character',
            });
        });
    });

    describe('Discord Avatar Fallback', () => {
        it('falls back to Discord avatar when no character for game', () => {
            const user: AvatarUser = {
                avatar: 'https://discord.com/avatar.png',
                characters: [
                    { gameId: 'game-123', avatarUrl: 'https://example.com/char.png' },
                ],
            };

            const result = resolveAvatar(user, 'game-999');

            expect(result).toEqual({
                url: 'https://discord.com/avatar.png',
                type: 'discord',
            });
        });

        it('falls back to Discord avatar when character has no avatarUrl', () => {
            const user: AvatarUser = {
                avatar: 'https://discord.com/avatar.png',
                characters: [
                    { gameId: 'game-123', avatarUrl: null },
                ],
            };

            const result = resolveAvatar(user, 'game-123');

            expect(result).toEqual({
                url: 'https://discord.com/avatar.png',
                type: 'discord',
            });
        });

        it('returns Discord avatar when no gameId provided', () => {
            const user: AvatarUser = {
                avatar: 'https://discord.com/avatar.png',
                characters: [
                    { gameId: 'game-123', avatarUrl: 'https://example.com/char.png' },
                ],
            };

            const result = resolveAvatar(user);

            expect(result).toEqual({
                url: 'https://discord.com/avatar.png',
                type: 'discord',
            });
        });

        it('returns Discord avatar when characters array is empty', () => {
            const user: AvatarUser = {
                avatar: 'https://discord.com/avatar.png',
                characters: [],
            };

            const result = resolveAvatar(user, 'game-123');

            expect(result).toEqual({
                url: 'https://discord.com/avatar.png',
                type: 'discord',
            });
        });

        it('returns Discord avatar when characters is undefined', () => {
            const user: AvatarUser = {
                avatar: 'https://discord.com/avatar.png',
            };

            const result = resolveAvatar(user, 'game-123');

            expect(result).toEqual({
                url: 'https://discord.com/avatar.png',
                type: 'discord',
            });
        });
    });

    describe('Initials Fallback', () => {
        it('returns initials type when no Discord avatar and no character', () => {
            const user: AvatarUser = {
                avatar: null,
                characters: [],
            };

            const result = resolveAvatar(user);

            expect(result).toEqual({
                url: null,
                type: 'initials',
            });
        });

        it('returns initials type when no Discord avatar and no matching character', () => {
            const user: AvatarUser = {
                avatar: null,
                characters: [
                    { gameId: 'game-123', avatarUrl: 'https://example.com/char.png' },
                ],
            };

            const result = resolveAvatar(user, 'game-999');

            expect(result).toEqual({
                url: null,
                type: 'initials',
            });
        });
    });

    describe('Null/Undefined Handling', () => {
        it('handles null user gracefully', () => {
            const result = resolveAvatar(null);

            expect(result).toEqual({
                url: null,
                type: 'initials',
            });
        });

        it('handles undefined user gracefully', () => {
            const result = resolveAvatar(undefined);

            expect(result).toEqual({
                url: null,
                type: 'initials',
            });
        });

        it('handles user with null avatar and undefined characters', () => {
            const user: AvatarUser = {
                avatar: null,
            };

            const result = resolveAvatar(user);

            expect(result).toEqual({
                url: null,
                type: 'initials',
            });
        });
    });

    describe('Edge Cases', () => {
        it('prioritizes character portrait over Discord avatar when gameId matches', () => {
            const user: AvatarUser = {
                avatar: 'https://discord.com/avatar.png',
                characters: [
                    { gameId: 'game-123', avatarUrl: 'https://example.com/char.png' },
                ],
            };

            const result = resolveAvatar(user, 'game-123');

            expect(result.type).toBe('character');
            expect(result.url).toBe('https://example.com/char.png');
        });

        it('handles empty string avatarUrl as falsy', () => {
            const user: AvatarUser = {
                avatar: 'https://discord.com/avatar.png',
                characters: [
                    { gameId: 'game-123', avatarUrl: '' },
                ],
            };

            const result = resolveAvatar(user, 'game-123');

            expect(result).toEqual({
                url: 'https://discord.com/avatar.png',
                type: 'discord',
            });
        });
    });
});

// ============================================================
// Adversarial Tests (ROK-352)
// ============================================================

describe('resolveAvatar — adversarial edge cases (ROK-352)', () => {
    describe('Malformed / invalid avatarPreference objects', () => {
        it('falls through to default when preference type is an unrecognized string', () => {
            const user = {
                avatar: 'https://discord.com/avatar.png',
                customAvatarUrl: '/avatars/custom.png',
                // Cast to bypass TS so we can test a runtime bad value
                avatarPreference: { type: 'emoji' as 'custom' },
            } satisfies AvatarUser;

            // 'emoji' is not custom/discord/character so none of the pref branches fire
            const result = resolveAvatar(user);

            // Falls to default: custom > discord
            expect(result).toEqual({
                url: 'http://localhost:3000/avatars/custom.png',
                type: 'custom',
            });
        });

        it('falls through to default when avatarPreference has type="character" but no characterName', () => {
            const user: AvatarUser = {
                avatar: 'https://discord.com/avatar.png',
                customAvatarUrl: null,
                characters: [
                    { gameId: 'wow', name: 'Thrall', avatarUrl: 'https://example.com/thrall.png' },
                ],
                // characterName is omitted — the `find` will never match
                avatarPreference: { type: 'character' },
            };

            const result = resolveAvatar(user);

            // characterName is undefined, so `pref.characterName` is falsy → falls through to discord
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
                    { gameId: 'wow', name: 'Thrall', avatarUrl: null },
                ],
                avatarPreference: { type: 'character', characterName: 'Thrall' },
            };

            // Character found but avatarUrl is null — should fall through
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

    describe('Preference for character that no longer exists', () => {
        it('falls through when character was deleted (no longer in characters array)', () => {
            const user: AvatarUser = {
                avatar: 'https://discord.com/avatar.png',
                customAvatarUrl: '/avatars/custom.png',
                characters: [], // character deleted
                avatarPreference: { type: 'character', characterName: 'DeletedChar' },
            };

            // Character not found → falls to default: custom
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
                // characters is undefined, no avatarUrl cached
                avatarPreference: { type: 'character', characterName: 'Thrall' },
            };

            // `user.characters` is falsy and no avatarUrl → falls to discord
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
                // characters is undefined — can't look up character
                avatarPreference: { type: 'character', characterName: 'Thrall' },
            };

            const result = resolveAvatar(user);

            // No characters array → falls through to discord
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
                    { gameId: 'wow', name: 'Jaina', avatarUrl: 'https://example.com/jaina.png' },
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
                    { gameId: 'wow', name: 'Thrall', avatarUrl: 'https://example.com/thrall.png' },
                    { gameId: 'ffxiv', name: 'Y\'shtola', avatarUrl: 'https://example.com/yshtola.png' },
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
                    { gameId: 'wow', name: 'Thrall', avatarUrl: 'https://example.com/thrall.png' },
                ],
                // Wrong case
                avatarPreference: { type: 'character', characterName: 'thrall' },
            };

            // Case-sensitive find — 'thrall' !== 'Thrall' → falls through
            const result = resolveAvatar(user);

            expect(result).toEqual({
                url: 'https://discord.com/avatar.png',
                type: 'discord',
            });
        });
    });
});

describe('toAvatarUser — adversarial edge cases (ROK-352)', () => {
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

            // No discordId → buildDiscordAvatarUrl returns null, and the hash is not a URL
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

            // buildDiscordAvatarUrl returns null (no discordId), but avatar starts with http
            expect(result.avatar).toBe(fullUrl);
        });

        it('passes through characters array unchanged', () => {
            const chars = [
                { gameId: 'wow', name: 'Thrall', avatarUrl: 'https://example.com/thrall.png' },
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

    describe('Integration: toAvatarUser → resolveAvatar with preference', () => {
        it('resolves correct avatar end-to-end with character preference', () => {
            const rawUser = {
                avatar: 'abc123',
                discordId: '111222333',
                customAvatarUrl: '/avatars/custom.png',
                characters: [
                    { gameId: 'wow', name: 'Thrall', avatarUrl: 'https://example.com/thrall.png' },
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
                    { gameId: 'wow', name: 'Jaina', avatarUrl: 'https://example.com/jaina.png' },
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

// ============================================================
// Current User Overlay Tests (ROK-352 fix)
// ============================================================

describe('toAvatarUser — current user overlay (ROK-352)', () => {
    afterEach(() => {
        // Always clear the overlay after each test to avoid leaking state
        setCurrentUserAvatarData(null);
    });

    it('overlays avatarPreference when user id matches current user', () => {
        setCurrentUserAvatarData({
            id: 42,
            avatarPreference: { type: 'discord' },
            characters: [{ gameId: 'wow', name: 'Thrall', avatarUrl: 'https://example.com/thrall.png' }],
        });

        const result = toAvatarUser({
            id: 42,
            avatar: 'abc123',
            discordId: '111222333',
            customAvatarUrl: '/avatars/custom.png',
            // No avatarPreference from API response
        });

        expect(result.avatarPreference).toEqual({ type: 'discord' });
    });

    it('overlays characters when user id matches current user', () => {
        const characters = [
            { gameId: 'wow', name: 'Thrall', avatarUrl: 'https://example.com/thrall.png' },
        ];
        setCurrentUserAvatarData({
            id: 42,
            avatarPreference: null,
            characters,
        });

        const result = toAvatarUser({
            id: 42,
            avatar: null,
            discordId: null,
            // No characters from API response
        });

        expect(result.characters).toBe(characters);
    });

    it('overlays customAvatarUrl when field is omitted from DTO', () => {
        setCurrentUserAvatarData({
            id: 42,
            customAvatarUrl: '/avatars/current-user.webp',
        });

        // DTO from event API — no customAvatarUrl field (undefined)
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

        // Even when caller explicitly passes null, overlay wins because
        // auth data is more authoritative for the current user
        const result = toAvatarUser({
            id: 42,
            avatar: null,
            discordId: null,
            customAvatarUrl: null,
        });

        expect(result.customAvatarUrl).toBe('/avatars/current-user.webp');
    });

    it('does NOT overlay when user id does not match current user', () => {
        setCurrentUserAvatarData({
            id: 42,
            avatarPreference: { type: 'discord' },
            characters: [{ gameId: 'wow', name: 'Thrall', avatarUrl: 'https://example.com/thrall.png' }],
        });

        const result = toAvatarUser({
            id: 99, // Different user
            avatar: null,
            discordId: null,
        });

        expect(result.avatarPreference).toBeUndefined();
        expect(result.characters).toBeUndefined();
    });

    it('does NOT overlay when no current user data is set', () => {
        // _currentUserAvatarData is null (default / cleared in afterEach)

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
            // No id field
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

        // Overlay (auth data) is always more authoritative for the current user
        expect(result.avatarPreference).toEqual({ type: 'discord' });
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

        // Overlay (auth data) wins even when caller explicitly passes null
        expect(result.avatarPreference).toEqual({ type: 'discord' });
    });

    it('end-to-end: current user discord preference honored in resolveAvatar', () => {
        setCurrentUserAvatarData({
            id: 42,
            avatarPreference: { type: 'discord' },
        });

        // Simulates a SignupUserDto from an event API response (no avatarPreference)
        const avatarUser = toAvatarUser({
            id: 42,
            avatar: 'abc123',
            discordId: '111222333',
            customAvatarUrl: '/avatars/custom.png',
        });
        const result = resolveAvatar(avatarUser);

        // Without overlay: would default to custom (highest priority)
        // With overlay: discord preference is honored
        expect(result.type).toBe('discord');
        expect(result.url).toBe('https://cdn.discordapp.com/avatars/111222333/abc123.png');
    });

    it('end-to-end: current user character preference honored in resolveAvatar', () => {
        setCurrentUserAvatarData({
            id: 42,
            avatarPreference: { type: 'character', characterName: 'Thrall' },
            characters: [
                { gameId: 'wow', name: 'Thrall', avatarUrl: 'https://example.com/thrall.png' },
            ],
        });

        // Simulates a UserPreviewDto (no avatarPreference, no characters)
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

    it('end-to-end: overlay characters with names fix signupsPreview without names', () => {
        setCurrentUserAvatarData({
            id: 42,
            avatarPreference: { type: 'character', characterName: 'Thrall' },
            characters: [
                { gameId: 'wow', name: 'Thrall', avatarUrl: 'https://example.com/thrall.png' },
            ],
        });

        // Simulates signupsPreview DTO — has characters but WITHOUT name field
        const avatarUser = toAvatarUser({
            id: 42,
            avatar: 'abc123',
            discordId: '111222333',
            customAvatarUrl: null,
            characters: [
                { gameId: 'wow', avatarUrl: 'https://example.com/thrall.png' },
            ],
        });
        const result = resolveAvatar(avatarUser);

        // Without fix: API characters (no name) would win, character lookup fails, falls to discord
        // With fix: overlay characters (with name) win, character lookup succeeds
        expect(result.type).toBe('character');
        expect(result.url).toBe('https://example.com/thrall.png');
    });

    it('end-to-end: other user is not affected by current user overlay', () => {
        setCurrentUserAvatarData({
            id: 42,
            avatarPreference: { type: 'discord' },
        });

        // Different user — should use default priority (custom > character > discord)
        const avatarUser = toAvatarUser({
            id: 99,
            avatar: 'abc123',
            discordId: '999888777',
            customAvatarUrl: '/avatars/other-custom.png',
        });
        const result = resolveAvatar(avatarUser);

        // Default priority: custom avatar wins
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
