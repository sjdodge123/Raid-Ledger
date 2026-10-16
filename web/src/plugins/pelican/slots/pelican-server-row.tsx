/**
 * One Pelican server — a table row (≥1024px) or a stacked card (<1024px), the
 * same controls in both (ROK-1094). Every control applies immediately and its
 * PATCH carries only the field it changed — the game only once one is picked.
 */
import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { formatDistanceToNow } from 'date-fns';
import type { IgdbGameDto, PelicanServerRowDto, PelicanServerUpdate } from '@raid-ledger/contract';
import { Switch } from '../../../components/ui/switch';
import { GameSearchInput } from '../../../components/events/game-search-input';
import { PelicanStateChip } from './pelican-state-chip';
import { quickPlayHint } from './pelican-servers.helpers';

export type ServerUpdateHandler = (id: number, patch: PelicanServerUpdate, gameName?: string | null) => void;

export interface ServerRowProps {
    row: PelicanServerRowDto;
    suggestions: IgdbGameDto[];
    onUpdate: ServerUpdateHandler;
}

/** Table cells drop the per-control labels: the column header is the label (ROK-1094). */
type ControlProps<K extends keyof ServerRowProps> = Pick<ServerRowProps, K> & { inline?: boolean };

function ServerName({ row }: { row: PelicanServerRowDto }) {
    return (
        <div className="min-w-0">
            <p className="font-medium text-foreground break-words">{row.name}</p>
            {row.missing && <p className="text-xs text-muted">Missing from panel</p>}
        </div>
    );
}

function rowGame(row: PelicanServerRowDto): IgdbGameDto | null {
    return row.gameId === null ? null
        : { id: row.gameId, igdbId: null, name: row.gameName ?? `Game ${row.gameId}`, slug: '', coverUrl: null };
}

/**
 * Apply-immediately game choice (ROK-1094 review MAJOR). Typing over the name makes
 * GameSearchInput emit "no game", which must NOT unmap the server: only a pick PATCHes
 * `{gameId}`, and `{gameId:null}` comes from Clear selection or from leaving the box
 * empty. Leaving unpicked text puts the row's game back. The shown value stays the
 * row's game while typing, so the input (and its clear button) never remounts mid-edit.
 * When the row settles on a game other than the id last sent (a failed PATCH rolled
 * back), the input remounts so its text shows the row's game again.
 */
