/**
 * ROK-1957 §5.6 — pure row → contract mappers. Spoilers hidden (D-14) ⇒
 * `area`, `areas` and `thumbnailUrl` are null for everyone on hub routes.
 */
import type {
  Bg3CampaignSummary,
  Bg3PartyMember,
  Bg3PartySlot,
  Bg3Session,
  Bg3Snapshot,
} from '@raid-ledger/contract';
import type { HubMediaCursor } from '../../../hub-media/hub-media.cursor';
import { slotKeys } from '../claims/bg3-party-slot.helpers';
import type { Bg3ClusteredSession } from '../history/bg3-sessions.helpers';
import type { Bg3ClaimView, Bg3SnapshotRow } from './bg3-read.repository';

export const bg3HubThumbnailUrl = (hubId: number, saveId: number) =>
  `/plugins/bg3/hubs/${hubId}/saves/${saveId}/thumbnail`;
export const bg3OwnThumbnailUrl = (saveId: number) =>
  `/plugins/bg3/me/saves/${saveId}/thumbnail`;

/** Party members + slot keys + current claims, in save order. */
export function toPartySlots(
  party: Bg3PartyMember[],
  claims: readonly Bg3ClaimView[],
): Bg3PartySlot[] {
  const keys = slotKeys(party);
  const bySlot = new Map(claims.map((c) => [c.slotKey, c]));
  return party.map((member, i) => {
    const slotKey = keys[i] ?? null;
    const claim = slotKey === null ? undefined : bySlot.get(slotKey);
    return {
      ...member,
      slotKey,
      claim: claim
        ? {
            userId: claim.userId,
            displayName: claim.displayName,
            avatarUrl: claim.avatarUrl,
          }
        : null,
    };
  });
}

export function toSnapshot(
  row: Bg3SnapshotRow,
  ctx: { hubId: number; campaignId: number; hidden: boolean },
  party: Bg3PartySlot[],
): Bg3Snapshot {
  const showThumb = !ctx.hidden && row.thumbnailSha256 !== null;
  return {
    empty: false,
    campaignId: ctx.campaignId,
    saveId: row.id,
    saveName: row.saveName,
    savedAt: row.savedAt.toISOString(),
    receivedAt: row.receivedAt.toISOString(),
    uploaderUserId: row.uploaderUserId,
    area: ctx.hidden ? null : row.currentLevel,
    difficulty: row.difficulty,
    ruleset: row.ruleset,
    gameVersion: row.gameVersion,
    platform: row.platform,
    party,
    thumbnailUrl: showThumb ? bg3HubThumbnailUrl(ctx.hubId, row.id) : null,
    spoilersHidden: ctx.hidden,
  };
}

export function toSession(
  session: Bg3ClusteredSession,
  ctx: { hubId: number; hidden: boolean; hasThumb: boolean },
): Bg3Session {
  const showThumb = !ctx.hidden && ctx.hasThumb;
  return {
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt.toISOString(),
    saveCount: session.saveCount,
    partyLevelFrom: session.partyLevelFrom,
    partyLevelTo: session.partyLevelTo,
    areas: ctx.hidden ? null : session.areas,
    lastSaveId: session.lastSaveId,
    thumbnailUrl: showThumb
      ? bg3HubThumbnailUrl(ctx.hubId, session.lastSaveId)
      : null,
  };
}

/** Sessions newest first, strictly after `cursor` (`endedAt`, `lastSaveId`). */
export function pageSessions(
  oldestFirst: readonly Bg3ClusteredSession[],
  cursor: HubMediaCursor | null,
  limit: number,
): { page: Bg3ClusteredSession[]; next: HubMediaCursor | null } {
  const after = (x: Bg3ClusteredSession) =>
    !cursor ||
    x.endedAt < cursor.capturedAt ||
    (x.endedAt.getTime() === cursor.capturedAt.getTime() &&
      x.lastSaveId < cursor.id);
  const rest = [...oldestFirst].reverse().filter(after);
  const page = rest.slice(0, limit);
  const last = page[page.length - 1];
  const more = rest.length > limit && last !== undefined;
  return {
    page,
    next: more ? { capturedAt: last.endedAt, id: last.lastSaveId } : null,
  };
}

/** Grouped campaign row → contract summary (shared with the hub list read). */
export function toBg3CampaignSummary(row: {
  id: number;
  name: string;
  hostUserId: number | null;
  activeId: number | null;
  lastSavedAt: Date | null;
  saveCount: number;
  archivedAt: Date | null;
}): Bg3CampaignSummary {
  const { activeId, lastSavedAt, archivedAt, ...rest } = row;
  return {
    ...rest,
    isActive: activeId === row.id,
    lastSavedAt: lastSavedAt ? lastSavedAt.toISOString() : null,
    archivedAt: archivedAt ? archivedAt.toISOString() : null,
  };
}
