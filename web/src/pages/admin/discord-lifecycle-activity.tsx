/**
 * ROK-1428 (L7) — the Preview section (spec §3.1 item 4): per-game activity,
 * binding state, pin toggle and the planned action. A table at ≥1024px,
 * stacked cards below; plus the Suppressions list with "Recreate". Both
 * sections render the §4.5 loading / error / empty states.
 */
import type { JSX } from 'react';
import type { GameLifecycleActivityDto, LifecycleSuppressionDto } from '@raid-ledger/contract';
import { Button } from '../../components/ui/button';
import { StatusChip } from '../../components/ui/status-chip';
import { useMediaQuery } from '../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../lib/breakpoints';
import { usePinBinding, useRecreateGame } from '../../hooks/admin/use-channel-lifecycle';
import { actionChip, bindingState, relativeTime, signalLabel, type LoadState } from './discord-lifecycle.helpers';

type Pin = ReturnType<typeof usePinBinding>;
type Recreate = ReturnType<typeof useRecreateGame>;

const HEADERS = ['Game', 'Signals', 'Items', 'Last activity', 'Channel', 'Next action'];

/** A centred §4.5 message for a section that failed to load, with a retry. */
export function LoadFailed({ message, onRetry }: { message: string; onRetry?: (() => void) | undefined }): JSX.Element {
    return (
        <div className="text-center py-12 space-y-3">
            <p role="alert" className="text-sm text-muted">{message}</p>
            {onRetry && <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button>}
        </div>
    );
}

function Signals({ row }: { row: GameLifecycleActivityDto }): JSX.Element {
    return (
        <div className="flex flex-wrap gap-1">
            {row.signals.map((s) => {
                const label = signalLabel(s.kind, s.itemCount);
                return <StatusChip key={s.kind} tone="neutral" title={label}>{label}</StatusChip>;
            })}
            {row.hubHold && <StatusChip tone="neutral" title="An active community hub holds this channel open">Hub hold</StatusChip>}
        </div>
    );
}

function ChannelCell({ row, pin }: { row: GameLifecycleActivityDto; pin: Pin }): JSX.Element {
    const state = bindingState(row.binding);
    if (!row.binding || !state) return <span className="text-muted">—</span>;
    const { id, pinned } = row.binding;
    const mine = pin.variables?.id === id;
    return (
        <div className="flex flex-wrap items-center gap-2">
            <StatusChip tone={state === 'Active' ? 'success' : 'neutral'} title={`Binding ${state.toLowerCase()}`}>{state}</StatusChip>
            {row.binding.autoManaged && (
                <Button size="sm" variant="ghost" loading={pin.isPending && mine} disabled={pin.isPending && !mine}
                    aria-pressed={pinned} aria-label={`${pinned ? 'Unpin' : 'Pin'} channel for ${row.gameName}`}
                    title="Pinned channels are never archived or unarchived automatically"
                    onClick={() => pin.mutate({ id, pinned: !pinned })}>{pinned ? 'Unpin' : 'Pin'}</Button>
            )}
            {pin.error && mine && <span role="alert" className="text-xs text-danger">{pin.error.message}</span>}
        </div>
    );
}

function RecreateButton({ gameId, gameName, recreate }: { gameId: number; gameName: string; recreate: Recreate }): JSX.Element {
    const mine = recreate.variables === gameId;
    return (
        <>
            <Button size="sm" variant="ghost" loading={recreate.isPending && mine} disabled={recreate.isPending && !mine}
                aria-label={`Recreate channel for ${gameName}`} onClick={() => recreate.mutate(gameId)}>Recreate</Button>
            {recreate.error && mine && <span role="alert" className="text-xs text-danger">{recreate.error.message}</span>}
        </>
    );
}

