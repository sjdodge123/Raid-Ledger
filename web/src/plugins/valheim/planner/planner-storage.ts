/**
 * ROK-1854 D12 — the shopping list is kept per browser per server. Storage
 * can be missing or throw (private mode, blocked site data): every access is
 * guarded and the planner renders without it.
 */
import { parseStoredTargets, type PlannerTarget } from './planner.helpers';

export const plannerStorageKey = (serverId: number): string =>
    `rl.valheim.planner.${serverId}`;

export function loadPlannerTargets(serverId: number): PlannerTarget[] {
    try {
        return parseStoredTargets(
            window.localStorage.getItem(plannerStorageKey(serverId)),
        );
    } catch {
        return [];
    }
}

export function savePlannerTargets(
    serverId: number,
    targets: readonly PlannerTarget[],
): void {
    try {
        const key = plannerStorageKey(serverId);
        if (targets.length === 0) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, JSON.stringify(targets));
    } catch {
        // Storage unavailable — the list lives for this visit only.
    }
}
