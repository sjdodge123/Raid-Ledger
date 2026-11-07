/**
 * ROK-2107 (F7): migration 0281 moves Blizzard-written professions out of the
 * user-entered column. Seeds OLD-shape rows — professions set,
 * armory_professions NULL (the state before 0281) — then re-executes 0281's
 * UPDATE against the test DB (precedent:
 * discord-bot/services/voice-attendance-late-backfill.integration.spec.ts).
 * The ADD COLUMN is skipped: the harness DB already has the column.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';

const PROFS = {
  primary: [],
  secondary: [],
  syncedAt: '2026-10-01T00:00:00.000Z',
};

let testApp: TestApp;
let userId: number;
let gameId: number;

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: 'local:backfill@test.local', username: 'bf' })
      .returning(),
    'user',
  );
  userId = user.id;
  const [game] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'Backfill WoW', slug: 'backfill-wow' })
      .returning(),
    'game',
  );
  gameId = game.id;
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

/** Run migration 0281's UPDATE statements against the current test DB. */
async function runBackfill(): Promise<void> {
  const file = join(
    __dirname,
    '../drizzle/migrations/0281_characters_armory_professions.sql',
  );
  const statements = readFileSync(file, 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.replace(/^--.*$/gm, '').trim())
    .filter((s) => s.startsWith('UPDATE'));
  expect(statements).toHaveLength(1);
  for (const statement of statements) {
    await testApp.db.execute(sql.raw(statement));
  }
}

interface Seed {
  name: string;
  externalId: string | null;
  gameVariant: string | null;
}

async function seed({ name, externalId, gameVariant }: Seed): Promise<string> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.characters)
      .values({
        userId,
        gameId,
        name,
        realm: 'r',
        externalId,
        gameVariant,
        professions: PROFS,
        armoryProfessions: null,
      })
      .returning({ id: schema.characters.id }),
    name,
  );
  return row.id;
}

async function columns(id: string) {
  const [row] = nonEmpty(
    await testApp.db
      .select({
        professions: schema.characters.professions,
        armory: schema.characters.armoryProfessions,
      })
      .from(schema.characters)
      .where(eq(schema.characters.id, id)),
    'row',
  );
  return row;
}

describe('migration 0281 professions backfill (ROK-2107 D7)', () => {
  it.each([
    ['retail', '111'],
    ['wow_forever', '222'],
  ])(
    'moves an Armory-synced %s row to armory_professions',
    async (variant, ext) => {
      const id = await seed({
        name: variant,
        externalId: ext,
        gameVariant: variant,
      });
      await runBackfill();
      expect(await columns(id)).toEqual({ professions: null, armory: PROFS });
    },
  );

  it.each<[string, Seed]>([
    [
      'a manual (no external id) Forever row',
      { name: 'm', externalId: null, gameVariant: 'wow_forever' },
    ],
    [
      'an Armory classic_era row',
      { name: 'c', externalId: '333', gameVariant: 'classic_era' },
    ],
    [
      'a row with no game variant',
      { name: 'n', externalId: '444', gameVariant: null },
    ],
  ])('leaves %s as a manual entry', async (_label, s) => {
    const id = await seed(s);
    await runBackfill();
    expect(await columns(id)).toEqual({ professions: PROFS, armory: null });
  });
});
