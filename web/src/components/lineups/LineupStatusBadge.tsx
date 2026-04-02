/**
 * Status badge for Community Lineup (ROK-935).
 * Displays a colored pill badge based on the lineup's current status.
 */
import type { JSX } from 'react';
import type { LineupStatusDto } from '@raid-ledger/contract';

interface LineupStatusBadgeProps {
    status: LineupStatusDto;
}

const STATUS_STYLES: Record<LineupStatusDto, string> = {
    building: 'bg-emerald-500/20 text-emerald-400',
    voting: 'bg-amber-500/20 text-amber-400',
    decided: 'bg-blue-500/20 text-blue-400',
    archived: 'bg-zinc-500/20 text-zinc-400',
};

const STATUS_LABELS: Record<LineupStatusDto, string> = {
    building: 'Nominating',
    voting: 'Voting',
    decided: 'Scheduling',
    archived: 'Archived',
};

/** Colored status badge pill for lineup status. */
export function LineupStatusBadge({ status }: LineupStatusBadgeProps): JSX.Element {
    return (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[status]}`}>
            {STATUS_LABELS[status]}
        </span>
    );
}
