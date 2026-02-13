/**
 * PugAvatar - Generated SVG avatar for PUG players (ROK-262).
 * Uses initials-based avatar with consistent color from username hash,
 * following the same pattern as InterestPlayerAvatars.
 */

interface PugAvatarProps {
    /** Discord username to derive initials and color from */
    username: string;
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

export function PugAvatar({
    username,
    sizeClassName = 'h-10 w-10',
}: PugAvatarProps) {
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
