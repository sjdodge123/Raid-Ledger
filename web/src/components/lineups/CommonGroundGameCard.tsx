/**
 * Game card for the Common Ground panel (ROK-934).
 * Shows ownership counts, pricing, early access badge, and a nominate button.
 */
import type { JSX } from 'react';
import type { CommonGroundGameDto } from '@raid-ledger/contract';
import {
    CoverImage,
    CoverPlaceholder,
    GradientOverlay,
    CardTitle,
    GenreBadge,
    RatingBadge,
} from '../games/game-card-parts';
import { GENRE_MAP } from '../../lib/game-utils';
import { nominateButtonState, VIEW_ONLY_LABEL } from './nominate-button-state';
import { AiBadge, GameBadgeRow } from '../games/game-badges';
import { fromCommonGroundGame } from '../games/game-badges.helpers';

interface Props {
    game: CommonGroundGameDto;
    onNominate: (gameId: number) => void;
    isNominating: boolean;
    atCap: boolean;
    /**
     * ROK-1349: viewer cannot participate (private-lineup non-invitee).
     * Renders a distinct "View only" label instead of "Lineup full".
     */
    viewOnly?: boolean;
    /** ROK-931: mark this card as LLM-suggested with the ✨ AI Pick badge.
     *  The reasoning text is rendered OUTSIDE the card by callers — see the
     *  ★ whyReason line in CommonGroundThemedRow (round 5z). */
    aiSuggested?: boolean;
    /**
     * ROK-1297 rework: suppress the hover-to-reveal Nominate overlay. The
     * Cycle 4 composite wraps the card in its own wrapper that exposes a
     * permanent + Nominate button below, so the overlay becomes visual
     * noise. Default false keeps the legacy CommonGroundPanel behavior.
     */
    hideOverlay?: boolean;
    /**
     * ROK-1297 round-4: render at the parent cell's full width instead of
     * the fixed 180px the legacy CommonGroundPanel needs for its horizontal
     * carousel. Used by the Cycle 4 themed grid so cards scale up with
     * available room (especially on mobile where 180px wastes real estate).
     */
    fluid?: boolean;
}

/** Hover overlay with nominate button. */
function NominateOverlay({
    onNominate,
    isNominating,
    atCap,
    viewOnly,
}: {
    onNominate: () => void;
    isNominating: boolean;
    atCap: boolean;
    viewOnly: boolean;
}): JSX.Element {
    const { label, disabled } = nominateButtonState(atCap, viewOnly, isNominating, {
        compact: true,
        addingLabel: 'Adding...',
    });

    return (
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
            <button
                onClick={(e) => { e.stopPropagation(); onNominate(); }}
                disabled={disabled}
                title={viewOnly ? VIEW_ONLY_LABEL : undefined}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors pointer-events-auto"
            >
                {label}
            </button>
        </div>
    );
}

/** Game card for the Common Ground panel. */
export function CommonGroundGameCard({ game, onNominate, isNominating, atCap, viewOnly = false, aiSuggested, hideOverlay, fluid }: Props): JSX.Element {
    const borderCls = aiSuggested
        ? 'border-violet-500/50 hover:border-violet-400/80'
        : 'border-edge/50 hover:border-emerald-500/50';
    const widthCls = fluid ? 'w-full' : 'w-[180px] flex-shrink-0';
    // ROK-1314 "unify up": same derivation the /games card uses, so a game
    // reads identically on both surfaces.
    const rawRating = game.aggregatedRating ?? game.rating ?? null;
    const rating = rawRating != null && rawRating > 0 ? rawRating : null;
    const primaryGenre = game.genres?.[0] != null
        ? GENRE_MAP[game.genres[0]] ?? null
        : null;
    return (
        <div className={`group relative ${widthCls} rounded-xl overflow-hidden bg-panel border ${borderCls} hover:shadow-lg transition-all cursor-pointer`}>
            <div className="relative aspect-[3/4] bg-panel overflow-hidden">
                {aiSuggested && <AiBadge />}
                {game.coverUrl
                    ? <CoverImage src={game.coverUrl} alt={game.gameName} />
                    : <CoverPlaceholder />}
                {rating != null && <RatingBadge rating={rating} />}
                <GradientOverlay />
                <div className="absolute bottom-0 left-0 right-0 p-3">
                    <CardTitle name={game.gameName} />
                    <div className="flex flex-wrap items-center gap-1 mt-1">
                        {primaryGenre && <GenreBadge label={primaryGenre} />}
                        <GameBadgeRow game={fromCommonGroundGame(game)} variant="full" />
                    </div>
                </div>
                {!hideOverlay && (
                    <NominateOverlay
                        onNominate={() => onNominate(game.gameId)}
                        isNominating={isNominating}
                        atCap={atCap}
                        viewOnly={viewOnly}
                    />
                )}
            </div>
        </div>
    );
}
