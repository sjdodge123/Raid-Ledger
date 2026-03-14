import type { JSX } from "react";
import type { SteamLibraryEntryDto, ItadGamePricingDto } from "@raid-ledger/contract";
import { useUserSteamLibraryModal } from "../../hooks/use-user-profile";
import { formatPlaytime } from "../../lib/activity-utils";
import { Modal } from "../../components/ui/modal";
import { ModalSearchInput, ModalListBody } from "../../components/ui/modal-helpers";
import { useModalSearch } from "../../hooks/use-modal-search";
import { InfiniteScrollSentinel } from "../../components/ui/infinite-scroll-sentinel";
import { GameRowPill } from "../../components/games/game-row-pill";
import type { PricingMap } from "../user-profile-page";

/** Single Steam library entry in the modal (ROK-805). */
function SteamLibraryModalItem({
  entry,
  pricing,
}: {
  entry: SteamLibraryEntryDto;
  pricing?: ItadGamePricingDto | null;
}): JSX.Element {
  return (
    <GameRowPill
      name={entry.gameName}
      coverUrl={entry.coverUrl}
      href={`/games/${entry.gameId}`}
      subtitle={formatPlaytime(entry.playtimeSeconds)}
      pricing={pricing}
    />
  );
}

/** Steam library modal with search filter and infinite scroll */
export function SteamLibraryModal({
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
  const modal = useUserSteamLibraryModal(userId, isOpen);
  const filtered = search
    ? modal.items.filter((e) => e.gameName.toLowerCase().includes(search.toLowerCase()))
    : modal.items;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={`Steam Library (${total})`} maxWidth="max-w-2xl">
      <ModalSearchInput value={search} onChange={setSearch} />
      <ModalListBody isEmpty={filtered.length === 0}>
        {filtered.map((e) => <SteamLibraryModalItem key={e.gameId} entry={e} pricing={pricingMap.get(e.gameId)} />)}
      </ModalListBody>
      {filtered.length > 0 && !search && (
        <InfiniteScrollSentinel sentinelRef={modal.sentinelRef} isFetchingNextPage={modal.isFetchingNextPage} hasNextPage={modal.hasNextPage} />
      )}
    </Modal>
  );
}
