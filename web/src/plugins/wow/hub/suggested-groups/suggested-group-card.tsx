/**
 * ROK-2212 — one suggested group of five: the dungeon and its level span, the
 * five members (role · class dot · name · level, "Unclaimed" tag), then the
 * actions. Shared by the hub widget (top 3) and the planner-tab section (all).
 * §4.2 inner card, §4.3 neutral chips, `--color-class-*` dot beside the name.
 */
import type { JSX } from 'react';
import type { SuggestedGroupDto, SuggestedGroupMemberDto } from '@raid-ledger/contract';
import { StatusChip } from '../../../../components/ui/status-chip';
import { classDotClass } from '../wow-member-professions';
import { groupLabel, memberLevelRange } from './suggested-groups-links';
import { SuggestedGroupActions, type SuggestedGroupActionProps } from './suggested-group-actions';

const ROLE_LABEL: Record<SuggestedGroupMemberDto['role'], { full: string; short: string }> = {
    tank: { full: 'Tank', short: 'T' },
    healer: { full: 'Healer', short: 'H' },
    dps: { full: 'DPS', short: 'D' },
};

/** Role as text: "Tank" from 1024px, "T" (+ sr-only "Tank") below. */
function RoleLabel({ role }: { role: SuggestedGroupMemberDto['role'] }): JSX.Element {
    const label = ROLE_LABEL[role];
    return (
        <span className="w-6 shrink-0 text-xs text-muted lg:w-12">
            <span aria-hidden="true" className="lg:hidden">{label.short}</span>
            <span className="sr-only lg:not-sr-only">{label.full}</span>
        </span>
    );
}

function MemberRow({ member }: { member: SuggestedGroupMemberDto }): JSX.Element {
    const dot = classDotClass(member.class);
    return (
        <li className="flex min-h-7 items-center gap-2 text-sm" data-testid="suggested-group-member">
            <RoleLabel role={member.role} />
            {dot !== null && <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />}
            <span className="min-w-0 truncate text-foreground">{member.name}</span>
            {member.characterId === null && (
                <StatusChip tone="neutral" title="Not claimed by a Raid Ledger user yet">Unclaimed</StatusChip>
            )}
            <span className="ml-auto shrink-0 text-xs tabular-nums text-secondary">{member.level}</span>
        </li>
    );
}

function summary(group: SuggestedGroupDto): string {
    const { low, high } = memberLevelRange(group);
    const levels = low === high ? `Level ${low}` : `Levels ${low}–${high}`;
    if (group.sharedQuests === null) return levels;
    return `${levels} · ${group.sharedQuests} shared quest${group.sharedQuests === 1 ? '' : 's'}`;
}

export type SuggestedGroupCardProps = SuggestedGroupActionProps;

/** The card. `canAct` false hides Schedule + Poll; Poll also needs `onPoll`. */
export function SuggestedGroupCard(props: SuggestedGroupCardProps): JSX.Element {
    const { group, ordinal } = props;
    const { instance } = group;
    return (
        <article className="flex flex-col gap-2 rounded-lg border border-edge bg-panel p-3"
            aria-label={groupLabel(group, ordinal)} data-testid="suggested-group-card">
            <header className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">{instance.name}</h3>
                <StatusChip tone="neutral" title={`Dungeon level range ${instance.minimumLevel} to ${instance.maximumLevel}`}>
                    Lv {instance.minimumLevel}–{instance.maximumLevel}
                </StatusChip>
            </header>
            <p className="text-xs text-muted">{summary(group)}</p>
            <ul className="flex flex-col gap-1">
                {group.members.map((m) => <MemberRow key={m.key} member={m} />)}
            </ul>
            <SuggestedGroupActions {...props} />
        </article>
    );
}
