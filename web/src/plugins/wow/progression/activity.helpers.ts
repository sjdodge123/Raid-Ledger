/**
 * ROK-1789 Part B (B5–B8) — pure text for the guild activity feed: the kind
 * chip per entry and the sentence after its actor. Prototype: `KIND_PILL` in
 * `proposed/ActivityFeed.tsx` @ `9f2a1103c`.
 */
import type {
    WowGuildActivityEntryDto,
    WowGuildActivityEntryOf,
    WowGuildActivityKind,
} from '@raid-ledger/contract';
import type { StatusChipTone } from '../../../components/ui/status-chip';

export const ACTIVITY_EMPTY_COPY = 'No guild activity in the last 30 days.';
export const ACTIVITY_FOOTER_COPY = 'From LedgerLink exports and Raid Ledger events · last 30 days';

export const KIND_META: Record<WowGuildActivityKind, { tone: StatusChipTone; label: string }> = {
    first_kill: { tone: 'success', label: 'First kill' },
    new_member: { tone: 'neutral', label: 'New member' },
    roster_import: { tone: 'neutral', label: 'New members' },
    event: { tone: 'neutral', label: 'Event' },
    ding: { tone: 'neutral', label: 'Level up' },
    milestone: { tone: 'success', label: 'Milestone' },
};

/** The character a row starts with (linked when it has an RL character). */
export interface ActivityActor {
    name: string;
    characterId: string | null;
}

/** The row's leading character, or null for guild-level rows (kills, events, imports). */
export function entryActor(entry: WowGuildActivityEntryDto): ActivityActor | null {
    switch (entry.kind) {
        case 'new_member':
        case 'ding':
        case 'milestone':
            return { name: entry.characterName, characterId: entry.characterId };
        default:
            return null;
    }
}

/** "1 month" / "6 months" / "1 year". */
function monthsLabel(months: 1 | 6 | 12): string {
    if (months === 12) return '1 year';
    return months === 1 ? '1 month' : '6 months';
}

/** Single: ": 1 month in Raid Ledger"; grouped (Q-B13): " and 48 others: 1 month in Raid Ledger". */
function milestoneText(entry: WowGuildActivityEntryOf<'milestone'>): string {
    const tail = `: ${monthsLabel(entry.months)} in Raid Ledger`;
    const others = entry.count - 1;
    if (others < 1) return tail;
    return ` and ${others} ${others === 1 ? 'other' : 'others'}${tail}`;
}

/** "Defeated Ragnaros (40) in Molten Core"; the label and instance are optional. */
function firstKillText(entry: WowGuildActivityEntryOf<'first_kill'>): string {
    const difficulty = entry.difficultyLabel === null ? '' : ` (${entry.difficultyLabel})`;
    const instance = entry.instanceName === null ? '' : ` in ${entry.instanceName}`;
    return `Defeated ${entry.bossName}${difficulty}${instance}`;
}

/**
 * The sentence for a row. With an actor (`entryActor` non-null) it is the
 * suffix after the name, carrying its own leading space or colon.
 */
export function entryText(entry: WowGuildActivityEntryDto): string {
    switch (entry.kind) {
        case 'first_kill':
            return firstKillText(entry);
        case 'new_member':
            return ' joined the guild';
        case 'roster_import':
            return `${entry.count} members added from a roster import`;
        case 'event':
            return entry.title;
        case 'ding':
            return ` reached level ${entry.toLevel}`;
        case 'milestone':
            return milestoneText(entry);
    }
}
