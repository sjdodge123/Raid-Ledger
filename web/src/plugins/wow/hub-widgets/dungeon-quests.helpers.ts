/**
 * ROK-1924 (epic ROK-1905 W5) — pure helpers for the Forever Dungeon quests
 * hub widget. Kept free of React so `dungeon-quests.register.ts` (eagerly
 * loaded by the plugin entry) can use `hasContentEvents` without pulling the
 * widget body into the app-entry bundle.
 */
import type { GuildEventCardDto, GuildRaidsDto, QuestReadinessState } from '@raid-ledger/contract';
import type { StatusChipTone } from '../../../components/ui/status-chip';

/** The matrix needs the room of a span-2 card; below this a compact per-signup list reads better. */
export const MATRIX_MQ = '(min-width: 768px)';

/** How many upcoming events the widget lists. */
export const MAX_EVENTS = 3;

/** One state's chip: short label, the tooltip/accessible wording and the token tone. */
export interface QuestStateMeta {
    label: string;
    title: string;
    tone: StatusChipTone;
}

/**
 * done = success, missing = warning, have / unknown = neutral. The theme has no
 * accent token, so "have" is told apart by its label (the chip's colour is never
 * its only signal — `StatusChip` requires a title).
 */
export const QUEST_STATE_META: Readonly<Record<QuestReadinessState, QuestStateMeta>> = {
    done: { label: 'Done', title: 'Done', tone: 'success' },
    have: { label: 'Have', title: 'Have it', tone: 'neutral' },
    missing: { label: 'Missing', title: 'Missing', tone: 'warning' },
    unknown: { label: '?', title: 'Unknown', tone: 'neutral' },
};

function hasContent(e: GuildEventCardDto): boolean {
    return (e.contentInstances?.length ?? 0) > 0;
}

/** The next `limit` upcoming guild events that have planned content, soonest first. */
export function contentEvents(raids: GuildRaidsDto | undefined, limit: number = MAX_EVENTS): GuildEventCardDto[] {
    if (!raids) return [];
    return raids.upcoming
        .filter(hasContent)
        .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))
        .slice(0, limit);
}

/** Whether any upcoming guild event has planned content (the widget's `useVisible`). */
export function hasContentEvents(raids: GuildRaidsDto | undefined): boolean {
    return raids?.upcoming.some(hasContent) ?? false;
}

/** The chip tooltip / accessible name: "Aldric — Twilight Falls: Have it". */
export function cellTitle(signupName: string, questTitle: string, state: QuestReadinessState): string {
    return `${signupName} — ${questTitle}: ${QUEST_STATE_META[state].title}`;
}
