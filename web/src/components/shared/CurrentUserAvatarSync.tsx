import { useEffect } from 'react';
import { useAuth } from '../../hooks/use-auth';
import { setCurrentUserAvatarData } from '../../lib/avatar';

/**
 * Headless component that syncs the current user's avatar preference data
 * into the avatar module's global cache (ROK-352).
 *
 * This allows toAvatarUser() to automatically overlay the current user's
 * avatarPreference and characters onto any DTO that matches by id,
 * so their avatar preference is honored everywhere in the app — not just
 * in components that use useAuth() directly.
 *
 * Mount once in Layout. Renders nothing.
 */
export function CurrentUserAvatarSync(): null {
    const { user } = useAuth();

    useEffect(() => {
        if (user) {
            setCurrentUserAvatarData({
                id: user.id,
                avatarPreference: user.avatarPreference,
                characters: user.characters,
                customAvatarUrl: user.customAvatarUrl,
            });
        } else {
            setCurrentUserAvatarData(null);
        }
    }, [user]);

    // Clear on unmount (e.g., if Layout unmounts — unlikely but clean)
    useEffect(() => {
        return () => setCurrentUserAvatarData(null);
    }, []);

    return null;
}
