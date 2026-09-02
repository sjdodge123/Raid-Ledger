/**
 * ROK-1314 — per-DTO adapters for the universal badge row (spec §5.3).
 *
 * `GameBadgeRow` renders a normalized `GameBadgeData` view-model, never a raw
 * DTO, so the four game-shaped DTOs can drift independently without every
 * badge component having to know about all of them. One tiny adapter per DTO
 * is the whole coupling surface.
 *
 * Personalization fields are `.optional()` on the wire, so `undefined` is
 * normalized to `false` here (stale-client case, spec §7.4) — personalization
 * degrades, aggregates do not.
 */
import type {
    CommonGroundGameDto,
    GameDetailDto,
    LineupEntryResponseDto,
    VetoStatusDto,
} from '@raid-ledger/contract';

/** A veto card as it arrives on `VetoStatusDto` (the schema is not exported). */
export type VetoGameCardData = VetoStatusDto['games'][number];

/** Normalized view-model every game surface feeds `GameBadgeRow`. */
export interface GameBadgeData {
    /** Community owner count. `null` means the surface carries no aggregate. */
    ownerCount: number | null;
    /** Community wishlist count. `null` / `<= 0` renders nothing. */
    wishlistCount: number | null;
    /** ROK-1314: does the CURRENT viewer own this game? */
    currentUserOwns: boolean;
    /** ROK-1314: has the CURRENT viewer wishlisted this game? */
    currentUserWishlisted: boolean;
    /** Current best price. */
    price: number | null;
    /** Current discount percentage (0-100). */
    cut: number | null;
    /** Historical lowest ITAD price. */
    lowestPrice: number | null;
    playerCount: { min: number; max: number } | null;
    earlyAccess: boolean;
    cooptimusOnlineMax: number | null;
    cooptimusCouchMax: number | null;
    cooptimusComboCoop: boolean | null;
}

/** Shared defaults so each adapter only states what its DTO actually carries. */
const EMPTY: GameBadgeData = {
    ownerCount: null,
    wishlistCount: null,
    currentUserOwns: false,
    currentUserWishlisted: false,
    price: null,
    cut: null,
    lowestPrice: null,
    playerCount: null,
    earlyAccess: false,
    cooptimusOnlineMax: null,
    cooptimusCouchMax: null,
    cooptimusComboCoop: null,
};

/** Common Ground nominate tile → badge view-model. */
export function fromCommonGroundGame(game: CommonGroundGameDto): GameBadgeData {
    return {
        ...EMPTY,
        ownerCount: game.ownerCount,
        wishlistCount: game.wishlistCount,
        currentUserOwns: game.currentUserOwns === true,
        currentUserWishlisted: game.currentUserWishlisted === true,
        price: game.nonOwnerPrice,
        cut: game.itadCurrentCut,
        lowestPrice: game.itadLowestPrice ?? null,
        playerCount: game.playerCount,
        earlyAccess: game.earlyAccess,
        cooptimusOnlineMax: game.cooptimusOnlineMax ?? null,
        cooptimusCouchMax: game.cooptimusCouchMax ?? null,
        cooptimusComboCoop: game.cooptimusComboCoop ?? null,
    };
}

/** Community-lineup nomination card → badge view-model. */
export function fromLineupEntry(entry: LineupEntryResponseDto): GameBadgeData {
    return {
        ...EMPTY,
        ownerCount: entry.ownerCount,
        wishlistCount: entry.wishlistCount,
        currentUserOwns: entry.currentUserOwns === true,
        currentUserWishlisted: entry.currentUserWishlisted === true,
        price: entry.itadCurrentPrice,
        cut: entry.itadCurrentCut,
        lowestPrice: entry.itadLowestPrice ?? null,
        playerCount: entry.playerCount,
        earlyAccess: entry.earlyAccess === true,
        cooptimusOnlineMax: entry.cooptimusOnlineMax ?? null,
        cooptimusCouchMax: entry.cooptimusCouchMax ?? null,
        cooptimusComboCoop: entry.cooptimusComboCoop ?? null,
    };
}

/**
 * Structural subset of `GameDetailDto` the badge row actually reads.
 *
 * Declared as a `Partial<Pick<...>>` rather than the whole DTO so the minimal
 * `GameProps` shape `UnifiedGameCard` accepts (id/name/coverUrl and a handful
 * of optionals) also satisfies it. The Library card and the game detail page
 * then share one adapter instead of growing a second near-copy.
 */
export type GameDetailBadgeInput = Partial<
    Pick<
        GameDetailDto,
        | 'currentUserOwns'
        | 'currentUserWishlisted'
        | 'ownerCount'
        | 'wishlistCount'
        | 'itadCurrentPrice'
        | 'itadCurrentCut'
        | 'itadLowestPrice'
        | 'playerCount'
        | 'earlyAccess'
        | 'cooptimusOnlineMax'
        | 'cooptimusCouchMax'
        | 'cooptimusComboCoop'
    >
>;

/**
 * `/games` detail + discover rows → badge view-model.
 *
 * ROK-1314 follow-up: `GameDetailDto` now carries the community aggregates
 * too, so a Library / `/games` card renders `[You own] [N own]` rather than
 * the personalized pill alone. They stay `null` when the DTO omits them (a
 * stale cached response), which renders no aggregate rather than a wrong `0`.
 *
 * Note this is the STEAM-OWNERSHIP tally, deliberately distinct from the
 * want-to-play heart count the card's heart button already shows — a `manual`
 * heart never contributes here.
 */
export function fromGameDetail(game: GameDetailBadgeInput): GameBadgeData {
    return {
        ...EMPTY,
        currentUserOwns: game.currentUserOwns === true,
        currentUserWishlisted: game.currentUserWishlisted === true,
        ownerCount: game.ownerCount ?? null,
        wishlistCount: game.wishlistCount ?? null,
        price: game.itadCurrentPrice ?? null,
        cut: game.itadCurrentCut ?? null,
        lowestPrice: game.itadLowestPrice ?? null,
        playerCount: game.playerCount ?? null,
        earlyAccess: game.earlyAccess === true,
        cooptimusOnlineMax: game.cooptimusOnlineMax ?? null,
        cooptimusCouchMax: game.cooptimusCouchMax ?? null,
        cooptimusComboCoop: game.cooptimusComboCoop ?? null,
    };
}

/** Tiebreaker veto card → badge view-model (compact set only, spec §3.4). */
export function fromVetoGameCard(card: VetoGameCardData): GameBadgeData {
    return {
        ...EMPTY,
        ownerCount: card.ownerCount ?? null,
        wishlistCount: card.wishlistCount ?? null,
        currentUserOwns: card.currentUserOwns === true,
        currentUserWishlisted: card.currentUserWishlisted === true,
        price: card.itadCurrentPrice ?? null,
        cut: card.itadCurrentCut ?? null,
        lowestPrice: card.itadLowestPrice ?? null,
    };
}
