import type { SignupUserDto, SignupCharacterDto, ConfirmationStatus } from '@raid-ledger/contract';

interface RosterListProps {
    signups: Array<{
        id: number;
        user: SignupUserDto;
        signedUpAt: string;
        character?: SignupCharacterDto | null;
        confirmationStatus?: ConfirmationStatus;
    }>;
    isLoading?: boolean;
}

/** Role display colors for class-colored borders (AC-6) */
const ROLE_BORDER_COLORS: Record<string, string> = {
    tank: 'border-l-blue-500',
    healer: 'border-l-green-500',
    dps: 'border-l-red-500',
};

/** Role emoji indicators */
const ROLE_ICONS: Record<string, string> = {
    tank: '🛡️',
    healer: '💚',
    dps: '⚔️',
};

/**
 * Build Discord avatar URL from discord ID and avatar hash
 */
function getAvatarUrl(discordId: string, avatar: string | null): string {
    if (!avatar || !discordId) {
        // Discord default avatar based on discordId hash
        const defaultIndex = discordId ? parseInt(discordId.slice(-1), 10) % 5 : 0;
        return `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`;
    }
    // The avatar is already a URL or hash
    if (avatar.startsWith('http')) {
        return avatar;
    }
    return `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.png`;
}

/**
 * Handle avatar load errors with fallback
 */
function handleAvatarError(e: React.SyntheticEvent<HTMLImageElement>, discordId: string) {
    // Fall back to Discord default avatar
    const defaultIndex = discordId ? parseInt(discordId.slice(-1), 10) % 5 : 0;
    e.currentTarget.src = `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`;
}

/**
 * Format the signup time relative to now
 */
function formatSignupTime(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
    }).format(date);
}

/**
 * Roster list component displaying signed-up users with Discord avatars
 * and character info when confirmed (ROK-131 AC-6, AC-7).
 */
export function RosterList({ signups, isLoading }: RosterListProps) {
    if (isLoading) {
        return (
            <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                    <RosterItemSkeleton key={i} />
                ))}
            </div>
        );
    }

    if (signups.length === 0) {
        return (
            <div className="text-center py-8 text-slate-500">
                No signups yet. Be the first to join!
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {signups.map((signup) => (
                <RosterItem key={signup.id} signup={signup} />
            ))}
        </div>
    );
}

interface RosterItemProps {
    signup: {
        id: number;
        user: SignupUserDto;
        signedUpAt: string;
        character?: SignupCharacterDto | null;
        confirmationStatus?: ConfirmationStatus;
    };
}

/**
 * Individual roster item with character info when confirmed (ROK-131).
 */
function RosterItem({ signup }: RosterItemProps) {
    const { user, character, confirmationStatus } = signup;
    const isPending = confirmationStatus === 'pending' || !confirmationStatus;
    const isConfirmed = confirmationStatus === 'confirmed' || confirmationStatus === 'changed';
    const roleBorderClass = character?.role
        ? ROLE_BORDER_COLORS[character.role] || ''
        : '';

    return (
        <div
            className={`flex items-center gap-3 p-3 bg-slate-800/50 rounded-lg hover:bg-slate-800 transition-colors border-l-4 ${roleBorderClass || 'border-l-transparent'
                }`}
        >
            {/* Avatar */}
            <div className="relative">
                <img
                    src={getAvatarUrl(user.discordId, user.avatar)}
                    alt={user.username}
                    className="w-10 h-10 rounded-full bg-slate-700"
                    onError={(e) => handleAvatarError(e, user.discordId)}
                />
                {/* Pending confirmation badge (AC-7) */}
                {isPending && (
                    <span
                        className="absolute -bottom-1 -right-1 text-sm"
                        title="Character not confirmed"
                    >
                        ❓
                    </span>
                )}
            </div>

            {/* User and character info */}
            <div className="flex-1 min-w-0">
                {/* Character name shown when confirmed (AC-6) */}
                {isConfirmed && character ? (
                    <>
                        <div className="flex items-center gap-2">
                            <p className="font-medium text-white truncate">
                                {character.name}
                            </p>
                            {character.isMain && (
                                <span className="text-yellow-400 text-xs" title="Main Character">
                                    ⭐
                                </span>
                            )}
                            {character.role && (
                                <span className="text-xs" title={character.role}>
                                    {ROLE_ICONS[character.role]}
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-slate-500">
                            <span className="truncate">{user.username}</span>
                            {character.class && (
                                <>
                                    <span>·</span>
                                    <span className="text-slate-400">{character.class}</span>
                                </>
                            )}
                            {character.spec && (
                                <>
                                    <span className="text-slate-600">/</span>
                                    <span className="text-slate-400">{character.spec}</span>
                                </>
                            )}
                            {character.itemLevel && (
                                <>
                                    <span>·</span>
                                    <span className="text-purple-400">{character.itemLevel}</span>
                                </>
                            )}
                        </div>
                    </>
                ) : (
                    <>
                        <p className="font-medium text-white truncate">
                            {user.username}
                        </p>
                        <p className="text-sm text-slate-500">
                            Signed up {formatSignupTime(signup.signedUpAt)}
                            {isPending && (
                                <span className="text-amber-500/80 ml-2">
                                    · Awaiting confirmation
                                </span>
                            )}
                        </p>
                    </>
                )}
            </div>

            {/* Confirmation status indicator */}
            {isConfirmed && (
                <span
                    className="text-green-500 text-xs font-medium"
                    title={confirmationStatus === 'changed' ? 'Changed selection' : 'Confirmed'}
                >
                    {confirmationStatus === 'changed' ? '🔄' : '✓'}
                </span>
            )}
        </div>
    );
}

/**
 * Skeleton loader for roster items
 */
function RosterItemSkeleton() {
    return (
        <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-lg animate-pulse">
            <div className="w-10 h-10 rounded-full bg-slate-700" />
            <div className="flex-1 space-y-2">
                <div className="h-4 bg-slate-700 rounded w-1/3" />
                <div className="h-3 bg-slate-700 rounded w-1/4" />
            </div>
        </div>
    );
}
