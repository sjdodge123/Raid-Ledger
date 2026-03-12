import type { JSX } from "react";
import { useState } from "react";
import { useUserSteamWishlist } from "../../hooks/use-user-profile";
import { SteamIcon } from "../../components/icons/SteamIcon";
import { WishlistCard } from "./steam-wishlist-cards";
import { SteamWishlistModal } from "./steam-wishlist-modal";
import type { PricingMap } from "../user-profile-page";

/** ROK-418: Steam Wishlist section with show-10 + modal */
export function SteamWishlistSection({
  userId,
  pricingMap,
}: {
  userId: number;
  pricingMap: PricingMap;
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
        pricingMap={pricingMap}
      />
    </div>
  );
}
