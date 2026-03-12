import type { JSX } from "react";
import { useState } from "react";
import { useUserSteamWishlistModal } from "../../hooks/use-user-profile";
import { useGamesPricingBatch } from "../../hooks/use-games-pricing-batch";
import { Modal } from "../../components/ui/modal";
import { InfiniteScrollSentinel } from "../../components/ui/infinite-scroll-sentinel";
import { WishlistCard } from "./steam-wishlist-cards";

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
  const gameIds = modal.items.map((e) => e.gameId);
  const pricingMap = useGamesPricingBatch(gameIds);

  // Client-side search only — filters already-fetched pages. Works for MVP but
  // consider server-side search if wishlists grow large (ROK-763).
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
          <WishlistCard key={entry.gameId} entry={entry} pricing={pricingMap.get(entry.gameId)} />
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
