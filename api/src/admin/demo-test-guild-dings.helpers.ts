/**
 * ROK-1919 — the optional `withDings: true` half of the DEMO_MODE
 * `POST /admin/test/wow/seed-guild` fixture: three level-up events for the
 * "Recent dings" hub widget, relative to the seed's `now`:
 *   - the GM's Aldren 58 → 60, 2 hours ago (a linked character → a link);
 *   - the unlinked Corvin 59 → 60, 1 day ago (plain text);
 *   - the member's Dainel 59 → 60, 31 days ago — outside the 30-day window,
 *     so it must never show.
 *
 * Upserted on `(guild_member_id, to_level)`, so a re-seed of the same guild
 * name refreshes the times instead of piling up rows.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export interface SeedDingMembers {
  /** The GM's linked roster row. */
  linked: number;
  /** An unlinked roster row. */
  unlinked: number;
  /** The row whose ding is older than the feed's window. */
  old: number;
}

export interface SeededGuildDings {
  /** Names the feed shows, newest first. */
  visible: string[];
  /** The ding outside the 30-day window. */
  hidden: string;
}

/** The three events, relative to `now`. */
export function seedDingRows(
  guildId: number,
  members: SeedDingMembers,
  now: Date,
): schema.GuildMemberLevelEventInsert[] {
  const at = (ms: number): Date => new Date(now.getTime() - ms);
  return [
    {
      guildId,
      guildMemberId: members.linked,
      fromLevel: 58,
      toLevel: 60,
      occurredAt: at(2 * HOUR_MS),
    },
    {
      guildId,
      guildMemberId: members.unlinked,
      fromLevel: 59,
      toLevel: 60,
      occurredAt: at(DAY_MS),
    },
    {
      guildId,
      guildMemberId: members.old,
      fromLevel: 59,
      toLevel: 60,
      occurredAt: at(31 * DAY_MS),
    },
  ];
}

/** Writes (or refreshes) the guild's three seeded dings. */
export async function seedGuildDings(
  db: Db,
  guildId: number,
  members: SeedDingMembers,
  now: Date,
): Promise<SeededGuildDings> {
  const t = schema.guildMemberLevelEvents;
  await db
    .insert(t)
    .values(seedDingRows(guildId, members, now))
    .onConflictDoUpdate({
      target: [t.guildMemberId, t.toLevel],
      set: {
        fromLevel: sql`excluded.from_level`,
        occurredAt: sql`excluded.occurred_at`,
      },
    });
  return { visible: ['Aldren', 'Corvin'], hidden: 'Dainel' };
}
