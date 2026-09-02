/**
 * ROK-1314 — the ONE game badge module.
 *
 * Before this file there were four price treatments and four ownership
 * treatments spread across `CommonGroundGameCard`, the dead lineup badge
 * module, `NominationCard` and `AiSuggestionCard`, each with its own wording, colour
 * and size. Every game surface now composes `GameBadgeRow` from these
 * primitives, so a badge can only drift in one place.
 *
 * Two rules this module exists to enforce:
 *   • Price wording is locked to `Best Price` / `On Sale` from
 *     `getPriceBadgeType` (spec §0) — re-exported here, never re-implemented.
 *   • Personalized pills render ALONGSIDE the aggregates, never instead of
 *     them: `[You own] [3 own] [You wishlisted] [2 wishlisted] [On Sale · $19.99]`.
 */
import type { JSX } from 'react';
import { CoopPill } from '../lineups/CoopPill';
import { PriceTag, ScalarPriceBadge } from './PriceBadge';
import type { GameBadgeData } from './game-badges.helpers';

export { PriceBadge, PriceTag, ScalarPriceBadge } from './PriceBadge';
export { CoopPill } from '../lineups/CoopPill';
export type { GameBadgeData } from './game-badges.helpers';

const BADGE_CLS = 'px-2 py-0.5 text-xs font-bold rounded';

/** Emerald badge for the community library owner count. */
export function OwnerBadge({ count }: { count: number }): JSX.Element {
    return (
        <span className={`${BADGE_CLS} bg-emerald-500/90 text-white`}>
            {count} own
        </span>
    );
}

/**
 * Cyan/teal personalized pill. Renders only when the viewer owns the game —
 * and always IN ADDITION to `OwnerBadge`, never in place of it (spec §7.3).
 */
export function YouOwnBadge(): JSX.Element {
    return (
        <span
            data-testid="you-own-badge"
            className={`${BADGE_CLS} bg-cyan-500/90 text-white`}
        >
            You own
        </span>
    );
}

/** Amber badge for the community wishlist count. Nothing when nobody has it. */
export function WishlistBadge({ count }: { count: number }): JSX.Element | null {
    if (count <= 0) return null;
    return (
        <span className={`${BADGE_CLS} bg-amber-500/90 text-white`}>
            {count} wishlisted
        </span>
    );
}

/**
 * Tonal-amber personalized pill for the viewer's own wishlist.
 *
 * Stays tonally distinct from `WishlistBadge` (amber-500) by going LIGHTER
 * (amber-300) with dark text, rather than by going translucent. The original
 * `bg-amber-300/20 text-amber-300` measured **1.02:1** against a bright cover
 * — the same luminance as the artwork behind it, so it disappeared entirely on
 * light game art while looking fine on dark art. A solid fill with amber-950
 * text measures ~10.3:1 and matches the opaque treatment every sibling badge
 * already uses.
 */
export function YouWishlistedBadge(): JSX.Element {
    return (
        <span
            data-testid="you-wishlisted-badge"
            className={`${BADGE_CLS} bg-amber-300/95 text-amber-950`}
        >
            You wishlisted
        </span>
    );
}

/**
 * Neutral "Carried Over" marker for an entry rolled forward from a prior
 * lineup. Lived inline in `NominationCard` as a one-off pill in a shape no
 * other badge used; folded in here so the nomination card has no bespoke
 * badges left (ROK-1314).
 */
export function CarriedOverBadge(): JSX.Element {
    return (
        <span
            data-testid="carried-over-badge"
            className={`${BADGE_CLS} bg-zinc-600/90 text-white`}
        >
            Carried Over
        </span>
    );
}

/**
 * Violet player-count badge. Singular-aware: a 1-player game reads
 * `1 player`, not `1 players` (CommonGround's behaviour won over the
 * dead lineup badge module's always-plural drift — spec §1.4).
 */
export function PlayerBadge({ playerCount }: {
    playerCount: { min: number; max: number } | null;
}): JSX.Element | null {
    if (!playerCount) return null;
    const { min, max } = playerCount;
    const range = min === max ? `${min}` : `${min}-${max}`;
    return (
        <span className={`${BADGE_CLS} bg-violet-500/90 text-white`}>
            {range} {max === 1 ? 'player' : 'players'}
        </span>
    );
}

