import type { JSX } from "react";
import { Link } from "react-router-dom";
import type { SteamWishlistEntryDto } from "@raid-ledger/contract";

/** Cover image or placeholder for wishlist game cards */
export function WishlistCover({
  url,
  alt,
}: {
  url: string | null;
  alt: string;
}): JSX.Element {
  if (url) {
    return (
      <img
        src={url}
        alt={alt}
        className="w-10 h-14 rounded object-cover flex-shrink-0"
        loading="lazy"
      />
    );
  }
  return (
    <div className="w-10 h-14 rounded bg-overlay flex items-center justify-center text-muted flex-shrink-0 text-xs">
      ?
    </div>
  );
}

/** Single Steam wishlist entry card (ROK-418) */
export function WishlistCard({
  entry,
}: {
  entry: SteamWishlistEntryDto;
}): JSX.Element {
  return (
    <Link
      to={`/games/${entry.gameId}`}
      className="bg-panel border border-edge rounded-lg p-3 flex items-center gap-3 min-w-0 hover:opacity-80 transition-opacity"
    >
      <WishlistCover url={entry.coverUrl} alt={entry.gameName} />
      <span className="font-medium text-foreground truncate">
        {entry.gameName}
      </span>
    </Link>
  );
}