function ActionCell({ row, recreate }: { row: GameLifecycleActivityDto; recreate: Recreate }): JSX.Element {
    const chip = actionChip(row);
    return (
        <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
                <StatusChip tone={chip.tone} title={`Next action: ${chip.label}`}>{chip.label}</StatusChip>
                {row.suppressed && <RecreateButton gameId={row.gameId} gameName={row.gameName} recreate={recreate} />}
            </div>
            <p className="text-xs text-muted">{row.reason}</p>
        </div>
    );
}

interface RowsProps { items: GameLifecycleActivityDto[]; pin: Pin; recreate: Recreate }

/** §4.21 admin-table box: bordered, scrolls sideways rather than overflowing at 1024px. */
function ActivityTable({ items, pin, recreate }: RowsProps): JSX.Element {
    return (
        <div className="max-w-full overflow-x-auto border border-edge rounded-xl">
            <table className="w-full text-sm" data-testid="lifecycle-activity-table" aria-label="Game channel activity">
                <thead className="text-left text-muted bg-surface/50">
                    <tr>{HEADERS.map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-edge">
                    {items.map((row) => (
                        <tr key={row.gameId} className="align-top" data-testid="lifecycle-activity-row">
                            <td className="px-3 py-2 text-foreground">{row.gameName}</td><td className="px-3 py-2"><Signals row={row} /></td>
                            <td className="px-3 py-2">{row.itemCount}</td><td className="px-3 py-2 text-muted">{relativeTime(row.lastActivityAt)}</td>
                            <td className="px-3 py-2"><ChannelCell row={row} pin={pin} /></td><td className="px-3 py-2"><ActionCell row={row} recreate={recreate} /></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function ActivityCards({ items, pin, recreate }: RowsProps): JSX.Element {
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

interface ActivityProps {
    items: GameLifecycleActivityDto[]; windowDays: number; state?: LoadState; onRetry?: () => void;
}

function ActivityBody({ items, windowDays, state = 'ready', onRetry }: ActivityProps): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const pin = usePinBinding();
    const recreate = useRecreateGame();
    if (state === 'loading') return <p className="text-center py-12 text-sm text-muted">Loading the preview…</p>;
    if (state === 'error') return <LoadFailed message="Couldn’t load the preview." onRetry={onRetry} />;
    if (items.length === 0) {
        return <div className="text-center py-12"><p className="text-sm text-muted">No game activity in the last {windowDays} days.</p></div>;
    }
    return isDesktop
        ? <ActivityTable items={items} pin={pin} recreate={recreate} />
        : <ActivityCards items={items} pin={pin} recreate={recreate} />;
}

/** Section 4 — the activity preview, with §4.5 loading / error / empty states. */
export function ActivitySection(props: ActivityProps): JSX.Element {
    return (
        <section className="bg-surface rounded-xl border border-edge p-6 space-y-3" aria-label="Preview">
            <h3 className="text-base font-semibold text-foreground">Preview</h3>
            <ActivityBody {...props} />
        </section>
    );
}

/** Games whose managed channel was deleted or unbound by hand; hidden while loading or empty. */
export function SuppressionsSection({ items, state = 'ready', onRetry }: {
    items: LifecycleSuppressionDto[]; state?: LoadState; onRetry?: () => void;
}): JSX.Element | null {
    const recreate = useRecreateGame();
    if (state === 'loading' || (state === 'ready' && items.length === 0)) return null;
    return (
        <section className="bg-surface rounded-xl border border-edge p-6 space-y-3" aria-label="Suppressed games">
            <h3 className="text-base font-semibold text-foreground">Not recreated</h3>
            {state === 'error' ? <LoadFailed message="Couldn’t load the suppressed games." onRetry={onRetry} /> : (
                <ul className="space-y-2">
                    {items.map((s) => (
                        <li key={s.gameId} className="flex flex-wrap items-center justify-between gap-2 text-sm" data-testid="lifecycle-suppression-row">
                            <span className="text-foreground">{s.gameName} <span className="text-muted">— channel {s.reason} {relativeTime(s.createdAt)}</span></span>
                            <span className="flex items-center gap-2"><RecreateButton gameId={s.gameId} gameName={s.gameName} recreate={recreate} /></span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
