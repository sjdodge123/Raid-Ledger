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
    gameId?: number | string | undefined;
    /** Image loading hint (ROK-1714) */
    loading?: 'lazy' | 'eager' | undefined;
    /** Alt text (defaults to username; pass "" for decorative avatars) (ROK-1714) */
    alt?: string | undefined;
}

function InitialsFallback({ username, sizeClassName }: { username: string; sizeClassName: string }) {
    return (
        <div
            className={`${sizeClassName} flex-shrink-0 overflow-hidden rounded-full bg-overlay flex items-center justify-center text-xs font-semibold text-muted`}
        >
            {username.charAt(0).toUpperCase()}
        </div>
    );
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
    loading,
    alt,
}: AvatarWithFallbackProps) {
    // ROK-1714: tracked per URL, so a recycled row with a new src gets a fresh load attempt.
    const [failedUrl, setFailedUrl] = useState<string | null>(null);

    const effectiveUrl = user ? resolveAvatar(user, gameId).url : (avatarUrl ?? null);

    if (!effectiveUrl || failedUrl === effectiveUrl) {
        return <InitialsFallback username={username} sizeClassName={sizeClassName} />;
    }

    return (
        <div className={`${sizeClassName} flex-shrink-0 overflow-hidden rounded-full bg-overlay`}>
            <img
                src={effectiveUrl}
                alt={alt ?? username}
                className="h-full w-full object-cover"
                loading={loading}
                onError={() => setFailedUrl(effectiveUrl)}
            />
        </div>
    );
}
