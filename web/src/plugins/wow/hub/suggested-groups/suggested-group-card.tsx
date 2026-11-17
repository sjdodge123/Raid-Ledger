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

/** `compact`: the narrow hub-widget tile, a list at every width. `wide`: the planner section — a 5-column grid ≥1024px. */
export type SuggestedGroupLayout = 'compact' | 'wide';

// Never `sr-only lg:not-sr-only`: index.css's unlayered .sr-only beats Tailwind's layered variant (ROK-2212 verify).
const ROLE_CLS: Record<SuggestedGroupLayout, { short: string; sr: string }> = {
    compact: { short: 'w-6 shrink-0 text-xs text-muted', sr: 'sr-only' },
    wide: { short: 'w-6 shrink-0 text-xs text-muted lg:hidden', sr: 'sr-only lg:hidden' },
};

/** Role as text: "T" (+ sr-only "Tank") in a list row; "TANK" above the name in a wide grid cell. */
function RoleLabel({ role, layout }: { role: SuggestedGroupMemberDto['role']; layout: SuggestedGroupLayout }): JSX.Element {
    const label = ROLE_LABEL[role];
    return (
        <>
            <span aria-hidden="true" className={ROLE_CLS[layout].short}>{label.short}</span>
            <span className={ROLE_CLS[layout].sr}>{label.full}</span>
            {layout === 'wide' && (
                <span className="hidden text-[10px] font-semibold uppercase tracking-wide text-dim lg:block">{label.full}</span>
            )}
        </>
    );
}

const ROW_CLS: Record<SuggestedGroupLayout, string> = {
    compact: 'flex min-h-7 min-w-0 items-center gap-2 text-sm',
    wide: 'flex min-h-7 min-w-0 items-center gap-2 text-sm lg:flex-col lg:items-stretch lg:gap-1 lg:rounded-md lg:border lg:border-edge-subtle lg:bg-surface lg:px-2 lg:py-1.5',
};

/** Name + "Unclaimed": the chip wraps under a long name; the name truncates, never collapses to 0px. */
function NameCell({ member }: { member: SuggestedGroupMemberDto }): JSX.Element {
    const dot = classDotClass(member.class);
    return (
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 lg:flex-none" data-testid="suggested-group-member-name-cell">
            <span className="flex min-w-0 max-w-full items-center gap-2">
                {dot !== null && <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />}
                <span className="min-w-0 truncate text-foreground">{member.name}</span>
            </span>
            {member.characterId === null && (
                <StatusChip tone="neutral" title="Not claimed by a Raid Ledger user yet">Unclaimed</StatusChip>
            )}
        </span>
    );
}

function MemberRow({ member, layout }: { member: SuggestedGroupMemberDto; layout: SuggestedGroupLayout }): JSX.Element {
    const levelCls = layout === 'wide' ? 'lg:ml-0' : '';
    return (
        <li className={ROW_CLS[layout]} data-testid="suggested-group-member">
            <RoleLabel role={member.role} layout={layout} />
            <NameCell member={member} />
            <span className={`ml-auto shrink-0 text-xs tabular-nums text-secondary ${levelCls}`}>{member.level}</span>
        </li>
    );
}

function summary(group: SuggestedGroupDto): string {
    const { low, high } = memberLevelRange(group);
    const levels = low === high ? `Level ${low}` : `Levels ${low}–${high}`;
    if (group.sharedQuests === null) return levels;
    return `${levels} · ${group.sharedQuests} shared quest${group.sharedQuests === 1 ? '' : 's'}`;
}

export interface SuggestedGroupCardProps extends SuggestedGroupActionProps {
    /** Default `compact` (hub widget); the planner section passes `wide`. */
    layout?: SuggestedGroupLayout | undefined;
}

/** The card. `canAct` false hides Schedule + Poll; Poll also needs `onPoll`. */
export function SuggestedGroupCard(props: SuggestedGroupCardProps): JSX.Element {
    const { group, ordinal, layout = 'compact', ...actions } = props;
    const { instance } = group;
    return (
        <article className="flex min-w-0 flex-col gap-2 rounded-lg border border-edge bg-panel p-3"
            aria-label={groupLabel(group, ordinal)} data-testid="suggested-group-card">
            <header className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">{instance.name}</h3>
                <StatusChip tone="neutral" title={`Dungeon level range ${instance.minimumLevel} to ${instance.maximumLevel}`}>
                    Lv {instance.minimumLevel}–{instance.maximumLevel}
                </StatusChip>
            </header>
            <p className="text-xs text-muted">{summary(group)}</p>
            <ul className={layout === 'wide' ? 'flex flex-col gap-1 lg:grid lg:grid-cols-5 lg:gap-1.5' : 'flex flex-col gap-1'}>
                {group.members.map((m) => <MemberRow key={m.key} member={m} layout={layout} />)}
            </ul>
            <SuggestedGroupActions group={group} ordinal={ordinal} {...actions} />
        </article>
    );
}