function useGameDraft(row: PelicanServerRowDto, onUpdate: ServerUpdateHandler) {
    const [dirty, setDirty] = useState(false);
    const [resetKey, setResetKey] = useState(0);
    const sent = useRef(row.gameId);
    useEffect(() => {
        if (row.gameId === sent.current) return;
        sent.current = row.gameId;
        setResetKey((k) => k + 1);
    }, [row]); // the row object, not gameId: a fast failure can coalesce pick + rollback into one render
    const onChange = (game: IgdbGameDto | null): void => {
        setDirty(game === null);
        if (game === null || game.id === row.gameId) return;
        sent.current = game.id;
        onUpdate(row.id, { gameId: game.id }, game.name);
    };
    const onClear = (): void => {
        setDirty(false);
        if (row.gameId === null) return;
        sent.current = null;
        onUpdate(row.id, { gameId: null }, null);
    };
    const onBlur = (e: FocusEvent<HTMLDivElement>): void => {
        if (!dirty || (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) return;
        if ((e.currentTarget.querySelector('input')?.value ?? '').trim() === '') { onClear(); return; }
        setDirty(false);
        setResetKey((k) => k + 1);
    };
    return { value: rowGame(row), onChange, onClear, onBlur, resetKey };
}

/** GameSearchInput, not GameFilterInput: the row's `gameName` names a game the registry may not list. */
function GamePicker({ row, suggestions, onUpdate, inline = false }: ControlProps<'row' | 'suggestions' | 'onUpdate'>) {
    const g = useGameDraft(row, onUpdate);
    return (
        <div onBlur={g.onBlur}>
            <GameSearchInput key={g.resetKey} id={`pelican-server-${row.id}-game`} value={g.value}
                initialSuggestions={suggestions} onChange={g.onChange} onClear={g.onClear} inline={inline} />
        </div>
    );
}

function CalendarSwitch({ row, onUpdate }: Pick<ServerRowProps, 'row' | 'onUpdate'>) {
    return (
        <Switch checked={row.showOnCalendar} label={`Show ${row.name} on calendar`} testId={`pelican-server-${row.id}-calendar`}
            onChange={(showOnCalendar) => onUpdate(row.id, { showOnCalendar })} />
    );
}

/**
 * "Detect Quick Play from server logs" (ROK-1800). Disabled with a hint while the server
 * has no game or its game has no log parser — but an already-on switch can still be
 * turned off, so a game change never strands it on.
 */
function QuickPlaySwitch({ row, onUpdate, inline = false }: ControlProps<'row' | 'onUpdate'>) {
    const hint = quickPlayHint(row);
    const hintId = `pelican-server-${row.id}-quick-play-hint`;
    return (
        <div className={`flex flex-col gap-1 ${inline ? 'items-start' : 'items-end text-right'}`}>
            <Switch checked={row.presenceTracking} label={`Detect Quick Play on ${row.name} from server logs`}
                testId={`pelican-server-${row.id}-quick-play`} disabled={hint !== null && !row.presenceTracking}
                {...(hint === null ? {} : { 'aria-describedby': hintId })}
                onChange={(presenceTracking) => onUpdate(row.id, { presenceTracking })} />
            {hint !== null && <p id={hintId} className="text-xs text-muted">{hint}</p>}
        </div>
    );
}

function LastSynced({ at }: { at: string | null }) {
    if (at === null) return <span className="text-sm text-muted">Never</span>;
    const date = new Date(at);
    return <span className="text-sm text-secondary" title={date.toLocaleString()}>{formatDistanceToNow(date, { addSuffix: true })}</span>;
}

/**
 * Desktop: one `<tr>` in the §4.21-idiom table. Sized to fit the admin content
 * box without inner scroll: the game picker holds 10rem, every other column
 * shrinks to its longest word. No timezone column (ROK-1795).
 */
export function PelicanServerRow(p: ServerRowProps) {
    return (
        <tr data-testid={`pelican-server-row-${p.row.id}`} className="align-top">
            <td className="px-2 py-3"><ServerName row={p.row} /></td>
            <td className="px-2 py-3"><PelicanStateChip row={p.row} /></td>
            <td className="px-2 py-3 min-w-[10rem]"><GamePicker row={p.row} suggestions={p.suggestions} onUpdate={p.onUpdate} inline /></td>
            <td className="px-2 py-3"><CalendarSwitch row={p.row} onUpdate={p.onUpdate} /></td>
            <td className="px-2 py-3"><QuickPlaySwitch row={p.row} onUpdate={p.onUpdate} inline /></td>
            <td className="px-2 py-3"><LastSynced at={p.row.lastSyncedAt} /></td>
        </tr>
    );
}

/** Phone/tablet (<1024px, §4.18): one stacked card. */
export function PelicanServerCard(p: ServerRowProps) {
    return (
        <div data-testid={`pelican-server-card-${p.row.id}`} className="space-y-3 rounded-xl border border-edge bg-panel/50 p-4">
            <div className="flex items-start justify-between gap-3">
                <ServerName row={p.row} />
                <PelicanStateChip row={p.row} />
            </div>
            <GamePicker row={p.row} suggestions={p.suggestions} onUpdate={p.onUpdate} />
            <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-secondary">Show on calendar</span>
                <CalendarSwitch row={p.row} onUpdate={p.onUpdate} />
            </div>
            <div className="flex items-start justify-between gap-3">
                <span className="text-sm text-secondary">Detect Quick Play from server logs</span>
                <QuickPlaySwitch row={p.row} onUpdate={p.onUpdate} />
            </div>
            <p className="text-xs text-muted">Last synced <LastSynced at={p.row.lastSyncedAt} /></p>
        </div>
    );
}
