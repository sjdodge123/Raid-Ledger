import type { JSX } from "react";
import { useState, useMemo } from "react";
import type { GameActivityEntryDto, ItadGamePricingDto } from "@raid-ledger/contract";
import { formatPlaytime } from "../../lib/activity-utils";
import { useGamesPricingBatch } from "../../hooks/use-games-pricing-batch";
import { GameRowPill } from "../../components/games/game-row-pill";
import { Modal } from "../../components/ui/modal";

const MOST_PLAYED_BADGE = (
  <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 rounded flex-shrink-0">
    Most Played
  </span>
);

/** Single activity entry using shared GameRowPill (ROK-805). */
function ActivityEntryCard({
  entry,
  pricing,
}: {
  entry: GameActivityEntryDto;
  pricing?: ItadGamePricingDto | null;
}): JSX.Element {
  return (
    <GameRowPill
      gameId={entry.gameId}
      name={entry.gameName}
      coverUrl={entry.coverUrl}
      href={`/games/${entry.gameId}`}
      subtitle={formatPlaytime(entry.totalSeconds)}
      pricing={pricing}
      badge={entry.isMostPlayed ? MOST_PLAYED_BADGE : undefined}
    />
  );
}

/** Max entries shown inline before "Show All" button */
const ACTIVITY_INLINE_LIMIT = 10;

/** Activity entries list or loading/empty states */
export function ActivityContent({
  entries,
  isLoading,
}: {
  entries: GameActivityEntryDto[];
  isLoading: boolean;
}): JSX.Element {
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState("");
  const gameIds = useMemo(() => entries.map((e) => e.gameId), [entries]);
  const pricingMap = useGamesPricingBatch(gameIds);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 bg-overlay rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }
  if (entries.length === 0)
    return <p className="text-muted text-sm">No activity tracked yet.</p>;

  const visible = entries.slice(0, ACTIVITY_INLINE_LIMIT);
  const hasMore = entries.length > ACTIVITY_INLINE_LIMIT;

  return (
    <>
      <div className="flex flex-col gap-2">
        {visible.map((entry) => (
          <ActivityEntryCard key={entry.gameId} entry={entry} pricing={pricingMap.get(entry.gameId)} />
        ))}
      </div>
      {hasMore && (
        <button
          onClick={() => setModalOpen(true)}
          className="mt-2 text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
        >
          Show All ({entries.length})
        </button>
      )}
      {hasMore && (
        <ActivityModal
          entries={entries}
          isOpen={modalOpen}
          onClose={() => { setModalOpen(false); setSearch(""); }}
          search={search}
          setSearch={setSearch}
          pricingMap={pricingMap}
        />
      )}
    </>
  );
}

type PricingMap = Map<number, ItadGamePricingDto | null>;

/** Modal for viewing all game activity with search */
function ActivityModal({ entries, isOpen, onClose, search, setSearch, pricingMap }: {
  entries: GameActivityEntryDto[]; isOpen: boolean;
  onClose: () => void; search: string; setSearch: (v: string) => void;
  pricingMap: PricingMap;
}): JSX.Element {
  const filtered = useMemo(() => {
    if (!search) return entries;
    const q = search.toLowerCase();
    return entries.filter((e) => e.gameName.toLowerCase().includes(q));
  }, [entries, search]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Game Activity (${entries.length})`} maxWidth="max-w-2xl">
      <input type="text" placeholder="Search games..." value={search} onChange={(e) => setSearch(e.target.value)}
        className="w-full px-3 py-2 mb-4 bg-surface/50 border border-edge rounded-lg text-sm text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent" />
      <div className="flex flex-col gap-2">
        {filtered.map((entry) => (<ActivityEntryCard key={entry.gameId} entry={entry} pricing={pricingMap.get(entry.gameId)} />))}
      </div>
      {filtered.length === 0 && (<p className="text-center text-muted text-sm py-4">No games found</p>)}
    </Modal>
  );
}
