import type { JSX } from "react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { SteamLibraryEntryDto } from "@raid-ledger/contract";
import { useUserSteamLibraryModal } from "../../hooks/use-user-profile";
import { formatPlaytime } from "../../lib/activity-utils";
import { Modal } from "../../components/ui/modal";
import { InfiniteScrollSentinel } from "../../components/ui/infinite-scroll-sentinel";

/** Cover image or placeholder for game cards */
function GameCover({
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

/** Single Steam library entry card */
function SteamLibraryCard({
  entry,
}: {
  entry: SteamLibraryEntryDto;
}): JSX.Element {
  return (
    <Link
      to={`/games/${entry.gameId}`}
      className="bg-panel border border-edge rounded-lg p-3 flex items-center gap-3 min-w-0 hover:opacity-80 transition-opacity"
    >
      <GameCover url={entry.coverUrl} alt={entry.gameName} />
      <div className="flex-1 min-w-0">
        <span className="font-medium text-foreground truncate block">
          {entry.gameName}
        </span>
        <span className="text-sm text-muted">
          {formatPlaytime(entry.playtimeSeconds)}
        </span>
      </div>
    </Link>
  );
}

/** Steam library modal with search filter and infinite scroll */
export function SteamLibraryModal({
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
          <SteamLibraryCard key={entry.gameId} entry={entry} />
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
