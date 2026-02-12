import { useState } from 'react';
import { resolveAvatar, type AvatarUser } from '../../lib/avatar';

interface AvatarWithFallbackProps {
    /** Avatar URL to display, or null/undefined for initials fallback */
    avatarUrl?: string | null | undefined;
    /** Username for alt text and initial generation */
    username: string;
    /** Size classes (defaults to h-8 w-8) */
    sizeClassName?: string;
    /** User object for resolveAvatar() -- when provided, takes priority over avatarUrl (ROK-222) */
    user?: AvatarUser | null;
    /** Game ID for context-aware avatar resolution (ROK-222) */
    gameId?: string;
}

/**
 * Avatar component with automatic fallback to initials on load error.
 * ROK-194: Gracefully handles broken image URLs by showing initials.
 * ROK-222: Accepts optional user/gameId for resolveAvatar() integration.
 */
export function AvatarWithFallback({
    avatarUrl,
    username,
    sizeClassName = 'h-8 w-8',
    user,
    gameId,
}: AvatarWithFallbackProps) {
    const [hasError, setHasError] = useState(false);

    // ROK-222: Use resolveAvatar when user prop is provided
    const effectiveUrl = user
        ? resolveAvatar(user, gameId).url
        : (avatarUrl ?? null);

    const showInitials = !effectiveUrl || hasError;

    if (showInitials) {
        return (
            <div
                className={`${sizeClassName} flex-shrink-0 overflow-hidden rounded-full bg-overlay flex items-center justify-center text-xs font-semibold text-muted`}
            >
                {username.charAt(0).toUpperCase()}
            </div>
        );
    }

    return (
        <div className={`${sizeClassName} flex-shrink-0 overflow-hidden rounded-full bg-overlay`}>
            <img
                src={effectiveUrl}
                alt={username}
                className="h-full w-full object-cover"
                onError={() => setHasError(true)}
            />
        </div>
    );
}
