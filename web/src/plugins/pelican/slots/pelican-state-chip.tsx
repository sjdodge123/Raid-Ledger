/** Read-only server state chip — the §4.21 recipe via the shared StatusChip (ROK-1094, ROK-1776). */
import type { PelicanServerRowDto } from '@raid-ledger/contract';
import { StatusChip } from '../../../components/ui/status-chip';
import { stateChipView } from './pelican-servers.helpers';

export function PelicanStateChip({ row }: { row: Pick<PelicanServerRowDto, 'state' | 'isSuspended'> }) {
    const view = stateChipView(row);
    return <StatusChip tone={view.tone} title={view.title}>{view.label}</StatusChip>;
}
