/**
 * Game nomination modal for Community Lineup (ROK-935).
 * Provides game search, preview with art, and optional note input.
 */
import { type JSX, useEffect, useRef } from 'react';
import { Modal } from '../ui/modal';
import { Button } from '../ui/button';
import { SearchInput } from '../ui/search-input';
import { useGameSearch } from '../../hooks/use-game-search';
import { useDirtyCloseGuard } from '../../hooks/use-dirty-close-guard';
import { extractSteamAppId } from '../../hooks/use-steam-paste';
import { getGameBySteamAppId } from '../../lib/api-client';
import { toast } from '../../lib/toast';
import { PersonalSuggestionsRow } from './PersonalSuggestionsRow';
import { CoopFitHints } from './CoopFitHints';
import type { CoopCapacityFields } from './coop-fit';
import { coverSrcSetProps } from '../../lib/igdb-image';
import { useNominateDraft, type SelectedGame } from './use-nominate-draft';

export type { SelectedGame } from './use-nominate-draft';

interface NominateModalProps {
    isOpen: boolean;
    onClose: () => void;
    lineupId: number;
    /** Pre-selected game from paste detection (ROK-945). */
    preSelectedGame?: SelectedGame | null;
    /**
     * ROK-1400: live group size used for the advisory co-op fit warning on
     * search results. Undefined = unknown, so no warning is shown. Never
     * blocks a nomination.
     */
    participantCount?: number;
}

/** Search-result row shape, incl. the ROK-1400 co-op capacity fields. */
type SearchResultGame = { id: number; name: string; coverUrl?: string | null } & CoopCapacityFields;

/** Search input for finding games (the results list renders inline below it). */
function GameQueryInput({ value, onChange }: { value: string; onChange: (v: string) => void }): JSX.Element {
    return (
        <div className="mb-3">
            <SearchInput value={value} onChange={onChange} label="Search games"
                placeholder="Search by name or paste a Steam store URL" autoFocus />
        </div>
    );
}

/** Single search result row. */
function SearchResultItem({ game, onSelect, participantCount }: {
    game: SearchResultGame;
    onSelect: (g: SelectedGame) => void;
    participantCount?: number;
}): JSX.Element {
    return (
        <button
            type="button"
            onClick={() => onSelect({ id: game.id, name: game.name, coverUrl: game.coverUrl ?? null })}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-panel transition-colors text-left"
        >
            {game.coverUrl ? (
                <img src={game.coverUrl} alt={game.name} className="w-8 h-10 object-cover rounded"
                    width={32} height={40} loading="lazy" decoding="async"
                    {...coverSrcSetProps(game.coverUrl, '32px')} />
            ) : (
                <div className="w-8 h-10 bg-panel rounded flex items-center justify-center text-dim text-xs">?</div>
            )}
            <span className="text-sm text-foreground truncate">{game.name}</span>
            <CoopFitHints game={game} participantCount={participantCount} />
        </button>
    );
}

/** List of search results. */
function SearchResults({ results, onSelect, participantCount }: {
    results: SearchResultGame[];
    onSelect: (g: SelectedGame) => void;
    participantCount?: number;
}): JSX.Element {
    return (
        <div className="space-y-1 max-h-60 overflow-y-auto">
            {results.map((game) => (
                <SearchResultItem
                    key={game.id}
                    game={game}
                    onSelect={onSelect}
                    participantCount={participantCount}
                />
            ))}
        </div>
    );
}

/** Selected game's cover art, or a "No art" placeholder. */
function PreviewCover({ game }: { game: SelectedGame }): JSX.Element {
    if (!game.coverUrl) {
        return <div className="w-24 h-32 bg-panel rounded-lg flex items-center justify-center text-dim">No art</div>;
    }
    return (
        <img src={game.coverUrl} alt={game.name} className="w-24 h-32 object-cover rounded-lg"
            width={96} height={128} loading="lazy" decoding="async"
            {...coverSrcSetProps(game.coverUrl, '96px')} />
    );
}

/** Preview card after a game is selected. */
function PreviewCard({ game, note, onNoteChange, onBack }: {
    game: SelectedGame;
    note: string;
    onNoteChange: (v: string) => void;
    onBack: () => void;
}): JSX.Element {
    return (
        <div className="space-y-4">
            <Button variant="ghost" size="sm" onClick={onBack}>&larr; Back to search</Button>
            <div className="flex gap-4 items-start">
                <PreviewCover game={game} />
                <div className="flex-1 min-w-0">
                    <h3 className="text-base font-semibold text-foreground mb-2">{game.name}</h3>
                    <textarea
                        aria-label={`Nomination note for ${game.name}`}
                        value={note}
                        onChange={(e) => onNoteChange(e.target.value)}
                        placeholder="Why this game? (optional)"
                        maxLength={200}
                        rows={3}
                        className="w-full px-3 py-2 bg-surface/50 border border-edge rounded-lg text-sm text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                    />
                    <span className="text-[10px] text-dim">{note.length}/200</span>
                </div>
            </div>
        </div>
    );
}

