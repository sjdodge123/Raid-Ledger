import type { JSX } from "react";
import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import type { GameActivityEntryDto } from "@raid-ledger/contract";
import { formatPlaytime } from "../../lib/activity-utils";
import { Modal } from "../../components/ui/modal";

/** Single activity entry card */
function ActivityEntryCard({
  entry,
}: {
  entry: GameActivityEntryDto;
}): JSX.Element {
  return (
    <Link
      key={entry.gameId}
      to={`/games/${entry.gameId}`}
      className="bg-panel border border-edge rounded-lg p-3 flex items-center gap-3 min-w-0 hover:opacity-80 transition-opacity"
    >
      {entry.coverUrl ? (
        <img
          src={entry.coverUrl}
          alt={entry.gameName}
          className="w-10 h-14 rounded object-cover flex-shrink-0"
          loading="lazy"
        />
      ) : (
        <div className="w-10 h-14 rounded bg-overlay flex items-center justify-center text-muted flex-shrink-0 text-xs">
          ?
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground truncate">
            {entry.gameName}
          </span>
          {entry.isMostPlayed && (
            <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 rounded">
              Most Played
            </span>
          )}
        </div>
        <span className="text-sm text-muted">
          {formatPlaytime(entry.totalSeconds)}
        </span>
      </div>
    </Link>
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
          <ActivityEntryCard key={entry.gameId} entry={entry} />
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
        />
      )}
    </>
  );
}

/** Modal for viewing all game activity with search */
function ActivityModal({ entries, isOpen, onClose, search, setSearch }: {
  entries: GameActivityEntryDto[]; isOpen: boolean;
  onClose: () => void; search: string; setSearch: (v: string) => void;
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
        {filtered.map((entry) => (<ActivityEntryCard key={entry.gameId} entry={entry} />))}
      </div>
      {filtered.length === 0 && (<p className="text-center text-muted text-sm py-4">No games found</p>)}
    </Modal>
  );
}
