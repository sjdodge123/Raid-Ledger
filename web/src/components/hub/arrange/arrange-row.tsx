/**
 * ROK-1918 L5 — one row of the arrange list (mockup frames 1–2): position,
 * title + description, chips, Move up / Move down, and the Hide/Show
 * pressed-state button (spec §2.5 — staged until Save, so not a `Switch`).
 * A hidden row stays in place, dimmed, with a "Hidden" chip (Q2 A).
 * L6: with `drag` set (desktop, fine pointer) a grip handle in front of the
 * position starts a native drag, and the row shows a 2px `bg-success` drop line.
 */
import type { JSX } from 'react';
import { ArrowDownIcon, ArrowUpIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import { Button } from '../../ui/button';
import { StatusChip } from '../../ui/status-chip';
import type { HubLayoutEntry } from '../layout/resolve-hub-layout';
import type { DraftRow } from './arrange-draft';
import type { DragHandleProps, DropEdge, RowDragBinding } from './use-row-drag';

const AUDIENCE_LABEL: Record<HubLayoutEntry['audience'], string | null> = {
    everyone: null,
    members: 'Members only',
    editors: 'Editors only',
};

function RowChips({ entry, on, owner }: DraftRow<HubLayoutEntry> & { owner: string }): JSX.Element {
    const audience = AUDIENCE_LABEL[entry.audience];
    return (
        <div className="mt-1 flex flex-wrap items-center gap-1">
            {entry.span >= 2 && <StatusChip tone="neutral" title="Takes two columns on wide screens">Wide</StatusChip>}
            {audience !== null && <StatusChip tone="warning" title={`Shown to ${audience.toLowerCase()}`}>{audience}</StatusChip>}
            {!on && <StatusChip tone="neutral" title="Not shown on the Overview">Hidden</StatusChip>}
            <span className="text-xs text-muted" data-testid="arrange-row-owner">{owner}</span>
        </div>
    );
}

/** Six-dot grip (mockup `I.grip`); heroicons has no drag handle. */
function GripIcon(): JSX.Element {
    return (
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
            {[5, 10, 15].map((y) => [7, 13].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.5" />))}
        </svg>
    );
}

/** Decorative: keyboard and screen-reader users reorder with Move up / Move down. */
function DragHandle({ title, props }: { title: string; props: DragHandleProps }): JSX.Element {
    return (
        <span {...props} aria-hidden="true" title={`Drag ${title} to reorder`} data-testid="arrange-drag-handle"
            className="flex shrink-0 cursor-grab rounded p-1 text-dim hover:text-secondary active:cursor-grabbing">
            <GripIcon />
        </span>
    );
}

/** Sits in the middle of the 8px gap between rows (`gap-2` + the 1px border). */
function DropLine({ edge }: { edge: Exclude<DropEdge, null> }): JSX.Element {
    const pos = edge === 'before' ? '-top-[5px]' : '-bottom-[5px]';
    return <span aria-hidden="true" data-testid="arrange-drop-line" data-edge={edge} className={`pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-success ${pos}`} />;
}

function rowClass(on: boolean, dragging: boolean): string {
    const tone = dragging ? 'border-edge-strong bg-overlay' : 'border-edge bg-panel';
    return `relative flex items-center gap-3 rounded-lg border p-3 ${tone} ${on ? '' : 'opacity-60'}`;
}

export interface ArrangeRowProps {
    row: DraftRow<HubLayoutEntry>;
    index: number;
    count: number;
    /** "Core", or the plugin's name (`widget-owner`). */
    owner: string;
    onMove: (index: number, dir: -1 | 1) => void;
    onToggle: (id: string) => void;
    /** Desktop with a fine pointer only (spec §2.4); absent = no handle. */
    drag?: RowDragBinding;
    /** A save is in flight: every control is disabled. */
    locked?: boolean;
}

export function ArrangeRow({ row, index, count, owner, onMove, onToggle, drag, locked = false }: ArrangeRowProps): JSX.Element {
    const { entry, on } = row;
    const t = entry.title;
    return (
        <li className={rowClass(on, drag?.dragging ?? false)} {...drag?.target} tabIndex={-1} data-arrange-id={entry.id}
            data-testid={`arrange-row-${entry.id}`} data-hidden={on ? undefined : 'true'}>
            {drag?.edge ? <DropLine edge={drag.edge} /> : null}
            {drag && <DragHandle title={t} props={drag.handle} />}
            <span className="w-6 shrink-0 text-center text-sm tabular-nums text-muted" aria-hidden="true">{index + 1}</span>
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{t}</p>
                {entry.description !== undefined && <p className="text-xs text-muted">{entry.description}</p>}
                <RowChips entry={entry} on={on} owner={owner} />
            </div>
            <div className="flex shrink-0 gap-1">
                <Button variant="ghost" size="sm" iconOnly aria-label={`Move ${t} up`} data-arrange-action="up" disabled={locked || index === 0} onClick={() => onMove(index, -1)}>
                    <ArrowUpIcon className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button variant="ghost" size="sm" iconOnly aria-label={`Move ${t} down`} data-arrange-action="down" disabled={locked || index === count - 1} onClick={() => onMove(index, 1)}>
                    <ArrowDownIcon className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button variant="ghost" size="sm" iconOnly aria-label={`${on ? 'Hide' : 'Show'} ${t}`} aria-pressed={!on} disabled={locked} onClick={() => onToggle(entry.id)}>
                    {on ? <EyeIcon className="h-4 w-4" aria-hidden="true" /> : <EyeSlashIcon className="h-4 w-4" aria-hidden="true" />}
                </Button>
            </div>
        </li>
    );
}
