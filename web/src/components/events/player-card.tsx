/**
 * PlayerCard - Shared component for displaying a player across roster slots,
 * unassigned pool, assignment modal, and attendee list (ROK-210 AC-1).
 *
 * Uses resolveAvatar() via AvatarWithFallback for consistent avatar rendering (AC-2).
 * Uses shared role constants from role-colors.ts for consistent badges (AC-3).
 * Supports compact (roster slots) and default (modal/attendees) sizes (AC-1).
 * Truncated names show full text in title tooltip (AC-6).
 */
import type { RosterAssignmentResponse } from '@raid-ledger/contract';
import { AvatarWithFallback } from '../shared/AvatarWithFallback';
import { toAvatarUser } from '../../lib/avatar';
import type { AvatarUser } from '../../lib/avatar';
import { ROLE_BADGE_CLASSES, ROLE_EMOJI, formatRole } from '../../lib/role-colors';

export interface PlayerCardProps {
    /** Player data from roster assignments */
    player: RosterAssignmentResponse;
    /** Compact for roster slots, default for modal/attendee list */
    size?: 'compact' | 'default';
    /** Whether to display the role badge */
    showRole?: boolean;
    /** Click handler (e.g. assign in modal) */
    onClick?: () => void;
    /** Admin remove handler */
    onRemove?: () => void;
    /** Accent left-border color string (e.g. for matching-role highlight) */
    matchAccent?: string;
}

/** Build an AvatarUser that includes character portrait when available */
function buildAvatarUser(player: RosterAssignmentResponse): {
    avatarUser: AvatarUser;
    gameId: string | undefined;
} {
    const base = toAvatarUser({
        avatar: player.avatar,
        discordId: player.discordId,
        customAvatarUrl: player.customAvatarUrl,
    });
    if (player.character?.avatarUrl) {
        return {
            avatarUser: {
                ...base,
                characters: [{ gameId: '__roster__', avatarUrl: player.character.avatarUrl }],
            } satisfies AvatarUser,
            gameId: '__roster__',
        };
    }
    return { avatarUser: base, gameId: undefined };
}

export function PlayerCard({
    player,
    size = 'default',
    showRole = false,
    onClick,
    onRemove,
    matchAccent,
}: PlayerCardProps) {
    const { avatarUser, gameId } = buildAvatarUser(player);
    const isCompact = size === 'compact';
    const avatarSize = isCompact ? 'h-8 w-8' : 'h-10 w-10';

    const roleBadge = showRole && player.character?.role ? (
        <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${ROLE_BADGE_CLASSES[player.character.role] ?? ROLE_BADGE_CLASSES.player}`}
        >
            {ROLE_EMOJI[player.character.role] ?? ''} {formatRole(player.character.role)}
        </span>
    ) : null;

    const borderStyle = matchAccent
        ? { borderLeft: `3px solid ${matchAccent}` }
        : undefined;

    return (
        <div
            className={`
                flex items-center gap-3 rounded-lg border border-edge bg-panel/50
                ${isCompact ? 'p-2' : 'p-2.5'}
                ${onClick ? 'cursor-pointer hover:bg-panel transition-colors' : 'transition-all'}
            `}
            style={borderStyle}
            onClick={onClick}
            role={onClick ? 'button' : undefined}
            tabIndex={onClick ? 0 : undefined}
            onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
        >
            {/* Avatar - AC-2: resolveAvatar via AvatarWithFallback */}
            <AvatarWithFallback
                user={avatarUser}
                gameId={gameId}
                username={player.username}
                sizeClassName={avatarSize}
            />

            {/* Info - AC-6: truncation with title tooltip */}
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span
                        className="truncate font-medium text-foreground"
                        title={player.username}
                    >
                        {player.username}
                    </span>
                    {roleBadge}
                </div>
                {player.character && (
                    <p
                        className="truncate text-xs text-muted"
                        title={[
                            player.character.name,
                            player.character.className,
                        ].filter(Boolean).join(' \u2022 ')}
                    >
                        {player.character.name}
                        {player.character.className && ` \u2022 ${player.character.className}`}
                    </p>
                )}
            </div>

            {/* Admin remove button */}
            {onRemove && (
                <button
                    onClick={(e) => { e.stopPropagation(); onRemove(); }}
                    className="shrink-0 flex items-center justify-center w-11 h-11 rounded text-dim hover:bg-red-500/20 hover:text-red-400 transition-colors"
                    aria-label={`Remove ${player.username} from slot`}
                    title="Remove from slot"
                >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            )}
        </div>
    );
}
