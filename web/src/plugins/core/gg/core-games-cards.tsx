/** Core GG cards 6 + 7 (ROK-2187): top games (with the trailer) and new games tried. */
import type { JSX } from 'react';
import type { GgCardProps } from '../../gg-cards';
import { GgCardBody, GgKicker, GgLede, GgRankRow, GgTitle } from '../../../components/gg/gg-card-parts';
import { GgTrailer } from '../../../components/gg/gg-trailer';
import { ggHours } from '../../../components/gg/gg-format';

interface GameRef { gameId: number; name: string; coverUrl?: string | null | undefined }
interface TopGames { games: (GameRef & { seconds: number })[] }
interface NewGames { count: number; games: GameRef[] }

/** Card 6 — top games; the #1 game's trailer sits under the list. */
export function GgTopGamesCardView({ payload }: GgCardProps<TopGames>): JSX.Element {
    const total = payload.games.reduce((s, g) => s + g.seconds, 0);
    const top = payload.games[0];
    return (
        <GgCardBody>
            <GgKicker>Top games</GgKicker>
            <GgTitle>{ggHours(total)} across {payload.games.length} games</GgTitle>
            <ol className="flex flex-col gap-1.5">
                {payload.games.map((g, i) => <GgRankRow key={g.gameId} rank={i + 1} name={g.name} value={ggHours(g.seconds)} />)}
            </ol>
            {top && <GgTrailer gameId={top.gameId} gameName={top.name} />}
        </GgCardBody>
    );
}

/** Card 7 — new games tried. */
export function GgNewGamesCardView({ payload }: GgCardProps<NewGames>): JSX.Element {
    return (
        <GgCardBody>
            <GgKicker>New games</GgKicker>
            <GgTitle>{payload.count} new {payload.count === 1 ? 'game' : 'games'} tried</GgTitle>
            <ul className="flex flex-col gap-1.5">
                {payload.games.map((g) => <li key={g.gameId} className="rounded-lg bg-panel/80 px-3 py-2 font-medium text-foreground">{g.name}</li>)}
            </ul>
            <GgLede>Never stop exploring.</GgLede>
        </GgCardBody>
    );
}
