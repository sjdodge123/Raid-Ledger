import type { JSX } from "react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { SteamWishlistEntryDto } from "@raid-ledger/contract";
import { useUserSteamWishlistModal } from "../../hooks/use-user-profile";
import { Modal } from "../../components/ui/modal";
import { InfiniteScrollSentinel } from "../../components/ui/infinite-scroll-sentinel";

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

/** Single Steam wishlist entry card */
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

/** Steam wishlist modal with search filter and infinite scroll */
export function SteamWishlistModal({
  userId,
  isOpen,
  onClose,
  total,
}: {
  userId: number;
  isOpen: boolean;
  onClose: () => void;
  total: number;
}): JSX.Element {
  const [search, setSearch] = useState("");
  const modal = useUserSteamWishlistModal(userId, isOpen);

  const filteredItems = search
    ? modal.items.filter((e) =>
        e.gameName.toLowerCase().includes(search.toLowerCase()),
      )
    : modal.items;

  /** Clear search and delegate to parent onClose */
  const handleClose = (): void => {
    setSearch("");
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={`Steam Wishlist (${total})`}
      maxWidth="max-w-2xl"
    >
      <input
        type="text"
        placeholder="Search wishlist..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full px-3 py-2 mb-4 bg-surface/50 border border-edge rounded-lg text-sm text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
      />
      <div className="flex flex-col gap-2">
        {filteredItems.map((entry) => (
          <WishlistCard key={entry.gameId} entry={entry} />
        ))}
      </div>
      {filteredItems.length === 0 && (
        <p className="text-center text-muted text-sm py-4">No games found</p>
      )}
      {filteredItems.length > 0 && !search && (
        <InfiniteScrollSentinel
          sentinelRef={modal.sentinelRef}
          isFetchingNextPage={modal.isFetchingNextPage}
          hasNextPage={modal.hasNextPage}
        />
      )}
    </Modal>
  );
}
