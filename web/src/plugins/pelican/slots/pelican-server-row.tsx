/**
 * One Pelican server — a table row (≥1024px) or a stacked card (<1024px), the
 * same controls in both (ROK-1094). Every control applies immediately and its
 * PATCH carries only the field it changed.
 */
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

/** GameSearchInput, not GameFilterInput: the row's `gameName` names a game the registry may not list. */
function GamePicker({ row, suggestions, onUpdate }: Omit<ServerRowProps, 'defaultTimezone'>) {
    const value: IgdbGameDto | null = row.gameId === null ? null
        : { id: row.gameId, igdbId: null, name: row.gameName ?? `Game ${row.gameId}`, slug: '', coverUrl: null };
    return (
        <GameSearchInput id={`pelican-server-${row.id}-game`} value={value} initialSuggestions={suggestions}
            onChange={(game) => {
                const gameId = game?.id ?? null;
                if (gameId !== row.gameId) onUpdate(row.id, { gameId }, game?.name ?? null);
            }} />
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
