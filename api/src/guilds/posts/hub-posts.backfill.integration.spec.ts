/**
 * ROK-1868 B1 — migration 0238 copies each guild's legacy GM post into
 * `hub_posts` once: text → one row (body byte-identical, author = last
 * editor, not "Edited"); blank / NULL → nothing; a guild that already has a
 * post → untouched; a re-run inserts nothing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { asc, eq, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

const LEGACY = 'Raid **Tuesday** <b>8pm</b>\r\n\r\n\r\nBring flasks  ';
const EDITED_AT = new Date('2026-10-01T10:00:00.000Z');

async function insertGuild(name: string): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
      })
      .returning(),
    'guild',
  );
  return g.id;
}

async function runBackfill(): Promise<void> {
  const file = join(
    __dirname,
    '../../drizzle/migrations/0238_hub_posts_backfill.sql',
  );
  const statements = readFileSync(file, 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const statement of statements) {
    await testApp.db.execute(sql.raw(statement));
  }
}

interface Guilds {
  text: number;
  blank: number;
  none: number;
  posted: number;
}

async function seedProfiles(): Promise<Guilds> {
  const ids: Guilds = {
    text: await insertGuild('Backfill Text'),
    blank: await insertGuild('Backfill Blank'),
    none: await insertGuild('Backfill Null'),
    posted: await insertGuild('Backfill Posted'),
  };
  const editor = testApp.seed.adminUser.id;
  await testApp.db.insert(schema.guildProfiles).values([
    {
      guildId: ids.text,
      gmPost: LEGACY,
      gmPostUpdatedAt: EDITED_AT,
      gmPostUpdatedBy: editor,
    },
    { guildId: ids.blank, gmPost: '  \n ' },
    { guildId: ids.none, gmPost: null },
    { guildId: ids.posted, gmPost: 'old legacy text' },
  ]);
  await testApp.db
    .insert(schema.hubPosts)
    .values({ guildId: ids.posted, body: 'already posted', authorId: editor });
  return ids;
}

function postsOf(guildId: number) {
  return testApp.db
    .select()
    .from(schema.hubPosts)
    .where(eq(schema.hubPosts.guildId, guildId))
    .orderBy(asc(schema.hubPosts.id));
}

describe('migration 0238 hub_posts backfill (ROK-1868 B1)', () => {
  it('copies the legacy text verbatim, once, as an unedited post', async () => {
    const ids = await seedProfiles();
    await runBackfill();
    const [post, ...extra] = await postsOf(ids.text);
    expect(extra).toHaveLength(0);
    expect(post).toMatchObject({
      body: LEGACY,
      authorId: testApp.seed.adminUser.id,
      updatedBy: null,
      relayChannelId: null,
    });
    expect(post?.createdAt.toISOString()).toBe(EDITED_AT.toISOString());
    expect(post?.updatedAt.toISOString()).toBe(EDITED_AT.toISOString());
  });

  it('skips blank / NULL posts and a guild that already has a post', async () => {
    const ids = await seedProfiles();
    await runBackfill();
    expect(await postsOf(ids.blank)).toHaveLength(0);
    expect(await postsOf(ids.none)).toHaveLength(0);
    const posted = await postsOf(ids.posted);
    expect(posted.map((p) => p.body)).toEqual(['already posted']);
  });

  it('inserts nothing on a re-run', async () => {
    await seedProfiles();
    await runBackfill();
    const before = await testApp.db.select().from(schema.hubPosts);
    await runBackfill();
    const after = await testApp.db.select().from(schema.hubPosts);
    expect(after.map((p) => p.id)).toEqual(before.map((p) => p.id));
  });
});
