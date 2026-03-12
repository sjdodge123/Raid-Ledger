import type { JSX } from "react";
import { useState } from "react";
import { useUserSteamWishlist } from "../../hooks/use-user-profile";
import { useGamesPricingBatch } from "../../hooks/use-games-pricing-batch";
import { SteamIcon } from "../../components/icons/SteamIcon";
import { WishlistCard } from "./steam-wishlist-cards";
import { SteamWishlistModal } from "./steam-wishlist-modal";

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
  const gameIds = items.map((e) => e.gameId);
  const pricingMap = useGamesPricingBatch(gameIds);

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
          <WishlistCard key={entry.gameId} entry={entry} pricing={pricingMap.get(entry.gameId)} />
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
