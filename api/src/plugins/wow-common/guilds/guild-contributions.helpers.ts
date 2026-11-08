import {
  GuildMailworthyStoredDaysSchema,
  GuildMailworthyStoredRulesSchema,
  wowCraftingMasterTitle,
  wowCraftingProfessionName,
  type GuildContributionsMaster,
  type GuildContributionsTemplate,
  type GuildContributionsUser,
  type GuildMailworthyStoredDays,
} from '@raid-ledger/contract';
import { mailworthyNameKey } from '../../../drizzle/schema/guild-mailworthy.name-key';

/**
 * ROK-2148 D.3 — pure read helpers for the Guild contributions card: the
 * latest-roster map, masters, Mailworthy users and the template header.
 * The givers roll-up lives in `guild-contributions.givers.ts`. Every list is
 * filtered to the guild's LATEST roster (D9: members who left are hidden).
 */

const DAY_MS = 86_400_000;
/** D6 / ruling 4 — Mailworthy `PEER_DAYS`. */
export const USERS_WINDOW_DAYS = 60;

/** One latest-snapshot roster member, keyed by `mailworthyNameKey(name)`. */
export interface RosterEntry {
  characterName: string;
  /** Linked RL character (via `characterLink()`), else null. */
  characterId: string | null;
  /** Owner of the linked character, else null (an unlinked member). */
  userId: number | null;
}

export type RosterByKey = ReadonlyMap<string, RosterEntry>;

export interface RosterRow {
  name: string;
  characterId: string | null;
  userId: number | null;
}

/** Roster rows → name-key map; a linked row wins a duplicate name. */
export function buildRoster(rows: readonly RosterRow[]): RosterByKey {
  const byKey = new Map<string, RosterEntry>();
  for (const row of rows) {
    const key = mailworthyNameKey(row.name);
    const held = byKey.get(key);
    if (held && held.characterId !== null) continue;
    byKey.set(key, {
      characterName: row.name,
      characterId: row.characterId,
      userId: row.userId,
    });
  }
  return byKey;
}

/** Unix day index (`floor(ms / 86 400 000)`), the wire's `day` unit. */
export function dayIndex(ms: number): number {
  return Math.floor(ms / DAY_MS);
}

/** Stored days re-parsed (never trusted raw); malformed → no days. */
export function parseStoredDays(raw: unknown): GuildMailworthyStoredDays {
  const parsed = GuildMailworthyStoredDaysSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

export interface StoredTemplate {
  rev: number;
  authorName: string;
  rules: unknown;
}

/** Template header; null when no template is stored. */
export function computeTemplate(
  template: StoredTemplate | null,
  roster: RosterByKey,
): GuildContributionsTemplate | null {
  if (!template) return null;
  const author = roster.get(mailworthyNameKey(template.authorName));
  return {
    rev: new Date(template.rev * 1000).toISOString(),
    authorName: template.authorName,
    authorCharacterId: author?.characterId ?? null,
  };
}

/** One row per rule, sorted by profession name (ruling 6, AC8). */
export function computeMasters(
  template: StoredTemplate | null,
  roster: RosterByKey,
): GuildContributionsMaster[] {
  if (!template) return [];
  const parsed = GuildMailworthyStoredRulesSchema.safeParse(template.rules);
  if (!parsed.success) return [];
  return parsed.data
    .map((rule) => {
      const member = roster.get(mailworthyNameKey(rule.recipientName));
      return {
        professionSkillLineId: rule.professionSkillLineId,
        profession: wowCraftingProfessionName(rule.professionSkillLineId),
        title: wowCraftingMasterTitle(rule.professionSkillLineId),
        recipientName: rule.recipientName,
        characterId: member?.characterId ?? null,
        onRoster: member !== undefined,
      };
    })
    .sort((a, b) => a.profession.localeCompare(b.profession));
}

export interface StoredPeer {
  name: string;
  lastSeenAt: Date;
}

/** Peers seen in the last 60 days AND on the latest roster, by name (AC7). */
export function computeUsers(
  peers: readonly StoredPeer[],
  roster: RosterByKey,
  nowMs: number,
): GuildContributionsUser[] {
  const cutoff = nowMs - USERS_WINDOW_DAYS * DAY_MS;
  const users: GuildContributionsUser[] = [];
  for (const peer of peers) {
    if (peer.lastSeenAt.getTime() < cutoff) continue;
    const member = roster.get(mailworthyNameKey(peer.name));
    if (!member) continue;
    users.push({
      characterName: peer.name,
      characterId: member.characterId,
      lastSeenAt: peer.lastSeenAt.toISOString(),
    });
  }
  return users.sort((a, b) => a.characterName.localeCompare(b.characterName));
}
