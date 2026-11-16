/**
 * ROK-2216 — level copy shared by the event page (signup warning, content
 * browser range) and the hub Dungeon planner (per-character level fit).
 */
import type { DungeonLevelFit, WowInstanceDetailDto } from '@raid-ledger/contract';

/** "Lv15-21", or "Lv15+" when there is no ceiling. */
export function levelRange(min: number, max?: number | null): string {
    return `Lv${min}${max ? `-${max}` : '+'}`;
}

/** "Below min level (N)" — the event page's under-level wording. */
export function belowMinCopy(min: number): string {
    return `Below min level (${min})`;
}

/** The planner's level-fit chip copy; above range is neutral, never a warning (ROK-2207 OQ9). */
export function levelFitCopy(fit: DungeonLevelFit, min: number, max: number): string {
    if (fit === 'below') return belowMinCopy(min);
    if (fit === 'above') return `Above range (max ${max})`;
    if (fit === 'unknown') return 'Level unknown';
    return `${levelRange(min, max)} ✓`;
}

/** An event signup's level warning. */
export interface LevelWarning {
    type: 'under' | 'over';
    label: string;
}

/** The event page's signup level warning against the lowest minimum level of the event's content. */
export function getLevelWarning(
    characterLevel: number | null | undefined,
    contentInstances: Pick<WowInstanceDetailDto, 'minimumLevel'>[],
    gameSlug: string | null | undefined,
): LevelWarning | null {
    if (characterLevel == null) return null;
    const minimumLevels = contentInstances
        .map((i) => i.minimumLevel)
        .filter((l): l is number => l != null);
    if (minimumLevels.length === 0) return null;
    const lowestMinLevel = Math.min(...minimumLevels);
    if (characterLevel < lowestMinLevel) return { type: 'under', label: belowMinCopy(lowestMinLevel) };
    if (gameSlug === 'world-of-warcraft-classic' && characterLevel > lowestMinLevel + 20) {
        return { type: 'over', label: 'Over-leveled for this content' };
    }
    return null;
}
