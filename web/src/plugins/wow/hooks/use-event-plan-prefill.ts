/**
 * ROK-2215 — the WoW plugin's provider for the core event-plan pre-fill host
 * API: the plan's dungeon (L2) and the invitees' names from the hub roster (L7).
 */
import type { EventPlanPrefillRequest, EventPlanPrefillResult } from '../../event-plan-prefill';
import { useInstancePrefill } from './use-instance-prefill';
import { useCharacterNames } from './use-character-names';

/** Resolves a plan link for the Create Event page. Registered via `registerEventPlanPrefill`. */
export function useWowEventPlanPrefill(request: EventPlanPrefillRequest): EventPlanPrefillResult {
    const prefill = useInstancePrefill(request.gameSlug, request.instanceIds);
    const inviteNames = useCharacterNames(request.guildId, request.inviteCharacterIds);
    return { initialInstances: prefill.instances, inviteNames, isLoading: prefill.isLoading };
}
