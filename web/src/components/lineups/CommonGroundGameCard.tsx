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
} from '../games/game-card-parts';
import { nominateButtonState, VIEW_ONLY_LABEL } from './nominate-button-state';

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

/** Violet ✨ AI Pick chip rendered on cards blended in from the AI suggester.
 *  ROK-1297 round 5z: native title-tooltip removed; the AI reasoning is
 *  injected into the ★ whyReason line under the card by CommonGroundThemedRow,
 *  so there is no longer a conflicting hover surface. */
function AiBadge(): JSX.Element {
    return (
        <span className="absolute top-2 left-2 z-10 px-2 py-0.5 text-xs font-bold bg-violet-500/90 text-white rounded shadow-sm">
            ✨ AI Pick
        </span>
    );
}

/** Emerald badge for library owner count. */
function OwnerBadge({ count }: { count: number }): JSX.Element {
    return (
        <span className="px-2 py-0.5 text-xs font-bold bg-emerald-500/90 text-white rounded">
            {count} own
        </span>
    );
}

/** Amber badge for wishlist count. */
function WishlistBadge({ count }: { count: number }): JSX.Element | null {
    if (count <= 0) return null;
    return (
        <span className="px-2 py-0.5 text-xs font-bold bg-amber-500/90 text-white rounded">
            {count} wishlisted
        </span>
    );
}

/** Sale/price badge. ROK-1297 round-3: surface "Best Price" when current ≤ lowest. */
function SaleBadge({
    cut,
    price,
    lowestPrice,
}: {
    cut: number | null;
    price: number | null;
    lowestPrice: number | null | undefined;
}): JSX.Element | null {
    if (cut == null || cut <= 0) {
        if (price != null) {
            return (
                <span className="px-2 py-0.5 text-xs font-bold bg-zinc-600/80 text-white rounded">
                    ${price.toFixed(2)}
                </span>
            );
        }
        return null;
    }
    const isBestPrice =
        price != null && lowestPrice != null && price <= lowestPrice;
    if (isBestPrice) {
        return (
            <span className="px-2 py-0.5 text-xs font-bold bg-emerald-500/90 text-white rounded">
                Best Price {price != null ? `· $${price.toFixed(2)}` : ''}
            </span>
        );
    }
    return (
        <span className="px-2 py-0.5 text-xs font-bold bg-emerald-500/90 text-white rounded">
            -{cut}%{price != null ? ` $${price.toFixed(2)}` : ''}
        </span>
    );
}

/** Player count badge (e.g. "1-4 players"). */
function PlayerBadge({ playerCount }: { playerCount: { min: number; max: number } | null }): JSX.Element | null {
    if (!playerCount) return null;
    const { min, max } = playerCount;
    const label = min === max ? `${min}` : `${min}-${max}`;
    return (
        <span className="px-2 py-0.5 text-xs font-bold bg-violet-500/90 text-white rounded">
            {label} {max === 1 ? 'player' : 'players'}
        </span>
    );
}

/** Early access indicator badge. */
function EarlyAccessBadge(): JSX.Element {
    return (
        <span className="px-2 py-0.5 text-xs font-bold bg-blue-500/90 text-white rounded">
            Early Access
        </span>
    );
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

/** Badge row beneath the card title. */
function BadgeRow({ game }: { game: CommonGroundGameDto }): JSX.Element {
    return (
        <div className="flex flex-wrap items-center gap-1 mt-1">
            <OwnerBadge count={game.ownerCount} />
            <PlayerBadge playerCount={game.playerCount} />
            <WishlistBadge count={game.wishlistCount} />
            <SaleBadge
                cut={game.itadCurrentCut}
                price={game.nonOwnerPrice}
                lowestPrice={game.itadLowestPrice}
            />
            {game.earlyAccess && <EarlyAccessBadge />}
        </div>
    );
}

/** Game card for the Common Ground panel. */
export function CommonGroundGameCard({ game, onNominate, isNominating, atCap, viewOnly = false, aiSuggested, hideOverlay, fluid }: Props): JSX.Element {
    const borderCls = aiSuggested
        ? 'border-violet-500/50 hover:border-violet-400/80'
        : 'border-edge/50 hover:border-emerald-500/50';
    const widthCls = fluid ? 'w-full' : 'w-[180px] flex-shrink-0';
    return (
        <div className={`group relative ${widthCls} rounded-xl overflow-hidden bg-panel border ${borderCls} hover:shadow-lg transition-all cursor-pointer`}>
            <div className="relative aspect-[3/4] bg-panel">
                {aiSuggested && <AiBadge />}
                {game.coverUrl
                    ? <CoverImage src={game.coverUrl} alt={game.gameName} />
                    : <CoverPlaceholder />}
                <GradientOverlay />
                <div className="absolute bottom-0 left-0 right-0 p-3">
                    <CardTitle name={game.gameName} />
                    <BadgeRow game={game} />
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
