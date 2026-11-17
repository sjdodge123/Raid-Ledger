/**
 * ROK-2234 — the Minecraft plugin's Bedrock `games` row, real DB. The ensure
 * path runs under `withGameNameLock` (via `upsertSeedGame`): it creates the
 * row once, is idempotent, and merges into a same-name row instead of adding
 * a duplicate (CLAUDE.md "Games-table INSERT paths").
 */
import { eq, ilike } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { ensureMinecraftBedrockGame } from './minecraft-bedrock-game';
import {
  MINECRAFT_BEDROCK_GAME_NAME,
  MINECRAFT_BEDROCK_GAME_SLUG,
} from './minecraft.constants';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  // The boot seed may already carry the row; each case starts without it.
  await testApp.db
    .delete(schema.games)
    .where(ilike(schema.games.name, 'minecraft%bedrock%'));
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

async function bedrockRows() {
  return testApp.db
    .select({ id: schema.games.id, slug: schema.games.slug })
    .from(schema.games)
    .where(ilike(schema.games.name, 'minecraft%bedrock%'));
}

describe('ROK-2234 — ensureMinecraftBedrockGame', () => {
  it('creates the Bedrock row when it is missing', async () => {
    const first = await ensureMinecraftBedrockGame(testApp.db);
    expect(first.action).toBe('created');
    expect(await bedrockRows()).toEqual([
      { id: first.id, slug: MINECRAFT_BEDROCK_GAME_SLUG },
    ]);
  });

  it('is idempotent: a second call reuses the same row', async () => {
    const first = await ensureMinecraftBedrockGame(testApp.db);
    const second = await ensureMinecraftBedrockGame(testApp.db);
    expect(second).toEqual({ id: first.id, action: 'updated' });
    expect(await bedrockRows()).toHaveLength(1);
  });

  it('merges into an existing same-name row and stamps the slug', async () => {
    const [existing] = nonEmpty(
      await testApp.db
        .insert(schema.games)
        .values({ name: 'Minecraft Bedrock Edition', slug: 'mc-bedrock-old' })
        .returning({ id: schema.games.id }),
      'pre-existing Bedrock row',
    );
    const result = await ensureMinecraftBedrockGame(testApp.db);
    expect(result).toEqual({ id: existing.id, action: 'merged' });
    const [row] = nonEmpty(
      await testApp.db
        .select({ slug: schema.games.slug, name: schema.games.name })
        .from(schema.games)
        .where(eq(schema.games.id, existing.id)),
      'merged row',
    );
    expect(row).toEqual({
      slug: MINECRAFT_BEDROCK_GAME_SLUG,
      name: 'Minecraft Bedrock Edition',
    });
    expect(await bedrockRows()).toHaveLength(1);
  });
});
