/**
 * ROK-2149 (Q4=A) — roster-insights profession members are a linked character
 * (`characterId`) OR an unclaimed roster member known from its Armory snapshot
 * (`characterId: null` + `memberId`). Every reader keys both kinds the same
 * way, so the Members cell, the coverage chips, the Profession filter and the
 * Overview widget agree on who has what: `characterId ?? 'm' + memberId`.
 */

/** A Members-table row's key (linked rows by character, others by roster member). */
export function rowProfessionKey(row: { characterId: string | null; memberId: number }): string {
    return row.characterId ?? `m${row.memberId}`;
}

/** A profession member's key; null only for a malformed member with neither id. */
export function professionMemberKey(member: { characterId: string | null; memberId?: number | undefined }): string | null {
    if (member.characterId !== null) return member.characterId;
    return member.memberId === undefined ? null : `m${member.memberId}`;
}
