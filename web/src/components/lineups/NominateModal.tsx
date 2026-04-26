/**
 * Game nomination modal for Community Lineup (ROK-935).
 * Provides game search, preview with art, and optional note input.
 */
import { type JSX, useState, useCallback, useEffect, useRef } from 'react';
import { Modal } from '../ui/modal';
import { useGameSearch } from '../../hooks/use-game-search';
import { useNominateGame } from '../../hooks/use-lineups';
import { extractSteamAppId } from '../../hooks/use-steam-paste';
import { getGameBySteamAppId } from '../../lib/api-client';
import { toast } from '../../lib/toast';
import { PersonalSuggestionsRow } from './PersonalSuggestionsRow';

export interface SelectedGame {
    id: number;
    name: string;
    coverUrl: string | null;
}

interface NominateModalProps {
    isOpen: boolean;
    onClose: () => void;
    lineupId: number;
    /** Pre-selected game from paste detection (ROK-945). */
    preSelectedGame?: SelectedGame | null;
}

/** Search input for finding games. */
function SearchInput({ value, onChange }: { value: string; onChange: (v: string) => void }): JSX.Element {
    return (
        <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Search by name or paste a Steam store URL"
            className="w-full px-4 py-2.5 bg-surface/50 border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-emerald-500 mb-3"
            autoFocus
        />
    );
}

/** Single search result row. */
function SearchResultItem({ game, onSelect }: {
    game: { id: number; name: string; coverUrl?: string | null };
    onSelect: (g: SelectedGame) => void;
}): JSX.Element {
    return (
        <button
            type="button"
            onClick={() => onSelect({ id: game.id, name: game.name, coverUrl: game.coverUrl ?? null })}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-panel transition-colors text-left"
        >
            {game.coverUrl ? (
                <img src={game.coverUrl} alt={game.name} className="w-8 h-10 object-cover rounded" />
            ) : (
                <div className="w-8 h-10 bg-panel rounded flex items-center justify-center text-dim text-xs">?</div>
            )}
            <span className="text-sm text-foreground truncate">{game.name}</span>
        </button>
    );
}

/** List of search results. */
function SearchResults({ results, onSelect }: {
    results: { id: number; name: string; coverUrl?: string | null }[];
    onSelect: (g: SelectedGame) => void;
}): JSX.Element {
    return (
        <div className="space-y-1 max-h-60 overflow-y-auto">
            {results.map((game) => (
                <SearchResultItem key={game.id} game={game} onSelect={onSelect} />
            ))}
        </div>
    );
}

/** Preview card after a game is selected. */
function PreviewCard({ game, note, onNoteChange, onSubmit, onBack, isPending }: {
    game: SelectedGame;
    note: string;
    onNoteChange: (v: string) => void;
    onSubmit: () => void;
    onBack: () => void;
    isPending: boolean;
}): JSX.Element {
    return (
        <div className="space-y-4">
            <button type="button" onClick={onBack} className="text-sm text-muted hover:text-foreground transition-colors">
                &larr; Back to search
            </button>
            <div className="flex gap-4 items-start">
                {game.coverUrl ? (
                    <img src={game.coverUrl} alt={game.name} className="w-24 h-32 object-cover rounded-lg" />
                ) : (
                    <div className="w-24 h-32 bg-panel rounded-lg flex items-center justify-center text-dim">No art</div>
                )}
                <div className="flex-1 min-w-0">
                    <h3 className="text-base font-semibold text-foreground mb-2">{game.name}</h3>
                    <textarea
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
            <button
                type="button"
                onClick={onSubmit}
                disabled={isPending}
                className="w-full px-4 py-2.5 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors disabled:opacity-50"
            >
                {isPending ? 'Submitting...' : 'Submit Nomination'}
            </button>
        </div>
    );
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
        (async () => {
            try {
                const game = await getGameBySteamAppId(appId);
                onResolved({
                    id: game.id,
                    name: game.name,
                    coverUrl: game.coverUrl ?? null,
                });
            } catch {
                toast.error('Game not found in library');
            } finally {
                inFlightRef.current = false;
            }
        })();
    }, [query, isOpen, onResolved]);
}

/** Game nomination modal with search and preview. */
export function NominateModal({ isOpen, onClose, lineupId, preSelectedGame }: NominateModalProps): JSX.Element {
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState<SelectedGame | null>(null);
    const [note, setNote] = useState('');
    const isSteamUrl = extractSteamAppId(query) !== null;
    // When a Steam URL is in the input we don't want to run the name
    // search — it just wastes a request and renders "No games found".
    const { data: searchData, isLoading: searchLoading } = useGameSearch(
        isSteamUrl ? '' : query,
        isOpen,
    );
    const nominate = useNominateGame();
    // Resolve any Steam store URL pasted into the search input. The
    // page-level paste detector skips the modal (its global listener
    // bails when an input is focused), so the modal owns this flow.
    useSteamUrlAutoResolve(query, isOpen, (game) => {
        setSelected(game);
        setQuery('');
    });

    // Sync pre-selected game when modal opens with one (ROK-945)
    const [appliedPreSelect, setAppliedPreSelect] = useState<SelectedGame | null>(null);
    if (isOpen && preSelectedGame && preSelectedGame !== appliedPreSelect) {
        setAppliedPreSelect(preSelectedGame);
        setSelected(preSelectedGame);
    }
    if (!isOpen && appliedPreSelect) setAppliedPreSelect(null);

    const handleSelect = useCallback((game: SelectedGame) => {
        setSelected(game);
    }, []);

    const handleBack = useCallback(() => {
        setSelected(null);
        setNote('');
    }, []);

    const handleSubmit = useCallback(() => {
        if (!selected) return;
        const body = note.trim() ? { gameId: selected.id, note: note.trim() } : { gameId: selected.id };
        nominate.mutate(
            { lineupId, body },
            { onSuccess: () => { setSelected(null); setNote(''); setQuery(''); onClose(); } },
        );
    }, [selected, note, lineupId, nominate, onClose]);

    const handleClose = useCallback(() => {
        setSelected(null);
        setNote('');
        setQuery('');
        onClose();
    }, [onClose]);

    const results = searchData?.data ?? [];

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title="Nominate a Game" maxWidth="max-w-4xl">
            {selected ? (
                <PreviewCard
                    game={selected}
                    note={note}
                    onNoteChange={setNote}
                    onSubmit={handleSubmit}
                    onBack={handleBack}
                    isPending={nominate.isPending}
                />
            ) : (
                <>
                    <SearchInput value={query} onChange={setQuery} />
                    {searchLoading && <p className="text-sm text-muted py-4 text-center">Searching...</p>}
                    {results.length > 0 && <SearchResults results={results} onSelect={handleSelect} />}
                    {query.length >= 2 && !searchLoading && results.length === 0 && (
                        <p className="text-sm text-muted py-4 text-center">No games found</p>
                    )}
                    <PersonalSuggestionsRow
                        lineupId={lineupId}
                        onPickSuggestion={(s) => handleSelect({ id: s.gameId, name: s.name, coverUrl: s.coverUrl })}
                    />
                </>
            )}
        </Modal>
    );
}
