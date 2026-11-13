/**
 * ROK-1789 — one wanted row on the Recruitment card (approved prototype
 * `NeedRow`): role badge, class icon, class name, optional ` · note`, and the
 * row's own state chip at the end. Closed rows read quiet (`text-muted`,
 * normal weight) — A-D10.
 */
import type { JSX } from 'react';
import type { GuildRecruitWanted } from '@raid-ledger/contract';
import { StatusChip } from '../../../components/ui/status-chip';
import { CharRoleBadge } from '../hub/role-bits';
import { getClassIconUrl } from '../lib/class-icons';
import { RECRUIT_STATE_META } from './recruitment.helpers';

/** A single wanted class + role with its per-row state chip. */
export function RecruitmentNeedRow({ need }: { need: GuildRecruitWanted }): JSX.Element {
    const meta = RECRUIT_STATE_META[need.state];
    const quiet = need.state === 'closed';
    const icon = getClassIconUrl(need.className);
    return (
        <li data-testid="recruitment-row" data-class={need.className} className="flex items-center gap-2 py-1.5">
            <CharRoleBadge role={need.role} />
            {icon !== null && <img src={icon} alt="" aria-hidden="true" className="h-5 w-5 shrink-0 rounded" />}
            <span data-testid="recruitment-row-name"
                className={`min-w-0 flex-1 break-words text-sm ${quiet ? 'text-muted' : 'font-medium text-foreground'}`}>
                {need.className}
                {need.note !== undefined && need.note !== '' && (
                    <span className="text-xs font-normal text-muted"> · {need.note}</span>
                )}
            </span>
            <span data-testid="recruitment-row-state" className="shrink-0">
                <StatusChip tone={meta.tone} title={`${need.className} ${need.role}: ${meta.label}`}>{meta.label}</StatusChip>
            </span>
        </li>
    );
}
