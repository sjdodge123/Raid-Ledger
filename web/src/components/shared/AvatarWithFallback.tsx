import { useState } from 'react';

interface AvatarWithFallbackProps {
    /** Avatar URL to display, or null/undefined for initials fallback */
    avatarUrl: string | null | undefined;
    /** Username for alt text and initial generation */
    username: string;
    /** Size classes (defaults to h-8 w-8) */
    sizeClassName?: string;
}

/**
 * Avatar component with automatic fallback to initials on load error.
 * ROK-194: Gracefully handles broken image URLs by showing initials.
 */
export function AvatarWithFallback({
    avatarUrl,
    username,
    sizeClassName = 'h-8 w-8',
}: AvatarWithFallbackProps) {
    const [hasError, setHasError] = useState(false);

    const showInitials = !avatarUrl || hasError;

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
                src={avatarUrl}
                alt={username}
                className="h-full w-full object-cover"
                onError={() => setHasError(true)}
            />
        </div>
    );
}
