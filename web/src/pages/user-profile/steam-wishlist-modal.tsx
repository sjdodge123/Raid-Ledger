import type { JSX } from "react";
import { useUserSteamWishlistModal } from "../../hooks/use-user-profile";
import { Modal } from "../../components/ui/modal";
import { ModalSearchInput, ModalListBody } from "../../components/ui/modal-helpers";
import { useModalSearch } from "../../hooks/use-modal-search";
import { InfiniteScrollSentinel } from "../../components/ui/infinite-scroll-sentinel";
import { WishlistCard } from "./steam-wishlist-cards";
import type { PricingMap } from "../user-profile-page";

/** Steam wishlist modal with search filter and infinite scroll */
export function SteamWishlistModal({
  userId,
  isOpen,
  onClose,
  total,
  pricingMap,
}: {
  userId: number;
  isOpen: boolean;
  onClose: () => void;
  total: number;
  pricingMap: PricingMap;
}): JSX.Element {
  const { search, setSearch, handleClose } = useModalSearch(onClose);
  const modal = useUserSteamWishlistModal(userId, isOpen);
  // Client-side search only — filters already-fetched pages (ROK-763).
  const filtered = search
    ? modal.items.filter((e) => e.gameName.toLowerCase().includes(search.toLowerCase()))
    : modal.items;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={`Steam Wishlist (${total})`} maxWidth="max-w-2xl">
      <ModalSearchInput value={search} onChange={setSearch} placeholder="Search wishlist..." />
      <ModalListBody isEmpty={filtered.length === 0}>
        {filtered.map((e) => <WishlistCard key={e.gameId} entry={e} pricing={pricingMap.get(e.gameId)} />)}
      </ModalListBody>
      {filtered.length > 0 && !search && (
        <InfiniteScrollSentinel sentinelRef={modal.sentinelRef} isFetchingNextPage={modal.isFetchingNextPage} hasNextPage={modal.hasNextPage} />
      )}
    </Modal>
  );
}
