import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { InterestPlayerPreviewDto } from '@raid-ledger/contract';
import { toAvatarUser } from '../../lib/avatar';
import { AvatarWithFallback } from '../shared/AvatarWithFallback';

interface InterestPlayerAvatarsProps {
    /** Array of interested players from the API */
    players: InterestPlayerPreviewDto[];
    /** Total count of interested players */
    totalCount: number;
    /** Maximum avatars to show before overflow (default 6) */
    maxVisible?: number;
    /** Game ID for the "+N more" overflow link to the filtered players page */
    gameId?: number | undefined;
    /** Custom link URL (overrides default /players?gameId=X) */
    linkTo?: string | undefined;
    /** Custom label formatter (default: "X players interested") */
    formatLabel?: (totalCount: number, overflowCount: number) => string;
}

function formatCountText(totalCount: number, overflowCount: number) {
    return overflowCount > 0 ? `+${overflowCount} more` : `${totalCount} player${totalCount !== 1 ? 's' : ''} interested`;
}

function PlayerAvatar({ player, index, total }: { player: InterestPlayerPreviewDto; index: number; total: number }) {
    return (
        <Link key={player.id} to={`/users/${player.id}`} className="block rounded-full ring-2 ring-surface hover:ring-emerald-500/50 transition-all hover:z-10 hover:scale-110 flex-shrink-0"
            style={{ marginLeft: index > 0 ? '-8px' : 0, zIndex: total - index, position: 'relative' }} title={player.username}>
            {/* ROK-1714: a stale Discord hash falls back to neutral-token initials, never a broken glyph. */}
            <AvatarWithFallback user={toAvatarUser(player)} username={player.username} sizeClassName="w-8 h-8" loading="lazy" />
        </Link>
    );
}

function CountLabel({ text, linkTo }: { text: string; linkTo?: string | undefined }) {
    if (linkTo) return <Link to={linkTo} className="text-sm text-emerald-400 hover:text-emerald-300 whitespace-nowrap transition-colors">{text}</Link>;
    return <span className="text-sm text-muted whitespace-nowrap">{text}</span>;
}

export function InterestPlayerAvatars({ players, totalCount, maxVisible = 6, gameId, linkTo, formatLabel }: InterestPlayerAvatarsProps) {
    const visiblePlayers = useMemo(() => players.slice(0, maxVisible), [players, maxVisible]);
    const overflowCount = totalCount - visiblePlayers.length;
    const labelFn = formatLabel ?? formatCountText;
    const resolvedLink = linkTo ?? (gameId ? `/players?gameId=${gameId}` : undefined);

    if (visiblePlayers.length === 0) {
        return <CountLabel text={labelFn(totalCount, 0)} linkTo={resolvedLink} />;
    }

    return (
        <div className="flex items-center gap-2">
            <div className="flex items-center">
                {visiblePlayers.map((player, i) => <PlayerAvatar key={player.id} player={player} index={i} total={visiblePlayers.length} />)}
            </div>
            <CountLabel text={labelFn(totalCount, overflowCount)} linkTo={resolvedLink} />
        </div>
    );
}
