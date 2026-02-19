/**
 * Avatar resolution utility for ROK-194: Dynamic Avatar Resolution
 * Updated for ROK-220: Custom Avatar Upload (highest priority)
 * Updated for ROK-222: Unified avatar helpers (buildDiscordAvatarUrl, toAvatarUser)
 * Updated for ROK-352: Current user avatar preference sync across all components
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
export interface AvatarPreference {
    type: AvatarType;
    characterName?: string;
}

export interface AvatarUser {
    /** Discord avatar URL (full URL, not hash) */
    avatar: string | null;
    /** Custom uploaded avatar (relative path like /avatars/...) */
    customAvatarUrl?: string | null;
    /** User's characters (optional) */
    characters?: Array<{
        gameId: string;
        name?: string;
        avatarUrl: string | null;
    }>;
    /** Server-persisted avatar preference from user_preferences table */
    avatarPreference?: AvatarPreference | null;
}

// ============================================================
// Current User Overlay (ROK-352)
// ============================================================
// Module-level cache of the current user's avatar preference and characters.
// Set by CurrentUserAvatarSync (mounted in Layout) so that toAvatarUser()
// can automatically overlay the current user's preference data onto any
// user DTO that matches by id — without every component needing useAuth().

interface CurrentUserAvatarData {
    id: number;
    avatarPreference?: AvatarPreference | null;
    characters?: Array<{ gameId: string; name?: string; avatarUrl: string | null }>;
    customAvatarUrl?: string | null;
}

let _currentUserAvatarData: CurrentUserAvatarData | null = null;

/**
 * Set the current user's avatar data for global overlay.
 * Called by CurrentUserAvatarSync whenever the auth user changes.
 * Pass null to clear (e.g., on logout).
 */
export function setCurrentUserAvatarData(data: CurrentUserAvatarData | null): void {
    _currentUserAvatarData = data;
}

/**
 * Get the current user avatar data (for testing/inspection).
 */
export function getCurrentUserAvatarData(): CurrentUserAvatarData | null {
    return _currentUserAvatarData;
}

/**
 * Check if a discordId represents a real linked Discord account.
 * Returns false for local-only accounts (local:xxx) and unlinked accounts (unlinked:xxx).
 */
export function isDiscordLinked(discordId: string | null | undefined): boolean {
    return Boolean(discordId && !discordId.startsWith('local:') && !discordId.startsWith('unlinked:'));
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
 *
 * ROK-352: When the user's `id` matches the current logged-in user, automatically
 * overlays `avatarPreference` and `characters` from the cached auth data so the
 * current user's avatar preference is honored everywhere — not just in components
 * that use useAuth() directly.
 */
export function toAvatarUser(user: {
    id?: number;
    avatar: string | null;
    discordId?: string | null;
    customAvatarUrl?: string | null;
    characters?: Array<{ gameId: string; name?: string; avatarUrl: string | null }>;
    avatarPreference?: AvatarPreference | null;
}): AvatarUser {
    // ROK-352: Overlay current user's preference data when IDs match
    const overlay = _currentUserAvatarData
        && user.id != null
        && user.id === _currentUserAvatarData.id
        ? _currentUserAvatarData
        : null;

    return {
        avatar: buildDiscordAvatarUrl(user.discordId, user.avatar) ?? (user.avatar?.startsWith('http') ? user.avatar : null),
        // Prefer caller's data when explicitly provided (even if null);
        // fall back to overlay only when the field is undefined (not in the DTO).
        customAvatarUrl: user.customAvatarUrl !== undefined ? user.customAvatarUrl : overlay?.customAvatarUrl,
        characters: user.characters !== undefined ? user.characters : overlay?.characters,
        avatarPreference: user.avatarPreference !== undefined ? user.avatarPreference : overlay?.avatarPreference,
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

    // If user has a server-persisted avatar preference, honor it first (ROK-352)
    if (user.avatarPreference) {
        const pref = user.avatarPreference;
        if (pref.type === 'custom' && user.customAvatarUrl) {
            return { url: `${API_BASE_URL}${user.customAvatarUrl}`, type: 'custom' };
        }
        if (pref.type === 'discord' && user.avatar) {
            return { url: user.avatar, type: 'discord' };
        }
        if (pref.type === 'character' && pref.characterName && user.characters) {
            const character = user.characters.find(c => c.name === pref.characterName);
            if (character?.avatarUrl) {
                return { url: character.avatarUrl, type: 'character' };
            }
        }
        // Preferred source unavailable — fall through to default priority
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
