/**
 * ROK-1789 (S5 part A) — the optional `withRecruitment: true` half of the
 * DEMO_MODE `POST /admin/test/wow/seed-guild` fixture: a recruitment object
 * with one row per state (open × 2, limited, closed) and an Apply URL,
 * stamped as the seeded GM. Idempotent and restoring: a re-call rewrites the
 * recruitment columns, so it is the fleet test plan's reset (AC12).
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GuildRecruitment } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { upsertRecruitment } from '../plugins/wow-common/guilds/guild-recruitment.queries';

type Db = PostgresJsDatabase<typeof schema>;

/** AC12: the seeded recruitment (editor order; the card sorts by state). */
export const SEED_GUILD_RECRUITMENT: GuildRecruitment = {
  recruiting: true,
  wanted: [
    { className: 'Priest', role: 'healer', state: 'open', note: 'Holy' },
    { className: 'Warlock', role: 'dps', state: 'open' },
    {
      className: 'Druid',
      role: 'tank',
      state: 'limited',
      note: 'Exceptional only',
    },
    { className: 'Rogue', role: 'dps', state: 'closed' },
  ],
  applyUrl: 'https://example.com/apply',
};

/** `withRecruitment`: upsert the seeded recruitment as `gmUserId`; `{}` when not asked. */
export async function seedRecruitmentHalf(
  db: Db,
  input: { withRecruitment: boolean },
  guildId: number,
  gmUserId: number,
  now: Date,
): Promise<{ recruitment?: GuildRecruitment }> {
  if (!input.withRecruitment) return {};
  await upsertRecruitment(db, guildId, SEED_GUILD_RECRUITMENT, gmUserId, now);
  return { recruitment: SEED_GUILD_RECRUITMENT };
}
