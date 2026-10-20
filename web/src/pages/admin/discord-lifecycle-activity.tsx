/**
 * ROK-1428 (L7) — the Preview section (spec §3.1 item 4): per-game activity,
 * binding state, pin toggle and the planned action. A table at ≥1024px,
 * stacked cards below; plus the Suppressions list with "Recreate".
 */
import type { JSX } from 'react';
import type { GameLifecycleActivityDto, LifecycleSuppressionDto } from '@raid-ledger/contract';
import { Button } from '../../components/ui/button';
import { StatusChip } from '../../components/ui/status-chip';
import { useMediaQuery } from '../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../lib/breakpoints';
import { usePinBinding, useRecreateGame } from '../../hooks/admin/use-channel-lifecycle';
import { actionChip, bindingState, relativeTime, signalLabel } from './discord-lifecycle.helpers';

type Pin = ReturnType<typeof usePinBinding>;
type Recreate = ReturnType<typeof useRecreateGame>;

function Signals({ row }: { row: GameLifecycleActivityDto }): JSX.Element {
    return (
        <div className="flex flex-wrap gap-1">
            {row.signals.map((s) => <StatusChip key={s.kind} tone="neutral" title={`${s.itemCount} ${s.kind} items`}>{signalLabel(s.kind, s.itemCount)}</StatusChip>)}
            {row.hubHold && <StatusChip tone="neutral" title="An active community hub holds this channel open">Hub hold</StatusChip>}
        </div>
    );
}

function ChannelCell({ row, pin }: { row: GameLifecycleActivityDto; pin: Pin }): JSX.Element {
    const state = bindingState(row.binding);
    if (!row.binding || !state) return <span className="text-muted">—</span>;
    const { id, pinned } = row.binding;
    const pending = pin.isPending && pin.variables?.id === id;
    return (
        <div className="flex flex-wrap items-center gap-2">
            <StatusChip tone={state === 'active' ? 'success' : 'neutral'} title={`Binding ${state}`}>{state}</StatusChip>
            {row.binding.autoManaged && (
                <Button size="sm" variant="ghost" disabled={pending} title="Pinned channels are never archived or unarchived automatically"
                    onClick={() => pin.mutate({ id, pinned: !pinned })}>{pinned ? 'Unpin' : 'Pin'}</Button>
            )}
            {pin.error && pin.variables?.id === id && <span role="alert" className="text-xs text-danger">{pin.error.message}</span>}
        </div>
    );
}

function ActionCell({ row, recreate }: { row: GameLifecycleActivityDto; recreate: Recreate }): JSX.Element {
    const chip = actionChip(row);
    return (
        <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
                <StatusChip tone={chip.tone} title={row.reason}>{chip.label}</StatusChip>
                {row.suppressed && (
                    <Button size="sm" variant="ghost" disabled={recreate.isPending} onClick={() => recreate.mutate(row.gameId)}>Recreate</Button>
                )}
            </div>
            <p className="text-xs text-muted">{row.reason}</p>
        </div>
    );
}

function ActivityTable({ items, pin, recreate }: { items: GameLifecycleActivityDto[]; pin: Pin; recreate: Recreate }): JSX.Element {
    return (
        <table className="w-full text-sm" data-testid="lifecycle-activity-table">
            <thead className="text-left text-muted">
                <tr><th className="py-2">Game</th><th>Signals</th><th>Items</th><th>Last activity</th><th>Channel</th><th>Next action</th></tr>
            </thead>
            <tbody>
                {items.map((row) => (
                    <tr key={row.gameId} className="border-t border-edge align-top" data-testid="lifecycle-activity-row">
                        <td className="py-2 text-foreground">{row.gameName}</td><td className="py-2"><Signals row={row} /></td>
                        <td className="py-2">{row.itemCount}</td><td className="py-2 text-muted">{relativeTime(row.lastActivityAt)}</td>
                        <td className="py-2"><ChannelCell row={row} pin={pin} /></td><td className="py-2"><ActionCell row={row} recreate={recreate} /></td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function ActivityCards({ items, pin, recreate }: { items: GameLifecycleActivityDto[]; pin: Pin; recreate: Recreate }): JSX.Element {
    return (
        <ul className="space-y-3" data-testid="lifecycle-activity-cards">
            {items.map((row) => (
                <li key={row.gameId} className="rounded-lg border border-edge bg-panel/50 p-3 space-y-2" data-testid="lifecycle-activity-row">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-foreground">{row.gameName}</span>
                        <span className="text-xs text-muted">{row.itemCount} items · {relativeTime(row.lastActivityAt)}</span>
                    </div>
                    <Signals row={row} /><ChannelCell row={row} pin={pin} /><ActionCell row={row} recreate={recreate} />
                </li>
            ))}
        </ul>
    );
}

/** Section 4 — the activity preview, with the §4.5 empty state. */
export function ActivitySection({ items, windowDays }: { items: GameLifecycleActivityDto[]; windowDays: number }): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const pin = usePinBinding();
    const recreate = useRecreateGame();
    return (
        <section className="bg-surface rounded-xl border border-edge p-6 space-y-3" aria-label="Preview">
            <h3 className="text-base font-semibold text-foreground">Preview</h3>
            {items.length === 0 && <p className="text-sm text-muted">No game activity in the last {windowDays} days.</p>}
            {items.length > 0 && (isDesktop
                ? <ActivityTable items={items} pin={pin} recreate={recreate} />
                : <ActivityCards items={items} pin={pin} recreate={recreate} />)}
        </section>
    );
}

/** Games whose managed channel was deleted or unbound by hand. */
export function SuppressionsSection({ items }: { items: LifecycleSuppressionDto[] }): JSX.Element | null {
    const recreate = useRecreateGame();
    if (items.length === 0) return null;
    return (
        <section className="bg-surface rounded-xl border border-edge p-6 space-y-3" aria-label="Suppressed games">
            <h3 className="text-base font-semibold text-foreground">Not recreated</h3>
            <ul className="space-y-2">
                {items.map((s) => (
                    <li key={s.gameId} className="flex flex-wrap items-center justify-between gap-2 text-sm" data-testid="lifecycle-suppression-row">
                        <span className="text-foreground">{s.gameName} <span className="text-muted">— channel {s.reason} {relativeTime(s.createdAt)}</span></span>
                        <Button size="sm" variant="ghost" disabled={recreate.isPending} onClick={() => recreate.mutate(s.gameId)}>Recreate</Button>
                    </li>
                ))}
            </ul>
        </section>
    );
}
