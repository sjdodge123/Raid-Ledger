/**
 * ROK-2133 (Q10) — the Armory spec + item level shown beside a roster row's
 * level and class (members list, roster-claim pick list). Both fields are
 * optional on the wire; a blank spec or a non-positive item level is dropped
 * so a row without Armory data renders exactly as before.
 */

/** The optional Armory fields both roster DTOs carry. */
export interface ArmoryMetaSource {
    spec?: string | undefined;
    itemLevel?: number | undefined;
}

/** `['Frost', '112 iLvl']`, each part only when present; `[]` when neither. */
export function armoryMetaParts(m: ArmoryMetaSource): string[] {
    const parts: string[] = [];
    const spec = m.spec?.trim();
    if (spec) parts.push(spec);
    if (m.itemLevel !== undefined && m.itemLevel > 0) parts.push(`${m.itemLevel} iLvl`);
    return parts;
}
