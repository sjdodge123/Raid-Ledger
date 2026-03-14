import type { JSX } from "react";
import { useUserHeartedGamesModal } from "../../hooks/use-user-profile";
import { Modal } from "../../components/ui/modal";
import { ModalSearchInput, ModalListBody } from "../../components/ui/modal-helpers";
import { useModalSearch } from "../../hooks/use-modal-search";
import { InfiniteScrollSentinel } from "../../components/ui/infinite-scroll-sentinel";
import { HeartedGameCard } from "./user-profile-components";
import type { PricingMap } from "../user-profile-page";

/** Hearted games modal with search filter and infinite scroll */
export function HeartedGamesModal({
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
  const modal = useUserHeartedGamesModal(userId, isOpen);
  const filtered = search
    ? modal.items.filter((g) => g.name.toLowerCase().includes(search.toLowerCase()))
    : modal.items;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={`Interested In (${total})`} maxWidth="max-w-2xl">
      <ModalSearchInput value={search} onChange={setSearch} />
      <ModalListBody isEmpty={filtered.length === 0}>
        {filtered.map((g) => <HeartedGameCard key={g.id} game={g} pricing={pricingMap.get(g.id)} />)}
      </ModalListBody>
      {filtered.length > 0 && !search && (
        <InfiniteScrollSentinel sentinelRef={modal.sentinelRef} isFetchingNextPage={modal.isFetchingNextPage} hasNextPage={modal.hasNextPage} />
      )}
    </Modal>
  );
}
