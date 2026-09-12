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
import type { JSX, ReactNode } from 'react';
import { CoopPill } from '../lineups/CoopPill';
import { PriceTag, ScalarPriceBadge } from './PriceBadge';
import type { GameBadgeData } from './game-badges.helpers';

export { PriceBadge, PriceTag, ScalarPriceBadge } from './PriceBadge';
export { CoopPill } from '../lineups/CoopPill';
export type { GameBadgeData } from './game-badges.helpers';

const BADGE_CLS = 'px-2 py-0.5 text-xs font-bold rounded';

/**
 * ROK-1525 — optional activation for a badge.
 *
 * Absent (every surface but the Discover card today) the badge renders the
 * inert `<span>` it always has, byte for byte: the parity guard and the dedup
 * guard both rest on the vocabulary being identical across surfaces, so this
 * prop is purely additive and never a second implementation.
 *
 * Present, the SAME pill renders inside a `<button>`. A host whose own click
 * target is itself a `<button>` / `<a>` MUST place the row outside it — nesting
 * interactive content is an invalid content model. `CardLfgChip`
 * (`unified-game-card-parts.tsx`) is the sibling-overlay precedent.
 */
export interface BadgeActivation {
    /** What the click applies. The host owns the semantics, not this module. */
    onActivate: () => void;
    /** Screen-reader wording for what the click does. */
    label: string;
}

/** Activation slots `GameBadgeRow` can thread down. Absent slot = inert badge. */
export interface GameBadgeActivation {
    players?: BadgeActivation;
    owners?: BadgeActivation;
}

/**
 * One pill, inert or activatable. Both forms live here so the class string and
 * the children are written ONCE — "same text, same tokens" is then structural
 * rather than a convention someone has to remember.
 *
 * `pointer-events-auto` is load-bearing: a host that overlays this row on top
 * of its own click target passes clicks through with `pointer-events-none`, and
 * the activatable pill is the one thing that must still receive them.
 */
function BadgePill({ cls, activate, children }: {
    cls: string;
    activate?: BadgeActivation;
    children: ReactNode;
}): JSX.Element {
    if (!activate) return <span className={cls}>{children}</span>;
    return (
        <button
            type="button"
            className={`${cls} pointer-events-auto cursor-pointer hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1`}
            aria-label={activate.label}
            onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                activate.onActivate();
            }}
        >
            {children}
        </button>
    );
}

/** Emerald badge for the community library owner count. */
export function OwnerBadge({ count, activate }: {
    count: number;
    activate?: BadgeActivation;
}): JSX.Element {
    return (
        <BadgePill cls={`${BADGE_CLS} bg-emerald-500/90 text-white`} activate={activate}>
            {count} own
        </BadgePill>
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
export function PlayerBadge({ playerCount, activate }: {
    playerCount: { min: number; max: number } | null;
    activate?: BadgeActivation;
}): JSX.Element | null {
    if (!playerCount) return null;
    const { min, max } = playerCount;
    const range = min === max ? `${min}` : `${min}-${max}`;
    return (
        <BadgePill cls={`${BADGE_CLS} bg-violet-500/90 text-white`} activate={activate}>
            {range} {max === 1 ? 'player' : 'players'}
        </BadgePill>
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
            // ROK-1314: NO fallback. `AiSuggestionCard` passes `reasoning` and
            // keeps its tooltip; `CommonGroundGameCard` passes nothing and must
            // therefore render no `title` at all — ROK-1297 round-5z removed
            // that hover surface deliberately because the reasoning is shown in
            // the ★ whyReason line under the card instead. A `?? 'Suggested by
            // AI'` fallback silently re-added it (caught in review).
            title={reasoning}
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
function OwnershipPills({ game, full, owners }: {
    game: GameBadgeData;
    full: boolean;
    owners?: BadgeActivation;
}): JSX.Element {
    return (
        <>
            {game.currentUserOwns && <YouOwnBadge />}
            {game.ownerCount != null && (
                <OwnerBadge count={game.ownerCount} activate={owners} />
            )}
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

/** The `full`-variant tail: player count, early access, co-op. Compact drops it. */
function FullRowTail({ game, players }: {
    game: GameBadgeData;
    players?: BadgeActivation;
}): JSX.Element {
    return (
        <>
            <PlayerBadge playerCount={game.playerCount} activate={players} />
            {game.earlyAccess && <EarlyAccessBadge />}
            <CoopPill
                cooptimusOnlineMax={game.cooptimusOnlineMax}
                cooptimusCouchMax={game.cooptimusCouchMax}
                cooptimusComboCoop={game.cooptimusComboCoop}
            />
        </>
    );
}

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
    activation,
}: {
    game: GameBadgeData;
    variant?: GameBadgeRowVariant;
    className?: string;
    /** Opt down when the host surface prints price information itself. */
    price?: GameBadgeRowPrice;
    /**
     * ROK-1525: per-badge activation. Only the ownership aggregate and the
     * player count take one — `RowPrice` and `CoopPill` stay inert, and a host
     * that supplies nothing gets today's markup unchanged.
     */
    activation?: GameBadgeActivation;
}): JSX.Element {
    const full = variant === 'full';
    return (
        <div className={`flex flex-wrap items-center gap-1 ${className}`}>
            <OwnershipPills game={game} full={full} owners={activation?.owners} />
            <RowPrice game={game} mode={price} />
            {full && <FullRowTail game={game} players={activation?.players} />}
        </div>
    );
}
