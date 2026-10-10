/**
 * "You need N more pre-reqs" line under the Quest Prep header (ROK-1748).
 */
import type { EventQuestPrereqsResponse } from '@raid-ledger/contract';

/**
 * Summarise the viewer's outstanding pre-req steps. Renders nothing without a
 * state or without an addon snapshot (R-3: we cannot know what is needed).
 */
export function QuestPrepNeededLine({ prereqs }: { prereqs: EventQuestPrereqsResponse | undefined }) {
    if (!prereqs || prereqs.asOf === null) return null;
    if (prereqs.neededTotal > 0) {
        const noun = prereqs.neededTotal === 1 ? 'pre-req' : 'pre-reqs';
        return <p className="text-sm text-warning">You need {prereqs.neededTotal} more {noun}</p>;
    }
    return <p className="text-sm text-success">All pre-reqs done</p>;
}
