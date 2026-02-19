import { describe, it, expect, vi } from 'vitest';
import { resolveAvatar, type AvatarUser } from './avatar';

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
