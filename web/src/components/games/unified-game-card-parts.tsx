/**
 * Cover-side presentation for `UnifiedGameCard`, split out under ROK-1314.
 *
 * The card file sat at 278/300 counted lines, so the badge row could not grow
 * to carry the new personalization pills without breaking the ESLint cap.
 * These three components are pure presentation — no hooks, no data fetching —
 * which is exactly the seam that keeps both files small.
 */
import type { JSX } from 'react';
import type { ItadGamePricingDto } from '@raid-ledger/contract';
import { PriceBadge } from './PriceBadge';
import { SteamIcon } from '../icons/SteamIcon';
import { GameBadgeRow } from './game-badges';
import { LfgChip } from '../lfg/lfg-chip';
import { useLfgGroup } from '../../hooks/lfg-groups-context';
import { fromGameDetail, type GameDetailBadgeInput } from './game-badges.helpers';
import {
    CoverImage,
    CoverPlaceholder,
    RatingBadge,
    GradientOverlay,
    CardTitle,
    GenreBadge,
    HeartIcon,
} from './game-card-parts';

/** Minimal game shape accepted by UnifiedGameCard. */
export interface GameProps {
    id: number;
    name: string;
    slug: string;
    coverUrl: string | null;
    genres?: number[];
    aggregatedRating?: number | null;
    rating?: number | null;
    /** When present, renders a small Steam badge on the card cover. */
    steamAppId?: number | null;
    /** ROK-1399: max online co-op players (Co-Optimus). Drives the info-bar co-op badge. */
    cooptimusOnlineMax?: number | null;
    /** ROK-1399: max couch/local co-op players (Co-Optimus). */
    cooptimusCouchMax?: number | null;
    /**
     * ROK-1401: Co-Optimus `Combo Co-Op (Local + Online)` flag. Additive —
     * a stale cached row without it simply falls through to online/local.
     */
    cooptimusComboCoop?: boolean | null;
    /** ROK-1314: does the CURRENT viewer own this game? Absent ⇒ no pill. */
    currentUserOwns?: boolean;
    /** ROK-1314: has the CURRENT viewer wishlisted this game? */
    currentUserWishlisted?: boolean;
    /**
     * ROK-1314 follow-up: community-wide Steam-ownership tally, so the card
     * renders `[You own] [N own]` and not the pill alone. Absent ⇒ no
     * aggregate badge (a stale cached row must not render a wrong `0`).
     *
     * Distinct from the heart count on the heart button: that is want-to-play
     * (`manual` hearts included), this is `steam_library` ownership only.
     */
    ownerCount?: number;
    /** ROK-1314 follow-up: community-wide Steam-wishlist tally. */
    wishlistCount?: number;
}

/** Corner chip marking a game as purchasable on Steam. */
function SteamAvailableChip(): JSX.Element {
    return (
        <span
            data-testid="card-steam-badge"
            aria-label="Available on Steam"
            className="ml-auto inline-flex items-center justify-center w-5 h-5 rounded-full bg-black/50 text-emerald-300"
        >
            <SteamIcon className="w-3 h-3" />
        </span>
    );
}

/**
 * Genre + price + optional Steam-available badge row below the card title.
 *
 * ROK-1314: the viewer's own `You own` / `You wishlisted` pills join this row
 * via the shared `GameBadgeRow`. Price stays `none` here because the card
 * already renders `PriceBadge` from the richer ITAD pricing payload — the row
 * would otherwise print the same sale twice.
 *
 */
function CardBadgeRow({
    primaryGenre,
    pricing,
    hasSteamAppId,
    personalization,
}: {
    primaryGenre: string | null;
    pricing: ItadGamePricingDto | null | undefined;
    hasSteamAppId: boolean;
    personalization: GameDetailBadgeInput;
}): JSX.Element {
    return (
        <div className="flex flex-wrap items-center gap-1.5 mt-1">
            {primaryGenre && <GenreBadge label={primaryGenre} />}
            <PriceBadge pricing={pricing ?? null} />
            <GameBadgeRow
                game={fromGameDetail(personalization)}
                variant="full"
                price="none"
            />
            {hasSteamAppId && <SteamAvailableChip />}
        </div>
    );
}

/**
 * ROK-1453: the LFG chip as a card-level overlay.
 *
 * It sits OUTSIDE the tile's `<Link>` (rendered as its sibling by
 * `UnifiedGameCard`) because interactive content nested inside an anchor is an
 * invalid content model — the chip is itself activatable. Counts arrive
 * out-of-band by game id from the page-level `GET /lfg`, so on a page with no
 * `LfgGroupsProvider` the lookup yields `undefined` and nothing renders.
 *
 * Positioned below the heart button (`top-1 left-1`, 44px tall) so it collides
 * with neither the heart, the rating badge (top-right) nor the badge row
 * (bottom).
 */
export function CardLfgChip({ game }: { game: GameProps }): JSX.Element | null {
    const lfgGroup = useLfgGroup(game.id);
    if (!lfgGroup) return null;
    return (
        <div className="absolute top-14 left-1 z-10">
            <LfgChip
                activeCount={lfgGroup.activeCount}
                viabilityThreshold={lfgGroup.viabilityThreshold}
                state={lfgGroup.state}
                gameSlug={game.slug}
            />
        </div>
    );
}

/** Cover image or placeholder. */
function CardCover({ game }: { game: GameProps }): JSX.Element {
    if (game.coverUrl) return <CoverImage src={game.coverUrl} alt={game.name} />;
    return <CoverPlaceholder />;
}

/** Inner content: cover image, overlays, badges. */
export function CardCoverContent({
    game,
    rating,
    showRating,
    primaryGenre,
    pricing,
    variant,
    selected,
}: {
    game: GameProps;
    rating: number | null;
    showRating: boolean;
    primaryGenre: string | null;
    pricing: ItadGamePricingDto | null | undefined;
    variant: 'link' | 'toggle';
    selected: boolean;
}): JSX.Element {
    return (
        // `overflow-hidden` is load-bearing, not cosmetic (ROK-1401): the cover
        // is `absolute inset-0` and grows to `scale-105` on group hover. Without
        // clipping here the extra 2.5% spills PAST the cover box, and because an
        // absolutely-positioned child paints above its statically-positioned
        // siblings, that spill lands on top of the InfoBar footer as a bright
        // full-width band. The card's own `overflow-hidden` only clips at the
        // outer edge, so it never caught this. Regression-pinned in
        // unified-game-card.test.tsx.
        <div className="relative aspect-[3/4] bg-panel overflow-hidden">
            <CardCover game={game} />
            {showRating && rating != null && <RatingBadge rating={rating} />}
            <GradientOverlay />
            <div className="absolute bottom-0 left-0 right-0 p-3">
                <CardTitle name={game.name} />
                <CardBadgeRow
                    primaryGenre={primaryGenre}
                    pricing={pricing}
                    hasSteamAppId={game.steamAppId != null}
                    personalization={game}
                />
            </div>
            {variant === 'toggle' && <HeartIcon selected={selected} />}
        </div>
    );
}

