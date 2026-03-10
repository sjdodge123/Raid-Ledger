import type { JSX } from "react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { SteamWishlistEntryDto } from "@raid-ledger/contract";
import { useUserSteamWishlist } from "../../hooks/use-user-profile";
import { SteamIcon } from "../../components/icons/SteamIcon";
import { SteamWishlistModal } from "./steam-wishlist-modal";

/** Cover image or placeholder for wishlist game cards */
function WishlistCover({
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
function WishlistCard({
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

/** ROK-418: Steam Wishlist section with show-10 + modal */
export function SteamWishlistSection({
  userId,
}: {
  userId: number;
}): JSX.Element | null {
  const { data, isLoading } = useUserSteamWishlist(userId);
  const [showModal, setShowModal] = useState(false);
  const items = data?.data ?? [];
  const total = data?.meta?.total ?? 0;

  if (items.length === 0 && !isLoading) return null;
  return (
    <div className="user-profile-section">
      <div className="flex items-center gap-2 mb-3">
        <SteamIcon className="w-5 h-5 text-muted" />
        <h2 className="user-profile-section-title mb-0">
          Steam Wishlist
          {total > 0 ? ` (${total})` : ""}
        </h2>
      </div>
      <div className="flex flex-col gap-2">
        {items.map((entry) => (
          <WishlistCard key={entry.gameId} entry={entry} />
        ))}
      </div>
      {total > 10 && (
        <button
          onClick={() => setShowModal(true)}
          className="mt-3 text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
        >
          Show All ({total})
        </button>
      )}
      <SteamWishlistModal
        userId={userId}
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        total={total}
      />
    </div>
  );
}
