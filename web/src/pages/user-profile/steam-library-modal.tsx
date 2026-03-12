import type { JSX } from "react";
import { useState } from "react";
import type { SteamLibraryEntryDto, ItadGamePricingDto } from "@raid-ledger/contract";
import { useUserSteamLibraryModal } from "../../hooks/use-user-profile";
import { formatPlaytime } from "../../lib/activity-utils";
import { Modal } from "../../components/ui/modal";
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
      gameId={entry.gameId}
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
  const [search, setSearch] = useState("");
  const modal = useUserSteamLibraryModal(userId, isOpen);

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
      title={`Steam Library (${total})`}
      maxWidth="max-w-2xl"
    >
      <input
        type="text"
        placeholder="Search games..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full px-3 py-2 mb-4 bg-surface/50 border border-edge rounded-lg text-sm text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
      />
      <div className="flex flex-col gap-2">
        {filteredItems.map((entry) => (
          <SteamLibraryModalItem key={entry.gameId} entry={entry} pricing={pricingMap.get(entry.gameId)} />
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
