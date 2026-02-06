/**
 * Avatar resolution utility for ROK-194: Dynamic Avatar Resolution
 * 
 * Resolves avatars based on context:
 * - Game context: Show character portrait if available
 * - General context: Show Discord avatar
 * - Fallback: Initials (handled by component)
 */

export interface ResolvedAvatar {
    /** Avatar URL or null if no avatar available */
    url: string | null;
    /** Type of avatar resolved */
    type: 'character' | 'discord' | 'initials';
}

/**
 * User object with avatar and optional character data.
 * Used by resolveAvatar to determine the most appropriate avatar to display.
 */
export interface AvatarUser {
    /** Discord avatar URL */
    avatar: string | null;
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
 * 1. Character portrait (if gameId provided and character exists for that game)
 * 2. Discord avatar
 * 3. Initials (returns null, component handles initials)
 * 
 * @param user - User object with avatar and optional characters
 * @param gameId - Optional game ID for context-aware resolution
 * @returns Resolved avatar with URL and type
 * 
 * @example
 * // Game context - returns character portrait
 * resolveAvatar(user, 'game-uuid-123')
 * // => { url: 'https://...', type: 'character' }
 * 
 * @example
 * // General context - returns Discord avatar
 * resolveAvatar(user)
 * // => { url: 'https://discord.com/...', type: 'discord' }
 * 
 * @example
 * // No avatar - returns null for initials fallback
 * resolveAvatar({ avatar: null })
 * // => { url: null, type: 'initials' }
 */
export function resolveAvatar(
    user: AvatarUser | null | undefined,
    gameId?: string
): ResolvedAvatar {
    // Handle null/undefined user
    if (!user) {
        return { url: null, type: 'initials' };
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
