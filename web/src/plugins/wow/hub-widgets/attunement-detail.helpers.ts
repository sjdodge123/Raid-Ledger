/**
 * ROK-1927 (W13) — pure helpers for the per-member Attunements detail (spec
 * §5.2, §7, mockup F6): one tab per tracked attunement group (faction variants
 * merged, like the card), and one row per member with a result in that group,
 * sorted done → in progress → not started → no data, then by name.
 */
import type {
    WowAttunementResultDto, WowAttunementState, WowRosterAttunementDto, WowRosterAttunementMemberDto,
} from '@raid-ledger/contract';
import type { StatusChipTone } from '../../../components/ui/status-chip';
import { syncedAgo } from '../../../lib/synced-ago';
import { isStale } from './class-level.helpers';

/** One detail tab: a tracked attunement group. */
export interface AttunementTab {
    groupKey: string;
    instance: string;
    /** The group's tracked definitions by key (faction variants). */
    defs: ReadonlyMap<string, WowRosterAttunementDto>;
}

/** One member row of the detail. */
export interface AttunementMemberRow {
    rowKey: string;
    name: string;
    characterId: string | null;
    state: WowAttunementState;
    tone: StatusChipTone;
    label: string;
    /** The chip's title (its colour is never the only signal). */
    title: string;
    /** "3/5" — or "—" with no data. */
    steps: string;
    /** Next step label (or "Not claimed"), "—" when none. */
    next: string;
    /** "Level 52 — below the required level", or null. */
    levelNote: string | null;
    /** "as of 2 days ago", or null without a capture time. */
    asOf: string | null;
    stale: boolean;
}

const ORDER: Record<WowAttunementState, number> = { done: 0, in_progress: 1, not_started: 2, no_data: 3 };
const CHIP: Record<WowAttunementState, { tone: StatusChipTone; label: string; title: string }> = {
    done: { tone: 'success', label: 'Attuned', title: 'Completed the final quest' },
    in_progress: { tone: 'warning', label: 'In progress', title: 'Part of the chain is done' },
    not_started: { tone: 'neutral', label: 'Not started', title: 'No step of the chain is done yet' },
    no_data: { tone: 'neutral', label: 'No data', title: 'No quest data shared' },
};
const NO_DATA_TITLE: Record<NonNullable<WowAttunementResultDto['noDataReason']>, string> = {
    no_quest_data: 'No quest data shared',
    not_claimed: 'Not claimed by a member',
    truncated: 'Quest list too long to read',
};

/** One tab per tracked group, in first-seen order; untracked groups never get a tab. */
export function attunementTabs(defs: readonly WowRosterAttunementDto[]): AttunementTab[] {
    const tabs = new Map<string, { groupKey: string; instance: string; defs: Map<string, WowRosterAttunementDto> }>();
    for (const def of defs) {
        if (!def.trackable) continue;
        const tab = tabs.get(def.groupKey) ?? { groupKey: def.groupKey, instance: def.instance, defs: new Map() };
        tab.defs.set(def.key, def);
        tabs.set(def.groupKey, tab);
    }
    return [...tabs.values()];
}

function stepsText(result: WowAttunementResultDto, def: WowRosterAttunementDto): string {
    return result.state === 'no_data' ? '—' : `${result.stepsDone}/${def.steps.length}`;
}

function nextText(result: WowAttunementResultDto): string {
    if (result.noDataReason === 'not_claimed') return 'Not claimed';
    if (result.nextStep === null) return '—';
    // In progress with no completed step can only come from the quest log.
    const inLog = result.state === 'in_progress' && result.stepsDone === 0;
    return inLog ? `${result.nextStep} (in quest log)` : result.nextStep;
}

function chipTitle(result: WowAttunementResultDto): string {
    if (result.state === 'no_data' && result.noDataReason !== null) return NO_DATA_TITLE[result.noDataReason];
    return CHIP[result.state].title;
}

function toRow(member: WowRosterAttunementMemberDto, result: WowAttunementResultDto, def: WowRosterAttunementDto, now: number): AttunementMemberRow {
    const chip = CHIP[result.state];
    const levelNote = result.belowLevel && member.level !== null ? `Level ${member.level} — below the required level` : null;
    return {
        rowKey: member.rowKey, name: member.name, characterId: member.characterId, state: result.state,
        tone: chip.tone, label: chip.label, title: chipTitle(result), steps: stepsText(result, def),
        next: nextText(result), levelNote, asOf: member.asOf === null ? null : `as of ${syncedAgo(member.asOf, now)}`,
        stale: isStale(member.asOf, now),
    };
}

/** The tab's rows: every member with a result for one of its definitions, sorted. */
export function attunementRows(
    tab: AttunementTab, members: readonly WowRosterAttunementMemberDto[], now: number = Date.now(),
): AttunementMemberRow[] {
    const rows: AttunementMemberRow[] = [];
    for (const member of members) {
        for (const result of member.results) {
            const def = tab.defs.get(result.key);
            if (def !== undefined) rows.push(toRow(member, result, def, now));
        }
    }
    return rows.sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.name.localeCompare(b.name));
}
