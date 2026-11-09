import type {
  AddonMailworthyGiver,
  AddonMailworthyPeer,
  AddonMailworthyRule,
  AddonMailworthyTemplate,
  GuildMailworthyStoredDays,
} from '@raid-ledger/contract';
import type { GuildMailworthyGiverSource } from '../../../drizzle/schema/guild-mailworthy';
import { mailworthyNameKey } from '../../../drizzle/schema/guild-mailworthy.name-key';

/**
 * ROK-2148 D.2 — pure rules for the Mailworthy apply: template checks,
 * per-export dedupe, the giver clamp and the amended-D5 source.
 */

/** A latest-snapshot roster name: best rank + every linked owner. */
export interface MailworthyRosterEntry {
  rankIndex: number | null;
  ownerUserIds: number[];
}

/** The guild's latest roster keyed by `mailworthyNameKey`. */
export interface MailworthyRoster {
  byKey: Map<string, MailworthyRosterEntry>;
  /** Name key of the exporter's own roster row (matched by GUID). */
  exporterKey: string | undefined;
}

/** Template `rev` may run this far ahead of the server clock (D4). */
export const TEMPLATE_FUTURE_SLACK_S = 600;
/** Peers unseen this long are pruned (D.2 step 5). */
export const PEER_RETENTION_DAYS = 90;
const DAY_MS = 86_400_000;

/** Unix seconds → Date, never later than `nowMs`. */
export function clampedDate(seconds: number, nowMs: number): Date {
  return new Date(Math.min(seconds * 1000, nowMs));
}

/** Peers last seen before this are deleted. */
export function peerCutoff(nowMs: number): Date {
  return new Date(nowMs - PEER_RETENTION_DAYS * DAY_MS);
}

/** Reject reason for a reported template, or null when it may apply. */
export function templateRejection(
  template: AddonMailworthyTemplate,
  roster: MailworthyRoster,
  nowMs: number,
): string | null {
  if (template.rev * 1000 > nowMs + TEMPLATE_FUTURE_SLACK_S * 1000) {
    return 'rev in the future';
  }
  const author = roster.byKey.get(mailworthyNameKey(template.author));
  if (!author) return 'author not on latest roster';
  const rank = author.rankIndex;
  if (rank !== 0 && rank !== 1) return 'author rank not 0-1';
  return null;
}

/** One rule per profession; the last one listed wins. */
export function dedupeRules(
  rules: readonly AddonMailworthyRule[],
): AddonMailworthyRule[] {
  const byId = new Map<number, AddonMailworthyRule>();
  for (const rule of rules) byId.set(rule.professionSkillLineId, rule);
  return [...byId.values()];
}

/** One giver per name key; the newest `asOf` wins (first on a tie). */
export function dedupeGivers(
  givers: readonly AddonMailworthyGiver[],
): AddonMailworthyGiver[] {
  const byKey = new Map<string, AddonMailworthyGiver>();
  for (const giver of givers) {
    const key = mailworthyNameKey(giver.characterName);
    const kept = byKey.get(key);
    if (!kept || giver.asOf > kept.asOf) byKey.set(key, giver);
  }
  return [...byKey.values()];
}

/** `guild_mailworthy_givers.items_all_time` is a Postgres `integer`. */
export const MAX_ITEMS_ALL_TIME = 2_147_483_647;

/**
 * Days deduped by `day` (last wins), ascending; all-time ≥ their sum, capped
 * at int32 (Codex P2: an overflowing sum failed the write and rolled back the
 * whole char import).
 */
export function clampGiver(giver: AddonMailworthyGiver): {
  itemsAllTime: number;
  days: GuildMailworthyStoredDays;
} {
  const byDay = new Map<number, number>();
  for (const d of giver.days) byDay.set(d.day, d.items);
  const days = [...byDay.entries()]
    .sort(([a], [b]) => a - b)
    .map(([day, items]) => ({ day, items }));
  const sum = days.reduce((total, d) => total + d.items, 0);
  const itemsAllTime = Math.max(giver.itemsAllTime, sum);
  return { itemsAllTime: Math.min(itemsAllTime, MAX_ITEMS_ALL_TIME), days };
}

/**
 * Codex P2 — true when a giver (deduped, `asOf` clamped to now) has no stored
 * row in `stored` (name key → stored `as_of`) or a strictly newer `asOf`.
 */
export function anyGiverNewer(
  givers: readonly AddonMailworthyGiver[],
  stored: ReadonlyMap<string, Date>,
  nowMs: number,
): boolean {
  return dedupeGivers(givers).some((giver) => {
    const asOf = stored.get(mailworthyNameKey(giver.characterName));
    return asOf === undefined || clampedDate(giver.asOf, nowMs) > asOf;
  });
}

/**
 * D5 amended: `self` = the exporter or a roster character linked to the
 * importing user; `relayed` = any other roster member; null = off roster.
 */
export function giverSource(
  nameKey: string,
  roster: MailworthyRoster,
  userId: number,
): GuildMailworthyGiverSource | null {
  const entry = roster.byKey.get(nameKey);
  if (!entry) return null;
  if (nameKey === roster.exporterKey) return 'self';
  return entry.ownerUserIds.includes(userId) ? 'self' : 'relayed';
}

/** A peer row to upsert: display name + clamped last-seen instant. */
export interface MailworthyPeerRow {
  nameKey: string;
  name: string;
  lastSeenAt: Date;
}

/** Peers deduped by name key, keeping the latest sighting. */
export function peerRows(
  peers: readonly AddonMailworthyPeer[],
  nowMs: number,
): MailworthyPeerRow[] {
  const byKey = new Map<string, MailworthyPeerRow>();
  for (const peer of peers) {
    const nameKey = mailworthyNameKey(peer.name);
    const lastSeenAt = clampedDate(peer.lastSeenAt, nowMs);
    const kept = byKey.get(nameKey);
    if (!kept || lastSeenAt > kept.lastSeenAt) {
      byKey.set(nameKey, { nameKey, name: peer.name.trim(), lastSeenAt });
    }
  }
  return [...byKey.values()];
}

/**
 * Rows in `nameKey` order. Every multi-row upsert sorts first so two
 * concurrent imports in one guild lock the shared rows in the same order
 * (no deadlock between overlapping peer / giver sets).
 */
export function sortByNameKey<T extends { nameKey: string }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) =>
    a.nameKey < b.nameKey ? -1 : a.nameKey > b.nameKey ? 1 : 0,
  );
}
