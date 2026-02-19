import { describe, it, expect, vi } from 'vitest';
import { resolveAvatar, toAvatarUser, type AvatarUser } from './avatar';

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

        it('uses cached avatarUrl when characters array is undefined but pref has avatarUrl', () => {
            const user: AvatarUser = {
                avatar: 'https://discord.com/avatar.png',
                customAvatarUrl: null,
                // characters is undefined but avatarUrl is cached in preference
                avatarPreference: { type: 'character', characterName: 'Thrall', avatarUrl: 'https://example.com/thrall.png' },
            };

            const result = resolveAvatar(user);

            expect(result).toEqual({
                url: 'https://example.com/thrall.png',
                type: 'character',
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

    describe('Cached avatarUrl in preference', () => {
        it('uses characters array over cached avatarUrl when both available', () => {
            const user: AvatarUser = {
                avatar: null,
                customAvatarUrl: null,
                characters: [
                    { gameId: 'wow', name: 'Thrall', avatarUrl: 'https://example.com/thrall-updated.png' },
                ],
                // avatarUrl is stale, characters array has newer URL
                avatarPreference: { type: 'character', characterName: 'Thrall', avatarUrl: 'https://example.com/thrall-old.png' },
            };

            const result = resolveAvatar(user);

            expect(result).toEqual({
                url: 'https://example.com/thrall-updated.png',
                type: 'character',
            });
        });

        it('uses cached avatarUrl when character deleted from characters array', () => {
            const user: AvatarUser = {
                avatar: 'https://discord.com/avatar.png',
                customAvatarUrl: null,
                characters: [], // character deleted
                avatarPreference: { type: 'character', characterName: 'DeletedChar', avatarUrl: 'https://example.com/deleted.png' },
            };

            const result = resolveAvatar(user);

            expect(result).toEqual({
                url: 'https://example.com/deleted.png',
                type: 'character',
            });
        });

        it('uses cached avatarUrl when characters data not loaded (UserMenu context)', () => {
            const user: AvatarUser = {
                avatar: 'https://discord.com/avatar.png',
                customAvatarUrl: '/avatars/custom.png',
                // No characters — typical for UserMenu/MoreDrawer where useAuth() doesn't include characters
                avatarPreference: { type: 'character', characterName: 'Thrall', avatarUrl: 'https://example.com/thrall.png' },
            };

            const result = resolveAvatar(user);

            // Should use cached avatarUrl, NOT fall through to custom or discord
            expect(result).toEqual({
                url: 'https://example.com/thrall.png',
                type: 'character',
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
