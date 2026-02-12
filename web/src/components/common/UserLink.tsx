import { Link } from 'react-router-dom';
import { resolveAvatar, type AvatarUser } from '../../lib/avatar';
import './UserLink.css';

interface UserLinkProps {
    userId: number;
    username: string;
    avatarUrl?: string | null;
    showAvatar?: boolean;
    size?: 'sm' | 'md';
    className?: string;
    /** User object for resolveAvatar() -- when provided, takes priority over avatarUrl (ROK-222) */
    user?: AvatarUser | null;
    /** Game ID for context-aware avatar resolution (ROK-222) */
    gameId?: string;
}

/**
 * Reusable component for clickable user references (ROK-181).
 * Renders as a styled link to the user's profile page.
 * Uses e.stopPropagation() to prevent parent click handlers.
 * ROK-222: Supports resolveAvatar() via user/gameId props with initials fallback.
 */
export function UserLink({
    userId,
    username,
    avatarUrl,
    showAvatar = false,
    size = 'sm',
    className = '',
    user,
    gameId,
}: UserLinkProps) {
    const sizeClass = size === 'sm' ? 'user-link--sm' : 'user-link--md';

    // ROK-222: Use resolveAvatar when user prop is provided, else fall back to avatarUrl
    const effectiveUrl = user
        ? resolveAvatar(user, gameId).url
        : (avatarUrl ?? null);

    return (
        <Link
            to={`/users/${userId}`}
            className={`user-link ${sizeClass} ${className}`}
            onClick={(e) => e.stopPropagation()}
            title={`View ${username}'s profile`}
        >
            {showAvatar && (
                effectiveUrl ? (
                    <img
                        src={effectiveUrl}
                        alt=""
                        className="user-link__avatar"
                        onError={(e) => {
                            e.currentTarget.style.display = 'none';
                        }}
                    />
                ) : (
                    <span className="user-link__avatar user-link__avatar--initials">
                        {username.charAt(0).toUpperCase()}
                    </span>
                )
            )}
            <span className="user-link__name">{username}</span>
        </Link>
    );
}
