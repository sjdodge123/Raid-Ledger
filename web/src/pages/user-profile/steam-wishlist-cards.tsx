import type { JSX } from "react";
import type { SteamWishlistEntryDto, ItadGamePricingDto } from "@raid-ledger/contract";
import { GameRowPill } from "../../components/games/game-row-pill";

/** Single Steam wishlist entry card (ROK-418, ROK-805) */
export function WishlistCard({
  entry,
  pricing,
}: {
  entry: SteamWishlistEntryDto;
  pricing?: ItadGamePricingDto | null;
}): JSX.Element {
  return (
    <GameRowPill
      gameId={entry.gameId}
      name={entry.gameName}
      coverUrl={entry.coverUrl}
      href={`/games/${entry.gameId}`}
      pricing={pricing}
    />
  );
}
