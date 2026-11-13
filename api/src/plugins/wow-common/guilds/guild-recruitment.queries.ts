/**
 * ROK-1789 (S5 part A) — the recruitment columns on `guild_profiles` (no
 * access logic). Writes touch ONLY the recruitment columns + `updated_at`,
 * never rules / links / in-game text.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GuildRecruitment } from '@raid-ledger/contract';
import * as schema from '../../../drizzle/schema';
import {
  buildRecruitmentPatch,
  type RecruitmentRow,
} from './guild-recruitment.helpers';

export type Db = PostgresJsDatabase<typeof schema>;

const { guildProfiles: profiles, users } = schema;

/** The stored recruitment + editor username; null when the guild has no profile row. */
export async function findRecruitmentRow(
  db: Db,
  guildId: number,
): Promise<RecruitmentRow | null> {
  const [row] = await db
    .select({
      recruitment: profiles.recruitment,
      updatedAt: profiles.recruitmentUpdatedAt,
      updatedBy: users.username,
    })
    .from(profiles)
    .leftJoin(users, eq(users.id, profiles.recruitmentUpdatedBy))
    .where(eq(profiles.guildId, guildId));
  return row ?? null;
}

/**
 * Save (`value`) or clear (`null` → the three columns NULL) the guild's
 * recruitment. A save upserts (creates the profile row on the first save);
 * a clear only updates an existing row, never inserting an empty one. Last
 * write wins (A-D4).
 */
export async function upsertRecruitment(
  db: Db,
  guildId: number,
  value: GuildRecruitment | null,
  userId: number,
  now: Date,
): Promise<void> {
  const patch = buildRecruitmentPatch(value, userId, now);
  if (value === null) {
    await db.update(profiles).set(patch).where(eq(profiles.guildId, guildId));
    return;
  }
  await db
    .insert(profiles)
    .values({ guildId, ...patch })
    .onConflictDoUpdate({ target: profiles.guildId, set: patch });
}
