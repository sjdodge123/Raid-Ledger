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
import { Link } from 'react-router-dom';
import { AvatarWithFallback } from '../shared/AvatarWithFallback';
import { toAvatarUser } from '../../lib/avatar';
import type { AvatarUser } from '../../lib/avatar';
import { formatRole } from '../../lib/role-colors';
import { getClassIconUrl } from '../../plugins/wow/lib/class-icons';
import { RoleIcon } from '../shared/RoleIcon';

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
        id: player.userId,
        avatar: player.avatar,
        discordId: player.discordId,
        customAvatarUrl: player.customAvatarUrl,
    });
    if (player.character?.avatarUrl) {
        return {
            avatarUser: {
                ...base,
                characters: [
                    ...(base.characters ?? []),
                    { gameId: '__roster__', avatarUrl: player.character.avatarUrl },
                ],
            } satisfies AvatarUser,
            gameId: '__roster__',
        };
    }
    return { avatarUser: base, gameId: undefined };
}

function PlayerNameLink({ player }: { player: RosterAssignmentResponse }) {
    return (
        <Link
            to={`/users/${player.userId}`}
            state={player.userId === 0 ? {
                guest: true, username: player.username,
                discordId: player.discordId, avatarHash: player.avatar,
            } : undefined}
            className="truncate font-medium text-foreground hover:text-indigo-400 transition-colors"
            title={player.username} onClick={(e) => e.stopPropagation()}>
            {player.username}
        </Link>
    );
}

function FlexibilityBadges({ preferredRoles }: { preferredRoles: string[] }) {
    return (
        <span className="flex shrink-0 items-center gap-0.5" title={`Prefers: ${preferredRoles.map(formatRole).join(', ')}`}>
            {preferredRoles.map((r) => (
                <span key={r} className="inline-flex items-center"><RoleIcon role={r} size="w-5 h-5" /></span>
            ))}
        </span>
    );
}

function PlayerCharacterInfo({ player }: { player: RosterAssignmentResponse }) {
    if (!player.character) return null;
    return (
        <p className="flex items-center gap-1 truncate text-xs text-muted"
            title={[player.character.name, player.character.className].filter(Boolean).join(' \u2022 ')}>
            {getClassIconUrl(player.character.className) && (
                <img src={getClassIconUrl(player.character.className)!} alt="" className="w-3.5 h-3.5 rounded-sm flex-shrink-0" />
            )}
            <span className="truncate">
                {player.character.name}
                {player.character.className && ` \u2022 ${player.character.className}`}
            </span>
        </p>
    );
}

function RemoveButton({ username, onRemove }: { username: string; onRemove: () => void }) {
    return (
        <button onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="shrink-0 flex items-center justify-center w-11 h-11 rounded text-dim hover:bg-red-500/20 hover:text-red-400 transition-colors"
            aria-label={`Remove ${username} from slot`} title="Remove from slot">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
        </button>
    );
}

export function PlayerCard({ player, size = 'default', onClick, onRemove, matchAccent }: PlayerCardProps) {
    const { avatarUser, gameId } = buildAvatarUser(player);
    const isCompact = size === 'compact';
    const avatarSize = isCompact ? 'h-8 w-8' : 'h-10 w-10';
    const isTentative = player.signupStatus === 'tentative';
    const preferredRoleBadges = player.preferredRoles && player.preferredRoles.length > 0 ? player.preferredRoles : null;
    const borderStyle = matchAccent ? { borderLeft: `3px solid ${matchAccent}` } : undefined;

    return (
        <div className={`flex items-center gap-3 rounded-lg border border-edge bg-panel/50
                ${isCompact ? 'p-2' : 'p-2.5'}
                ${onClick ? 'cursor-pointer hover:bg-panel transition-colors' : 'transition-all'}`}
            style={borderStyle} onClick={onClick}
            role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
            onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}>
            <AvatarWithFallback user={avatarUser} gameId={gameId} username={player.username} sizeClassName={avatarSize} />
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                    <PlayerNameLink player={player} />
                    {isTentative && (
                        <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-400" title="Tentative — may not attend">&#x23F3;</span>
                    )}
                    {preferredRoleBadges && <FlexibilityBadges preferredRoles={preferredRoleBadges} />}
                </div>
                <PlayerCharacterInfo player={player} />
            </div>
            {onRemove && <RemoveButton username={player.username} onRemove={onRemove} />}
        </div>
    );
}
