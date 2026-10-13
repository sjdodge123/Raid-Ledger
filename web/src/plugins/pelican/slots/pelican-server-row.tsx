/**
 * One Pelican server — a table row (≥1024px) or a stacked card (<1024px), the
 * same controls in both (ROK-1094). Every control applies immediately and its
 * PATCH carries only the field it changed — the game only once one is picked.
 */
import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { formatDistanceToNow } from 'date-fns';
import type { IgdbGameDto, PelicanServerRowDto, PelicanServerUpdate } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { Switch } from '../../../components/ui/switch';
import { GameSearchInput } from '../../../components/events/game-search-input';
import { PelicanStateChip } from './pelican-state-chip';
import { PelicanTimezoneField } from './pelican-timezone-field';

export type ServerUpdateHandler = (id: number, patch: PelicanServerUpdate, gameName?: string | null) => void;

export interface ServerRowProps {
    row: PelicanServerRowDto;
    defaultTimezone: string;
    suggestions: IgdbGameDto[];
    onUpdate: ServerUpdateHandler;
}

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
function GamePicker({ row, suggestions, onUpdate }: Omit<ServerRowProps, 'defaultTimezone'>) {
    const g = useGameDraft(row, onUpdate);
    return (
        <div onBlur={g.onBlur}>
            <GameSearchInput key={g.resetKey} id={`pelican-server-${row.id}-game`} value={g.value}
                initialSuggestions={suggestions} onChange={g.onChange} onClear={g.onClear} />
        </div>
    );
}

function CalendarSwitch({ row, onUpdate }: Pick<ServerRowProps, 'row' | 'onUpdate'>) {
    return (
        <Switch checked={row.showOnCalendar} label={`Show ${row.name} on calendar`} testId={`pelican-server-${row.id}-calendar`}
            onChange={(showOnCalendar) => onUpdate(row.id, { showOnCalendar })} />
    );
}

function TimezoneControl({ row, defaultTimezone, onUpdate }: Omit<ServerRowProps, 'suggestions'>) {
    const inherited = row.timezone === null;
    return (
        <div className="space-y-1">
            <PelicanTimezoneField key={row.timezone ?? 'inherit'} id={`pelican-server-${row.id}-tz`} label="Timezone"
                testId={`pelican-server-${row.id}-tz-input`} value={row.timezone ?? defaultTimezone} inherited={inherited}
                hint={inherited ? `Uses the panel default (${defaultTimezone}).` : 'Overrides the panel default.'}
                onChange={(tz) => { if (tz !== row.timezone) onUpdate(row.id, { timezone: tz }); }} />
            {!inherited && (
                <Button variant="ghost" size="sm" onClick={() => onUpdate(row.id, { timezone: '' })}>Use default</Button>
            )}
        </div>
    );
}

function LastSynced({ at }: { at: string | null }) {
    if (at === null) return <span className="text-sm text-muted">Never</span>;
    const date = new Date(at);
    return <span className="text-sm text-secondary" title={date.toLocaleString()}>{formatDistanceToNow(date, { addSuffix: true })}</span>;
}

/** Desktop: one `<tr>` in the §4.21-idiom table. */
export function PelicanServerRow(p: ServerRowProps) {
    return (
        <tr data-testid={`pelican-server-row-${p.row.id}`} className="align-top">
            <td className="px-3 py-3"><ServerName row={p.row} /></td>
            <td className="px-3 py-3"><PelicanStateChip row={p.row} /></td>
            <td className="px-3 py-3 min-w-[14rem]"><GamePicker row={p.row} suggestions={p.suggestions} onUpdate={p.onUpdate} /></td>
            <td className="px-3 py-3"><CalendarSwitch row={p.row} onUpdate={p.onUpdate} /></td>
            <td className="px-3 py-3 min-w-[14rem]"><TimezoneControl row={p.row} defaultTimezone={p.defaultTimezone} onUpdate={p.onUpdate} /></td>
            <td className="px-3 py-3 whitespace-nowrap"><LastSynced at={p.row.lastSyncedAt} /></td>
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
            <TimezoneControl row={p.row} defaultTimezone={p.defaultTimezone} onUpdate={p.onUpdate} />
            <p className="text-xs text-muted">Last synced <LastSynced at={p.row.lastSyncedAt} /></p>
        </div>
    );
}
