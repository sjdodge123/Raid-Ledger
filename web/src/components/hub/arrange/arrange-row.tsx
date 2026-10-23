/**
 * ROK-1918 L5 — one row of the arrange list (mockup frames 1–2): position,
 * title + description, chips, Move up / Move down, and the Hide/Show
 * pressed-state button (spec §2.5 — staged until Save, so not a `Switch`).
 * A hidden row stays in place, dimmed, with a "Hidden" chip (Q2 A).
 * L6 adds the desktop drag handle in front of the position.
 */
import type { JSX } from 'react';
import { ArrowDownIcon, ArrowUpIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import { Button } from '../../ui/button';
import { StatusChip } from '../../ui/status-chip';
import type { HubLayoutEntry } from '../layout/resolve-hub-layout';
import type { DraftRow } from './arrange-draft';

const AUDIENCE_LABEL: Record<HubLayoutEntry['audience'], string | null> = {
    everyone: null,
    members: 'Members only',
    editors: 'Editors only',
};

function RowChips({ entry, on }: DraftRow<HubLayoutEntry>): JSX.Element | null {
    const audience = AUDIENCE_LABEL[entry.audience];
    if (entry.span < 2 && audience === null && on) return null;
    return (
        <div className="mt-1 flex flex-wrap gap-1">
            {entry.span >= 2 && <StatusChip tone="neutral" title="Takes two columns on wide screens">Wide</StatusChip>}
            {audience !== null && <StatusChip tone="warning" title={`Shown to ${audience.toLowerCase()}`}>{audience}</StatusChip>}
            {!on && <StatusChip tone="neutral" title="Not shown on the Overview">Hidden</StatusChip>}
        </div>
    );
}

export interface ArrangeRowProps {
    row: DraftRow<HubLayoutEntry>;
    index: number;
    count: number;
    onMove: (index: number, dir: -1 | 1) => void;
    onToggle: (id: string) => void;
}

export function ArrangeRow({ row, index, count, onMove, onToggle }: ArrangeRowProps): JSX.Element {
    const { entry, on } = row;
    const t = entry.title;
    return (
        <li className={`flex items-center gap-3 rounded-lg border border-edge bg-panel p-3 ${on ? '' : 'opacity-60'}`}
            data-testid={`arrange-row-${entry.id}`} data-hidden={on ? undefined : 'true'}>
            <span className="w-6 shrink-0 text-center text-sm tabular-nums text-muted" aria-hidden="true">{index + 1}</span>
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{t}</p>
                {entry.description !== undefined && <p className="text-xs text-muted">{entry.description}</p>}
                <RowChips entry={entry} on={on} />
            </div>
            <div className="flex shrink-0 gap-1">
                <Button variant="ghost" size="sm" iconOnly aria-label={`Move ${t} up`} disabled={index === 0} onClick={() => onMove(index, -1)}>
                    <ArrowUpIcon className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button variant="ghost" size="sm" iconOnly aria-label={`Move ${t} down`} disabled={index === count - 1} onClick={() => onMove(index, 1)}>
                    <ArrowDownIcon className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button variant="ghost" size="sm" iconOnly aria-label={`${on ? 'Hide' : 'Show'} ${t}`} aria-pressed={!on} onClick={() => onToggle(entry.id)}>
                    {on ? <EyeIcon className="h-4 w-4" aria-hidden="true" /> : <EyeSlashIcon className="h-4 w-4" aria-hidden="true" />}
                </Button>
            </div>
        </li>
    );
}
