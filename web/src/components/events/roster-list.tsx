import type { SignupUserDto, SignupCharacterDto, ConfirmationStatus } from '@raid-ledger/contract';
import { resolveAvatar, toAvatarUser } from '../../lib/avatar';
import { ROLE_BORDER_CLASSES, ROLE_EMOJI } from '../../lib/role-colors';

interface RosterListProps {
    signups: Array<{
        id: number;
        user: SignupUserDto;
        signedUpAt: string;
        character?: SignupCharacterDto | null;
        confirmationStatus?: ConfirmationStatus;
    }>;
    isLoading?: boolean;
    /** Game ID for context-aware avatar resolution (ROK-222) */
    gameId?: string;
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
 * Roster list component displaying signed-up users with avatars
 * and character info when confirmed (ROK-131 AC-6, AC-7).
 * ROK-222: Uses resolveAvatar() for unified avatar resolution.
 */
export function RosterList({ signups, isLoading, gameId }: RosterListProps) {
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
            <div className="text-center py-8 text-dim">
                No signups yet. Be the first to join!
            </div>
        );
    }

    const sorted = [...signups].sort((a, b) =>
        a.user.username.localeCompare(b.user.username, undefined, { sensitivity: 'base' }),
    );

    return (
        <div className="space-y-2">
            {sorted.map((signup) => (
                <RosterItem key={signup.id} signup={signup} gameId={gameId} />
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
    /** Game ID for context-aware avatar resolution (ROK-222) */
    gameId?: string;
}

/**
 * Individual roster item with character info when confirmed (ROK-131).
 * ROK-222: Uses resolveAvatar(toAvatarUser()) for avatar resolution.
 */
function RosterItem({ signup, gameId }: RosterItemProps) {
    const { user, character, confirmationStatus } = signup;
    const isPending = confirmationStatus === 'pending' || !confirmationStatus;
    const isConfirmed = confirmationStatus === 'confirmed' || confirmationStatus === 'changed';
    const roleBorderClass = character?.role
        ? ROLE_BORDER_CLASSES[character.role] || ''
        : '';

    // ROK-222: Resolve avatar through unified pipeline
    const avatarResolved = resolveAvatar(toAvatarUser(user), gameId);

    return (
        <div
            className={`flex items-center gap-3 p-3 bg-panel/50 rounded-lg hover:bg-panel transition-colors border-l-4 ${roleBorderClass || 'border-l-transparent'
                }`}
        >
            {/* Avatar */}
            <div className="relative">
                {avatarResolved.url ? (
                    <img
                        src={avatarResolved.url}
                        alt={user.username}
                        className="w-10 h-10 rounded-full bg-overlay"
                        onError={(e) => {
                            e.currentTarget.style.display = 'none';
                        }}
                    />
                ) : (
                    <div className="w-10 h-10 rounded-full bg-overlay flex items-center justify-center text-sm font-semibold text-muted">
                        {user.username.charAt(0).toUpperCase()}
                    </div>
                )}
                {/* Pending confirmation badge (AC-7) */}
                {isPending && (
                    <span
                        className="absolute -bottom-1 -right-1 text-sm"
                        title="Character not confirmed"
                    >
                        &#10067;
                    </span>
                )}
            </div>

            {/* User and character info */}
            <div className="flex-1 min-w-0">
                {/* Character name shown when confirmed (AC-6) */}
                {isConfirmed && character ? (
                    <>
                        <div className="flex items-center gap-2">
                            <p className="font-medium text-foreground truncate">
                                {character.name}
                            </p>
                            {character.isMain && (
                                <span className="text-yellow-400 text-xs" title="Main Character">
                                    &#11088;
                                </span>
                            )}
                            {character.role && (
                                <span className="text-xs" title={character.role}>
                                    {ROLE_EMOJI[character.role]}
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-dim">
                            <span className="truncate">{user.username}</span>
                            {character.class && (
                                <>
                                    <span>&#183;</span>
                                    <span className="text-muted">{character.class}</span>
                                </>
                            )}
                            {character.spec && (
                                <>
                                    <span className="text-faint">/</span>
                                    <span className="text-muted">{character.spec}</span>
                                </>
                            )}
                            {character.itemLevel && (
                                <>
                                    <span>&#183;</span>
                                    <span className="text-purple-400">{character.itemLevel}</span>
                                </>
                            )}
                        </div>
                    </>
                ) : (
                    <>
                        <p className="font-medium text-foreground truncate">
                            {user.username}
                        </p>
                        <p className="text-sm text-dim">
                            Signed up {formatSignupTime(signup.signedUpAt)}
                            {isPending && (
                                <span className="text-amber-500/80 ml-2">
                                    &#183; Awaiting confirmation
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
                    {confirmationStatus === 'changed' ? '\u{1F504}' : '\u2713'}
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
        <div className="flex items-center gap-3 p-3 bg-panel/50 rounded-lg animate-pulse">
            <div className="w-10 h-10 rounded-full bg-overlay" />
            <div className="flex-1 space-y-2">
                <div className="h-4 bg-overlay rounded w-1/3" />
                <div className="h-3 bg-overlay rounded w-1/4" />
            </div>
        </div>
    );
}
