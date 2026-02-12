/**
 * Avatar resolution utility for ROK-194: Dynamic Avatar Resolution
 * Updated for ROK-220: Custom Avatar Upload (highest priority)
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
    /** Discord avatar URL */
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
