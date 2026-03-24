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

interface Props {
    game: CommonGroundGameDto;
    onNominate: (gameId: number) => void;
    isNominating: boolean;
    atCap: boolean;
}

/** Emerald badge for library owner count. */
function OwnerBadge({ count }: { count: number }): JSX.Element {
    return (
        <span className="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-500/90 text-white rounded">
            {count} own
        </span>
    );
}

/** Amber badge for wishlist count. */
function WishlistBadge({ count }: { count: number }): JSX.Element | null {
    if (count <= 0) return null;
    return (
        <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-500/90 text-white rounded">
            {count} wishlisted
        </span>
    );
}

/** Sale/price badge. */
function SaleBadge({ cut, price }: { cut: number | null; price: number | null }): JSX.Element | null {
    if (cut == null || cut <= 0) {
        if (price != null) {
            return (
                <span className="px-1.5 py-0.5 text-[10px] font-bold bg-zinc-600/80 text-white rounded">
                    ${price.toFixed(2)}
                </span>
            );
        }
        return null;
    }
    return (
        <span className="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-500/90 text-white rounded">
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
        <span className="px-1.5 py-0.5 text-[10px] font-bold bg-violet-500/90 text-white rounded">
            {label} {max === 1 ? 'player' : 'players'}
        </span>
    );
}

/** Early access indicator badge. */
function EarlyAccessBadge(): JSX.Element {
    return (
        <span className="px-1.5 py-0.5 text-[10px] font-bold bg-blue-500/90 text-white rounded">
            Early Access
        </span>
    );
}

/** Hover overlay with nominate button. */
function NominateOverlay({
    onNominate,
    isNominating,
    atCap,
}: {
    onNominate: () => void;
    isNominating: boolean;
    atCap: boolean;
}): JSX.Element {
    const disabled = isNominating || atCap;
    const label = atCap ? 'Lineup full' : '+ Nominate';

    return (
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <button
                onClick={(e) => { e.stopPropagation(); onNominate(); }}
                disabled={disabled}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
                {isNominating ? 'Adding...' : label}
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
            <SaleBadge cut={game.itadCurrentCut} price={game.nonOwnerPrice} />
            {game.earlyAccess && <EarlyAccessBadge />}
        </div>
    );
}

/** Game card for the Common Ground panel. */
export function CommonGroundGameCard({ game, onNominate, isNominating, atCap }: Props): JSX.Element {
    return (
        <div className="group relative w-[180px] flex-shrink-0 rounded-xl overflow-hidden bg-panel border border-edge/50 hover:border-emerald-500/50 hover:shadow-lg transition-all cursor-pointer">
            <div className="relative aspect-[3/4] bg-panel">
                {game.coverUrl
                    ? <CoverImage src={game.coverUrl} alt={game.gameName} />
                    : <CoverPlaceholder />}
                <GradientOverlay />
                <div className="absolute bottom-0 left-0 right-0 p-3">
                    <CardTitle name={game.gameName} />
                    <BadgeRow game={game} />
                </div>
                <NominateOverlay
                    onNominate={() => onNominate(game.gameId)}
                    isNominating={isNominating}
                    atCap={atCap}
                />
            </div>
        </div>
    );
}
