/**
 * PugAvatar - Avatar for PUG players (ROK-262, ROK-292).
 * Shows Discord CDN avatar when available, falls back to initials-based
 * generated avatar with consistent color from username hash.
 */
import { useState } from 'react';

interface PugAvatarProps {
    /** Discord username to derive initials and color from (null for anonymous invite slots) */
    username: string | null;
    /** Discord user ID for CDN avatar URL */
    discordUserId?: string | null;
    /** Discord avatar hash for CDN avatar URL */
    discordAvatarHash?: string | null;
    /** Tailwind size class (default: 'h-10 w-10') */
    sizeClassName?: string;
}

/** Generate a consistent background color from username */
const AVATAR_COLORS = [
    '#ef4444', // red-500
    '#f97316', // orange-500
    '#f59e0b', // amber-500
    '#eab308', // yellow-500
    '#84cc16', // lime-500
    '#22c55e', // green-500
    '#10b981', // emerald-500
    '#14b8a6', // teal-500
    '#06b6d4', // cyan-500
    '#0ea5e9', // sky-500
    '#3b82f6', // blue-500
    '#6366f1', // indigo-500
    '#8b5cf6', // violet-500
    '#a855f7', // purple-500
    '#d946ef', // fuchsia-500
    '#ec4899', // pink-500
];

function getColorFromUsername(username: string): string {
    const hash = username
        .split('')
        .reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function getInitials(username: string): string {
    // Take first character, uppercased
    return username.charAt(0).toUpperCase();
}

/** Build Discord CDN avatar URL from user ID and avatar hash. */
function getDiscordAvatarUrl(userId: string, avatarHash: string): string {
    return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png?size=64`;
}

export function PugAvatar({
    username,
    discordUserId,
    discordAvatarHash,
    sizeClassName = 'h-10 w-10',
}: PugAvatarProps) {
    const [imgError, setImgError] = useState(false);

    const hasDiscordAvatar = discordUserId && discordAvatarHash && !imgError;

    if (hasDiscordAvatar) {
        return (
            <img
                src={getDiscordAvatarUrl(discordUserId, discordAvatarHash)}
                alt={username ?? 'Invite'}
                title={username ?? 'Awaiting player'}
                className={`${sizeClassName} rounded-full shrink-0 object-cover`}
                onError={() => setImgError(true)}
            />
        );
    }

    // Anonymous invite slot: show a link icon placeholder
    if (!username) {
        return (
            <div
                className={`${sizeClassName} rounded-full flex items-center justify-center text-amber-400 bg-amber-500/20 shrink-0`}
                title="Awaiting player"
            >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
            </div>
        );
    }

    const bgColor = getColorFromUsername(username);
    const initials = getInitials(username);

    return (
        <div
            className={`${sizeClassName} rounded-full flex items-center justify-center text-white font-semibold text-sm shrink-0`}
            style={{ backgroundColor: bgColor }}
            title={username}
        >
            {initials}
        </div>
    );
}
