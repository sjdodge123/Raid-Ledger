import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { InterestPlayerPreviewDto } from '@raid-ledger/contract';
import { resolveAvatar, toAvatarUser } from '../../lib/avatar';

interface InterestPlayerAvatarsProps {
    /** Array of interested players from the API */
    players: InterestPlayerPreviewDto[];
    /** Total count of interested players */
    totalCount: number;
    /** Maximum avatars to show before overflow (default 6) */
    maxVisible?: number;
    /** Game ID for the "+N more" overflow link to the filtered players page */
    gameId?: number;
}

const INITIALS_COLORS = [
    'bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-yellow-500', 'bg-lime-500', 'bg-green-500',
    'bg-emerald-500', 'bg-teal-500', 'bg-cyan-500', 'bg-sky-500', 'bg-blue-500', 'bg-indigo-500',
    'bg-violet-500', 'bg-purple-500', 'bg-fuchsia-500', 'bg-pink-500',
];

function getInitialsBg(username: string): string {
    const hash = username.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return INITIALS_COLORS[hash % INITIALS_COLORS.length];
}

function formatCountText(totalCount: number, overflowCount: number) {
    return overflowCount > 0 ? `+${overflowCount} more` : `${totalCount} player${totalCount !== 1 ? 's' : ''} interested`;
}

function PlayerAvatar({ player, index, total }: { player: InterestPlayerPreviewDto; index: number; total: number }) {
    const resolved = resolveAvatar(toAvatarUser(player));
    return (
        <Link key={player.id} to={`/users/${player.id}`} className="block rounded-full ring-2 ring-surface hover:ring-emerald-500/50 transition-all hover:z-10 hover:scale-110 flex-shrink-0"
            style={{ marginLeft: index > 0 ? '-8px' : 0, zIndex: total - index, position: 'relative' }} title={player.username}>
            {resolved.url ? (
                <img src={resolved.url} alt={player.username} className="w-8 h-8 rounded-full object-cover" loading="lazy" />
            ) : (
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-foreground ${getInitialsBg(player.username)}`}>{player.username.charAt(0).toUpperCase()}</div>
            )}
        </Link>
    );
}

function CountLabel({ text, gameId }: { text: string; gameId?: number }) {
    if (gameId) return <Link to={`/players?gameId=${gameId}`} className="text-sm text-emerald-400 hover:text-emerald-300 whitespace-nowrap transition-colors">{text}</Link>;
    return <span className="text-sm text-muted whitespace-nowrap">{text}</span>;
}

export function InterestPlayerAvatars({ players, totalCount, maxVisible = 6, gameId }: InterestPlayerAvatarsProps) {
    const visiblePlayers = useMemo(() => players.slice(0, maxVisible), [players, maxVisible]);
    const overflowCount = totalCount - visiblePlayers.length;

    if (visiblePlayers.length === 0) {
        return <CountLabel text={formatCountText(totalCount, 0)} gameId={gameId} />;
    }

    return (
        <div className="flex items-center gap-2">
            <div className="flex items-center">
                {visiblePlayers.map((player, i) => <PlayerAvatar key={player.id} player={player} index={i} total={visiblePlayers.length} />)}
            </div>
            <CountLabel text={formatCountText(totalCount, overflowCount)} gameId={gameId} />
        </div>
    );
}
