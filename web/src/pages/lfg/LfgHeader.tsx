/**
 * ROK-1464 AC1 — the group page header.
 *
 * Badges come from the ONE badge module (ROK-1314) via `fromGameDetail`, so
 * ownership/price/co-op wording cannot drift from `/games/:id`. Co-op
 * attribution lives on the game detail page, so the pill links there rather
 * than duplicating the attribution block here (D6).
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { GameDetailDto } from '@raid-ledger/contract';
import { GameBadgeRow } from '../../components/games/game-badges';
import { fromGameDetail } from '../../components/games/game-badges.helpers';
import { LFG_COPY } from './lfg-copy';
import { COVER_INTRINSIC, coverSrcSetProps } from '../../lib/igdb-image';

export interface LfgHeaderProps {
    gameId: number;
    /** Full detail DTO once loaded; the name alone is enough to render. */
    game: GameDetailDto | undefined;
    /** Name from the slug lookup, shown while the detail request is in flight. */
    fallbackName: string;
    /** ROK-2352: a keyed group's name — headlines the page, the game name moves beneath it. */
    title?: string | undefined;
}

/** Box art, when the DTO carries any. Above the fold, so not lazy-loaded. */
function Cover({
    url,
}: {
    url: string | null | undefined;
}): JSX.Element | null {
    if (!url) return null;
    return (
        <img
            src={url}
            alt=""
            width={COVER_INTRINSIC.width}
            height={COVER_INTRINSIC.height}
            decoding="async"
            {...coverSrcSetProps(url, '80px')}
            className="h-28 w-20 flex-shrink-0 rounded-lg object-cover"
        />
    );
}

/** The h1 — a keyed group's name over the game name (ROK-2352), else the game name. */
function HeaderTitle({
    title,
    gameName,
}: {
    title: string | undefined;
    gameName: string;
}): JSX.Element {
    return (
        <>
            <h1 className="text-2xl font-bold text-foreground">
                {title ?? gameName}
            </h1>
            {title !== undefined && (
                <p data-testid="lfg-header-game" className="text-sm text-muted">
                    {gameName}
                </p>
            )}
        </>
    );
}

/** Cover, title, the shared badge row, and the co-op deep link. */
export function LfgHeader({
    gameId,
    game,
    fallbackName,
    title,
}: LfgHeaderProps): JSX.Element {
    return (
        <header data-testid="lfg-header" className="flex items-start gap-4">
            <Cover url={game?.coverUrl} />
            <div className="min-w-0 flex-1 space-y-2">
                <HeaderTitle
                    title={title}
                    gameName={game?.name ?? fallbackName}
                />
                <GameBadgeRow
                    game={fromGameDetail(game ?? {})}
                    variant="full"
                    price="full"
                />
                <Link
                    to={`/games/${gameId}`}
                    className="inline-block text-xs font-semibold text-emerald-400 hover:text-emerald-300"
                >
                    {LFG_COPY.detailsLink}
                </Link>
            </div>
        </header>
    );
}
