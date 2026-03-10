import type { JSX } from "react";
import { useState } from "react";
import { useUserHeartedGamesModal } from "../../hooks/use-user-profile";
import { Modal } from "../../components/ui/modal";
import { InfiniteScrollSentinel } from "../../components/ui/infinite-scroll-sentinel";
import { HeartedGameCard } from "./user-profile-components";

/** Hearted games modal with search filter and infinite scroll */
export function HeartedGamesModal({
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
  const modal = useUserHeartedGamesModal(userId, isOpen);

  const filteredItems = search
    ? modal.items.filter((g) =>
        g.name.toLowerCase().includes(search.toLowerCase()),
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
      title={`Interested In (${total})`}
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
        {filteredItems.map((game) => (
          <HeartedGameCard key={game.id} game={game} />
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
