/**
 * ROK-2216 — small pure helpers the planner's components share (kept out of
 * the .tsx files so they export components only).
 */
import type { EventQuestReadinessDto, WowInstanceDto } from '@raid-ledger/contract';
import { levelRange } from '../../utils/level-fit';

/** One claimed character's readiness row from the plan API. */
export type PlanSignup = EventQuestReadinessDto['signups'][number];
type Cell = PlanSignup['perQuest'][number];

/** "Lv15-21" for a catalogue row; '' when it has no minimum level. */
export function instanceRange(inst: Pick<WowInstanceDto, 'minimumLevel' | 'maximumLevel'>): string {
    return typeof inst.minimumLevel === 'number' ? levelRange(inst.minimumLevel, inst.maximumLevel) : '';
}

/** The character's cell for a quest; undefined = the character can't take it (ROK-2214 R6). */
export function stateOf(s: PlanSignup, questId: number): Cell | undefined {
    return s.perQuest.find((p) => p.questId === questId);
}
