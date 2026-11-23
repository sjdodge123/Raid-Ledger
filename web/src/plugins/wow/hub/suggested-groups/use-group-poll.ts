/** ROK-2212 — which suggested group's poll is open (widget + planner section). */
import { useState } from 'react';
import type { SuggestedGroupDto } from '@raid-ledger/contract';

/** `onPoll` is undefined when the viewer can't start a poll — the card then shows no Poll button. */
export function useGroupPoll(canAct: boolean): {
    group: SuggestedGroupDto | null;
    onPoll: ((group: SuggestedGroupDto) => void) | undefined;
    close: () => void;
} {
    const [group, setGroup] = useState<SuggestedGroupDto | null>(null);
    return { group, onPoll: canAct ? setGroup : undefined, close: () => setGroup(null) };
}