/** Pinned footer submit (ROK-1655): a loading Button keeps its name and swallows clicks (ruling 7). */
function NominateFooter({ onSubmit, isPending }: { onSubmit: () => void; isPending: boolean }): JSX.Element {
    return <Button fullWidth loading={isPending} onClick={onSubmit}>Submit Nomination</Button>;
}

/** Resolve one Steam appId to a library game; toast when it is not in the library. */
async function resolveSteamApp(appId: number, onResolved: (game: SelectedGame) => void): Promise<void> {
    try {
        const game = await getGameBySteamAppId(appId);
        onResolved({ id: game.id, name: game.name, coverUrl: game.coverUrl ?? null });
    } catch {
        toast.error('Game not found in library');
    }
}

/**
 * Watch the search query for a Steam store URL and resolve it via the
 * library API. Mirrors the page-level paste flow (`useSteamPasteDetection`)
 * which bails when an input is focused — so the modal owns its own copy.
 *
 * Each appId is resolved at most once even if the user re-pastes; loading
 * is tracked in a ref so the effect doesn't re-fire on the toast/state churn.
 */
function useSteamUrlAutoResolve(
    query: string,
    isOpen: boolean,
    onResolved: (game: SelectedGame) => void,
): void {
    const lastTriedRef = useRef<number | null>(null);
    const inFlightRef = useRef(false);
    useEffect(() => {
        if (!isOpen) {
            lastTriedRef.current = null;
            return;
        }
        const appId = extractSteamAppId(query);
        if (appId == null || appId === lastTriedRef.current) return;
        if (inFlightRef.current) return;
        lastTriedRef.current = appId;
        inFlightRef.current = true;
        void resolveSteamApp(appId, onResolved).finally(() => { inFlightRef.current = false; });
    }, [query, isOpen, onResolved]);
}

/** Search state: query input, results, empty/loading copy and personal suggestions. */
function SearchPane({ query, onQueryChange, isOpen, lineupId, participantCount, onSelect }: {
    query: string;
    onQueryChange: (v: string) => void;
    isOpen: boolean;
    lineupId: number;
    participantCount?: number;
    onSelect: (g: SelectedGame) => void;
}): JSX.Element {
    // When a Steam URL is in the input we don't want to run the name
    // search — it just wastes a request and renders "No games found".
    const isSteamUrl = extractSteamAppId(query) !== null;
    const { data: searchData, isLoading: searchLoading } = useGameSearch(isSteamUrl ? '' : query, isOpen);
    const results = searchData?.data ?? [];
    return (
        <>
            <GameQueryInput value={query} onChange={onQueryChange} />
            {searchLoading && <p className="text-sm text-muted py-4 text-center">Searching...</p>}
            {results.length > 0 && (
                <SearchResults results={results} onSelect={onSelect} participantCount={participantCount} />
            )}
            {query.length >= 2 && !searchLoading && results.length === 0 && (
                <p className="text-sm text-muted py-4 text-center">No games found</p>
            )}
            <PersonalSuggestionsRow
                lineupId={lineupId}
                onPickSuggestion={(s) => onSelect({ id: s.gameId, name: s.name, coverUrl: s.coverUrl })}
            />
        </>
    );
}

/**
 * Game nomination modal with search and preview. Esc, the backdrop and × ask
 * before discarding a selected game or a note (ROK-1655, `use-nominate-draft`).
 */
export function NominateModal({ isOpen, onClose, lineupId, preSelectedGame, participantCount }: NominateModalProps): JSX.Element {
    const draft = useNominateDraft({ isOpen, onClose, lineupId, preSelectedGame });
    const closeGuard = useDirtyCloseGuard(draft.isDirty, draft.handleClose);
    // Resolve any Steam store URL pasted into the search input. The
    // page-level paste detector skips the modal (its global listener
    // bails when an input is focused), so the modal owns this flow.
    useSteamUrlAutoResolve(draft.query, isOpen, (game) => {
        draft.setSelected(game);
        draft.setQuery('');
    });
    const footer = draft.selected
        ? <NominateFooter onSubmit={draft.handleSubmit} isPending={draft.isPending} />
        : undefined;

    return (
        <Modal isOpen={isOpen} onClose={draft.handleClose} closeGuard={closeGuard}
            title="Nominate a Game" maxWidth="max-w-4xl" footer={footer}>
            {draft.selected ? (
                <PreviewCard game={draft.selected} note={draft.note} onNoteChange={draft.setNote} onBack={draft.handleBack} />
            ) : (
                <SearchPane query={draft.query} onQueryChange={draft.setQuery} isOpen={isOpen} lineupId={lineupId}
                    participantCount={participantCount} onSelect={draft.setSelected} />
            )}
        </Modal>
    );
}
