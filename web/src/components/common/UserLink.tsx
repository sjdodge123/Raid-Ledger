import { Link } from 'react-router-dom';
import './UserLink.css';

interface UserLinkProps {
    userId: number;
    username: string;
    avatarUrl?: string | null;
    showAvatar?: boolean;
    size?: 'sm' | 'md';
    className?: string;
}

/**
 * Reusable component for clickable user references (ROK-181).
 * Renders as a styled link to the user's profile page.
 * Uses e.stopPropagation() to prevent parent click handlers.
 */
export function UserLink({
    userId,
    username,
    avatarUrl,
    showAvatar = false,
    size = 'sm',
    className = '',
}: UserLinkProps) {
    const sizeClass = size === 'sm' ? 'user-link--sm' : 'user-link--md';

    return (
        <Link
            to={`/users/${userId}`}
            className={`user-link ${sizeClass} ${className}`}
            onClick={(e) => e.stopPropagation()}
            title={`View ${username}'s profile`}
        >
            {showAvatar && (
                <img
                    src={avatarUrl || '/default-avatar.svg'}
                    alt=""
                    className="user-link__avatar"
                    onError={(e) => {
                        (e.target as HTMLImageElement).src = '/default-avatar.svg';
                    }}
                />
            )}
            <span className="user-link__name">{username}</span>
        </Link>
    );
}
