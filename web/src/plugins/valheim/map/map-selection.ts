/**
 * ROK-1837 D2 — which character and map the Map tab shows. The query string
 * (`?vc=<characterId>&vm=<mapId>`) wins when it names a real row; otherwise
 * the viewer's own claimed character, else the first by name, and the most
 * recently captured map.
 */
import type {
    ValheimCharacterMapRef,
    ValheimCharacterSummary,
} from '@raid-ledger/contract';

export const CHARACTER_PARAM = 'vc';
export const MAP_PARAM = 'vm';

function parseId(raw: string | null): number | null {
    if (raw === null || !/^\d+$/.test(raw)) return null;
    const n = Number(raw);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Characters sorted by name (case-insensitive) — the picker order. */
export function sortByName(
    rows: readonly ValheimCharacterSummary[],
): ValheimCharacterSummary[] {
    return [...rows].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    );
}

/** The character to show: `?vc` if listed, else the viewer's claimed one, else the first by name. */
export function pickCharacterId(
    rows: readonly ValheimCharacterSummary[],
    param: string | null,
    viewerId: number | null,
): number | null {
    const wanted = parseId(param);
    if (wanted !== null && rows.some((r) => r.id === wanted)) return wanted;
    const sorted = sortByName(rows);
    const own = sorted.find(
        (r) => viewerId !== null && r.claimedBy?.id === viewerId,
    );
    return (own ?? sorted[0])?.id ?? null;
}

/** The map to show: `?vm` if it is one of the character's, else the latest captured. */
export function pickMapId(
    maps: readonly ValheimCharacterMapRef[],
    param: string | null,
): number | null {
    const wanted = parseId(param);
    if (wanted !== null && maps.some((m) => m.id === wanted)) return wanted;
    const latest = [...maps].sort((a, b) =>
        b.capturedAt.localeCompare(a.capturedAt),
    )[0];
    return latest?.id ?? null;
}

/** Picker label for a world: the last four digits of its uid. */
export function worldLabel(map: ValheimCharacterMapRef): string {
    return `World ${map.worldUid.slice(-4)}`;
}