/** Blue early-access indicator. */
export function EarlyAccessBadge(): JSX.Element {
    return (
        <span className={`${BADGE_CLS} bg-blue-500/90 text-white`}>
            Early Access
        </span>
    );
}

/**
 * Violet ✨ AI Pick chip (spec §5.4 — EXTRACTION ONLY, no visual change).
 *
 * Reproduces `AiSuggestionCard`'s richer form. `CommonGroundGameCard` calls it
 * WITHOUT `reasoning`, preserving ROK-1297 round-5z's deliberate removal of
 * that hover surface (the reasoning is rendered on the ★ whyReason line
 * instead, so a native tooltip there would conflict).
 */
export function AiBadge({ reasoning }: { reasoning?: string }): JSX.Element {
    return (
        <span
            className="absolute top-2 left-2 z-10 text-[10px] font-semibold tracking-wide uppercase bg-violet-500/90 text-white rounded-full px-2 py-0.5 shadow-sm"
            title={reasoning ?? 'Suggested by AI'}
        >
            ✨ AI Pick
        </span>
    );
}

/**
 * Price element: the locked sale badge, else the neutral plain-price tag.
 *
 * `mode` exists because two hosts already print price information of their own
 * and would otherwise show the same number twice:
 *   `full`  — badge + `$` figure (the default).
 *   `label` — locked vocabulary only, no figure (nomination card, whose body
 *             prints `$14.99 (-50%) for 4`).
 *   `none`  — no price element at all (unified card, which renders its own
 *             `PriceBadge` from the richer ITAD pricing payload).
 */
function RowPrice({ game, mode }: {
    game: GameBadgeData;
    mode: GameBadgeRowPrice;
}): JSX.Element | null {
    if (mode === 'none') return null;
    if (game.cut != null && game.cut > 0) {
        return (
            <ScalarPriceBadge
                cut={game.cut}
                price={game.price}
                lowestPrice={game.lowestPrice}
                showPrice={mode === 'full'}
            />
        );
    }
    return mode === 'full' ? <PriceTag price={game.price} /> : null;
}

/**
 * Ownership + wishlist cluster. The personalized pills sit IMMEDIATELY beside
 * their aggregate and never replace it (spec §5.1/§7.3) — keeping them in one
 * component is what makes that ordering impossible to break by accident.
 */
function OwnershipPills({ game, full }: {
    game: GameBadgeData;
    full: boolean;
}): JSX.Element {
    return (
        <>
            {game.currentUserOwns && <YouOwnBadge />}
            {game.ownerCount != null && <OwnerBadge count={game.ownerCount} />}
            {game.currentUserWishlisted && <YouWishlistedBadge />}
            {full && game.wishlistCount != null && (
                <WishlistBadge count={game.wishlistCount} />
            )}
        </>
    );
}

export type GameBadgeRowVariant = 'compact' | 'full';

/** How much price information the row prints — see {@link RowPrice}. */
export type GameBadgeRowPrice = 'full' | 'label' | 'none';

/**
 * The one composed badge strip every game surface renders (spec §5.3).
 *
 * `compact` drops the wishlist aggregate, player count, early access and the
 * co-op pill so a 180px card still wraps instead of clipping; `full` renders
 * everything. Both keep the personalized pills — those are the point.
 */
export function GameBadgeRow({
    game,
    variant = 'full',
    className = '',
    price = 'full',
}: {
    game: GameBadgeData;
    variant?: GameBadgeRowVariant;
    className?: string;
    /** Opt down when the host surface prints price information itself. */
    price?: GameBadgeRowPrice;
}): JSX.Element {
    const full = variant === 'full';
    return (
        <div className={`flex flex-wrap items-center gap-1 ${className}`}>
            <OwnershipPills game={game} full={full} />
            <RowPrice game={game} mode={price} />
            {full && <PlayerBadge playerCount={game.playerCount} />}
            {full && game.earlyAccess && <EarlyAccessBadge />}
            {full && (
                <CoopPill
                    cooptimusOnlineMax={game.cooptimusOnlineMax}
                    cooptimusCouchMax={game.cooptimusCouchMax}
                    cooptimusComboCoop={game.cooptimusComboCoop}
                />
            )}
        </div>
    );
}
