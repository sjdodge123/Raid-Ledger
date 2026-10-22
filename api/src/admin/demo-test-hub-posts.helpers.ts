/**
 * ROK-1868 — the hub-post half of the DEMO_MODE `seed-guild` `withContent`
 * fixture: three posts whose bodies exercise the hub-post markdown subset, so
 * smoke specs and fleet test plans assert against known rendering.
 *
 * Restoring: a re-call deletes the guild's posts and re-inserts these three
 * (new ids), so a step that created, edited or deleted a post is reset.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Newest: a bold headline line, a 3-item bullet list, an https:// link. */
export const SEED_HUB_POST_NEWEST = [
  '**Raid night is Tuesday 8pm server time.**',
  'Bring:',
  '- Flasks',
  '- Food',
  '- Repair gold',
  '',
  'Read the [raid strategy](https://www.wowhead.com/classic/guides/raids) first.',
].join('\n');

/** −2 d, edited: numbered list, inline code, strike, app-relative link. */
export const SEED_HUB_POST_EDITED = [
  'Signup checklist:',
  '1. Open [the events page](/events)',
  '2. Pick your role',
  '3. Type `/rl signup` in Discord if you prefer',
  '',
  'Raid starts ~~7pm~~ 8pm.',
].join('\n');

interface SeedPost {
  body: string;
  ageMs: number;
  edited: boolean;
}

/**
 * Newest first. The −9 d post is the plain legacy GM post text, passed in
 * (not imported) so this module has no import cycle with the content seed.
 */
function seedPosts(legacyBody: string): readonly SeedPost[] {
  return [
    { body: SEED_HUB_POST_NEWEST, ageMs: 0, edited: false },
    { body: SEED_HUB_POST_EDITED, ageMs: 2 * DAY_MS, edited: true },
    { body: legacyBody, ageMs: 9 * DAY_MS, edited: false },
  ];
}

function toRow(p: SeedPost, guildId: number, gmUserId: number, now: Date) {
  const createdAt = new Date(now.getTime() - p.ageMs);
  const updatedAt = p.edited
    ? new Date(createdAt.getTime() + HOUR_MS)
    : createdAt;
  return {
    guildId,
    body: p.body,
    authorId: gmUserId,
    createdAt,
    updatedAt,
    updatedBy: p.edited ? gmUserId : null,
  };
}

/** Replace the guild's posts with the three seeded ones; ids newest first. */
export async function seedHubPosts(
  db: Db,
  guild: { guildId: number; gmUserId: number; legacyBody: string },
  now: Date,
): Promise<number[]> {
  const hp = schema.hubPosts;
  await db.delete(hp).where(eq(hp.guildId, guild.guildId));
  const rows = await db
    .insert(hp)
    .values(
      seedPosts(guild.legacyBody).map((p) =>
        toRow(p, guild.guildId, guild.gmUserId, now),
      ),
    )
    .returning({ id: hp.id, createdAt: hp.createdAt });
  return rows
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((r) => r.id);
}
