/**
 * Avatar resolution utility for ROK-194: Dynamic Avatar Resolution
 * Updated for ROK-220: Custom Avatar Upload (highest priority)
 * Updated for ROK-222: Unified avatar helpers (buildDiscordAvatarUrl, toAvatarUser)
 *
 * Resolves avatars based on context:
 * - Custom upload: Always highest priority when set
 * - Game context: Show character portrait if available
 * - General context: Show Discord avatar
 * - Fallback: Initials (handled by component)
 */

import { API_BASE_URL } from './config';

export type AvatarType = 'custom' | 'character' | 'discord' | 'initials';

export interface ResolvedAvatar {
    /** Avatar URL or null if no avatar available */
    url: string | null;
    /** Type of avatar resolved */
    type: AvatarType;
}

/**
 * User object with avatar and optional character data.
 * Used by resolveAvatar to determine the most appropriate avatar to display.
 */
export interface AvatarUser {
    /** Discord avatar URL (full URL, not hash) */
    avatar: string | null;
    /** Custom uploaded avatar (relative path like /avatars/...) */
    customAvatarUrl?: string | null;
    /** User's characters (optional) */
    characters?: Array<{
        gameId: string;
        avatarUrl: string | null;
    }>;
}

/**
 * Build a full Discord CDN avatar URL from a discordId and avatar hash.
 * Returns null if either value is missing.
 * If the hash is already a full URL, returns it as-is.
 */
export function buildDiscordAvatarUrl(
    discordId: string | null | undefined,
    avatarHash: string | null | undefined,
): string | null {
    if (!discordId || !avatarHash) return null;
    if (avatarHash.startsWith('http')) return avatarHash;
    return `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.png`;
}

/**
 * Bridge function that converts API response shapes (which store Discord avatar
 * as a hash) into the AvatarUser interface expected by resolveAvatar().
 *
 * Use this when passing data from API DTOs (SignupUserDto, User, RosterAssignmentResponse)
 * that have `avatar` as a Discord hash and `discordId` as a separate field.
 */
export function toAvatarUser(user: {
    avatar: string | null;
    discordId?: string | null;
    customAvatarUrl?: string | null;
    characters?: Array<{ gameId: string; avatarUrl: string | null }>;
}): AvatarUser {
    return {
        avatar: buildDiscordAvatarUrl(user.discordId, user.avatar) ?? user.avatar,
        customAvatarUrl: user.customAvatarUrl,
        characters: user.characters,
    };
}

/**
 * Resolves the most appropriate avatar for a user based on context.
 *
 * Priority:
 * 1. Custom uploaded avatar (ROK-220)
 * 2. Character portrait (if gameId provided and character exists for that game)
 * 3. Discord avatar
 * 4. Initials (returns null, component handles initials)
 */
export function resolveAvatar(
    user: AvatarUser | null | undefined,
    gameId?: string
): ResolvedAvatar {
    // Handle null/undefined user
    if (!user) {
        return { url: null, type: 'initials' };
    }

    // Custom avatar has highest priority (ROK-220)
    if (user.customAvatarUrl) {
        return { url: `${API_BASE_URL}${user.customAvatarUrl}`, type: 'custom' };
    }

    // If gameId provided, try to find character portrait
    if (gameId && user.characters && user.characters.length > 0) {
        const character = user.characters.find(c => c.gameId === gameId);
        if (character?.avatarUrl) {
            return { url: character.avatarUrl, type: 'character' };
        }
    }

    // Fall back to Discord avatar
    if (user.avatar) {
        return { url: user.avatar, type: 'discord' };
    }

    // No avatar available - component will show initials
    return { url: null, type: 'initials' };
}
