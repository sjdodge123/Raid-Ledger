/**
 * Game search — create / edit / plan event, Add Character, admin bindings,
 * the player filter and (via `PollGameSearch`) the scheduling poll.
 *
 * Built on the shared `Combobox` (ROK-1647): ↑/↓ move the highlight, Enter
 * picks, Esc closes. Searches via the debounced `useGameSearch` only once the
 * user has typed 2+ characters since mount or the last pick/clear — a
 * prefilled or just-picked game never fires a search on its own. Otherwise it
 * offers `initialSuggestions` when given. Editing the text away from the
 * picked game's name clears the selection.
 */
import { useEffect, useRef, useState, type JSX } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import type { IgdbGameDto } from '@raid-ledger/contract';
import { Button } from '../ui/button';
import { Combobox } from '../ui/combobox';
import { useGameSearch } from '../../hooks/use-game-search';
import { coverSrcSetProps } from '../../lib/igdb-image';

export interface GameSearchTestIds {
    input?: string;
    popup?: string;
    option?: string;
}

interface GameSearchInputProps {
    value: IgdbGameDto | null;
    onChange: (game: IgdbGameDto | null) => void;
    error?: string;
    /** Games to show immediately when input is focused with no query (e.g. registry games) */
    initialSuggestions?: IgdbGameDto[];
    /**
     * ROK-1416: unique field id so per-row admin forms don't collide on the
     * hard-coded `game-search` DOM id (duplicate-id hazard). Defaults to
     * `game-search` to keep every existing single-instance caller unchanged.
     */
    id?: string;
    /** ROK-1416: focus the input on mount (the inert-binding "Fix →" repair target). */
    autoFocus?: boolean;
    /** Smoke-test hooks (the scheduling poll's `game-search-*` ids). */
    testIds?: GameSearchTestIds;
}

function Cover({ game, w, h }: { game: IgdbGameDto; w: number; h: number }): JSX.Element {
    if (!game.coverUrl) {
        return <div aria-hidden="true" style={{ width: w, height: h }} className="shrink-0 bg-overlay rounded flex items-center justify-center text-dim">🎮</div>;
    }
    return (
        <img src={game.coverUrl} alt="" className="shrink-0 object-cover rounded bg-overlay" style={{ width: w, height: h }}
            width={w} height={h} loading="lazy" decoding="async" {...coverSrcSetProps(game.coverUrl, `${w}px`)}
            onError={(e) => { e.currentTarget.style.display = 'none'; }} />
    );
}

function SelectedGameBadge({ value }: { value: IgdbGameDto }): JSX.Element {
    return (
        <div className="mt-2 flex items-center gap-2">
            {value.coverUrl && <Cover game={value} w={32} h={40} />}
            <span className="text-success text-sm font-medium">{value.name}</span>
        </div>
    );
}

function LocalSourceWarning(): JSX.Element {
    return (
        <p className="mt-2 text-warning text-xs font-medium">
            Showing local results (external search unavailable)
        </p>
    );
}

function ClearButton({ onClear }: { onClear: () => void }): JSX.Element {
    return (
        <Button variant="ghost" iconOnly aria-label="Clear selection" onClick={onClear}>
            <XMarkIcon className="w-5 h-5" aria-hidden="true" />
        </Button>
    );
}

function useGameSearchState(value: IgdbGameDto | null, onChange: (game: IgdbGameDto | null) => void, initialSuggestions?: IgdbGameDto[]) {
    const [query, setQuery] = useState(value?.name ?? '');
    // True once the user edits the text; false on mount and after a pick or
    // clear, so a prefilled / picked name never searches by itself (ROK-1647).
    const [engaged, setEngaged] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    // The Combobox writes the picked label back through onInputChange right
    // after onChange; remember it so that echo doesn't clear the new pick.
    const pickedLabel = useRef<string | null>(null);
    const searching = engaged && query.length >= 2;
    // Defensive read: prod always returns a useQuery result, but a bare
    // `vi.fn()` mock (per-row admin forms, ROK-1416) can resolve undefined.
    const search = useGameSearch(query, searching);
    const hasSuggestions = !!initialSuggestions?.length;
    const pick = (game: IgdbGameDto | null): void => { pickedLabel.current = game?.name ?? null; setEngaged(false); onChange(game); };
    const type = (text: string): void => {
        const echo = pickedLabel.current === text;
        pickedLabel.current = null;
        setQuery(text);
        if (echo) return;
        setEngaged(true);
        if (value && text !== value.name) onChange(null);
    };
    // Removing the clear button (`trailing`) remounts the input, so refocus
    // after that commit — a synchronous focus() would land on the old node.
    const refocus = useRef(false);
    useEffect(() => { if (refocus.current) { refocus.current = false; inputRef.current?.focus(); } });
    const clear = (): void => { setEngaged(false); onChange(null); setQuery(''); refocus.current = true; };
    return {
        inputRef, searching, hasSuggestions, pick, type, clear, query,
        options: searching ? (search?.data?.data ?? []) : (initialSuggestions ?? []),
        loading: searching && (search?.isLoading ?? false),
        localSource: searching && search?.data?.meta?.source === 'local',
    };
}

/** Game search combobox with the "Game" label, selected badge and clear button. */
export function GameSearchInput({ value, onChange, error, initialSuggestions, id = 'game-search', autoFocus, testIds }: GameSearchInputProps): JSX.Element {
    const { inputRef, ...s } = useGameSearchState(value, onChange, initialSuggestions);
    return (
        <div className="relative">
            <label htmlFor={id} className="block text-sm font-medium text-secondary mb-2">Game</label>
            {/* autoFocus (ROK-1416): the input receives focus when the form opens as the inert-binding repair target. */}
            <Combobox<IgdbGameDto>
                ref={inputRef} id={id} label="Game" autoFocus={autoFocus} placeholder="Search for a game..."
                options={s.options} getKey={(g) => String(g.id)} getLabel={(g) => g.name}
                value={value} onChange={s.pick} inputValue={s.query} onInputChange={s.type}
                loading={s.loading} loadingText="Searching..." emptyText={s.searching ? 'No games found' : 'Type to search...'}
                openOnFocus={s.searching || s.hasSuggestions} invalid={!!error}
                testIds={testIds}
                trailing={value ? <ClearButton onClear={s.clear} /> : undefined}
                renderOption={(g) => (
                    <>
                        <Cover game={g} w={40} h={48} />
                        <span className="text-foreground font-medium truncate">{g.name}</span>
                    </>
                )}
            />
            {s.localSource && <LocalSourceWarning />}
            {value && <SelectedGameBadge value={value} />}
            {error && <p className="mt-1 text-sm text-danger">{error}</p>}
        </div>
    );
}
