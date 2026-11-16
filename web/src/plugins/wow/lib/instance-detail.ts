/**
 * A dungeon/raid list row as a selected-instance detail — exactly what a manual
 * tick in the Create Event content browser produces. Shared by the browser and
 * the ROK-2215 plan prefill so a pre-filled dungeon is byte-identical to a pick.
 */
import type { WowInstanceDetailDto, WowInstanceDto } from '@raid-ledger/contract';

/** Builds the basic (no detail fetch) selected-instance shape for a list row. */
export function buildBasicInstanceDetail(instance: WowInstanceDto, contentType: 'dungeon' | 'raid'): WowInstanceDetailDto {
    return {
        id: instance.id, name: instance.name, shortName: instance.shortName,
        expansion: instance.expansion, minimumLevel: instance.minimumLevel ?? null,
        maximumLevel: instance.maximumLevel, maxPlayers: null, category: contentType,
    };
}
