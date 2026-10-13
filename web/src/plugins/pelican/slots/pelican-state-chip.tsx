/** Read-only server state chip — the §4.21 recipe, tokens only (ROK-1094). */
import type { PelicanServerRowDto } from '@raid-ledger/contract';
import { stateChipView, type ChipTone } from './pelican-servers.helpers';

const TONE_CLS: Record<ChipTone, string> = {
    success: 'bg-success/10 border-success/30 text-success',
    warning: 'bg-warning/10 border-warning/30 text-warning',
    danger: 'bg-danger/10 border-danger/30 text-danger',
    neutral: 'bg-panel border-edge text-muted',
};

export function PelicanStateChip({ row }: { row: Pick<PelicanServerRowDto, 'state' | 'isSuspended'> }) {
    const view = stateChipView(row);
    return (
        <span data-tone={view.tone} title={view.title}
            className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-mono ${TONE_CLS[view.tone]}`}>
            {view.label}
        </span>
    );
}
