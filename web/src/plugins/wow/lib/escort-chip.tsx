/**
 * ROK-2224 — "Escort" marker for an escort quest wherever a quest is listed
 * (dungeon planner, event Quest Prep, the hub Dungeon quests widget). Reuses
 * `StatusChip` (§4.21, tokens only); the title carries the meaning so the
 * colour is never the only signal.
 */
import type { JSX } from 'react';
import { StatusChip } from '../../../components/ui/status-chip';

const ESCORT_TITLE = 'Escort quest — the NPC must survive; the group cannot share it once started';

/** Renders the chip only when the quest is flagged `isEscort`. */
export function EscortChip({ isEscort, className }: { isEscort: boolean | undefined; className?: string }): JSX.Element | null {
    if (!isEscort) return null;
    return (
        <StatusChip tone="warning" title={ESCORT_TITLE} {...(className ? { className } : {})}>
            Escort
        </StatusChip>
    );
}
