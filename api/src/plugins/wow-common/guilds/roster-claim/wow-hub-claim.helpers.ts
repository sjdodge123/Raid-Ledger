/**
 * ROK-2153 S5 — pure mapping from WoW roster rows to core claim candidates.
 * Every candidate has `match: null` (operator ruling Q7: a WoW match needs a
 * hard fact — a Battle.net-linked character or a LedgerLink GUID — never the
 * name alone; resolution 4: a row with such a fact is already the viewer's and
 * is never unclaimed). So core's `suggested` is always null for WoW.
 */
import type { HubClaimCandidate } from '@raid-ledger/contract';

/** The roster row fields a candidate needs (list DTO or `ClaimMember`). */
export interface WowClaimRow {
  memberId: number;
  name: string;
  class: string | null;
  level: number | null;
  itemLevel?: number | undefined;
}

/** "Lv 60 Warrior · 412 ilvl" from whatever the row carries; null when nothing. */
export function claimSubtitle(row: WowClaimRow): string | null {
  const lv = row.level !== null ? `Lv ${row.level}` : '';
  const head = [lv, row.class ?? ''].filter((p) => p !== '').join(' ');
  const ilvl = row.itemLevel !== undefined ? `${row.itemLevel} ilvl` : '';
  const text = [head, ilvl].filter((p) => p !== '').join(' · ');
  return text === '' ? null : text.slice(0, 160);
}

/** One roster row of hub `guildId` as a core claim candidate (id = member id). */
export function toCandidate(
  row: WowClaimRow,
  guildId: number,
): HubClaimCandidate {
  return {
    id: String(row.memberId),
    name: row.name.slice(0, 100),
    subtitle: claimSubtitle(row),
    avatarUrl: null,
    detailPath: `/hubs/${guildId}/members/${row.memberId}`,
    match: null,
    matchReason: null,
  };
}

/** A candidate id back to the roster member id, or null when it is not one. */
export function parseCandidateId(candidateId: string): number | null {
  if (!/^[1-9]\d{0,9}$/.test(candidateId)) return null;
  const id = Number(candidateId);
  return id <= 2_147_483_647 ? id : null;
}
