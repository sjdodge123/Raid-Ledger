/**
 * ROK-1927 — POST /admin/test/wow/seed-attunements `cast` (integration, real
 * DB): the per-character entries land as Armory rows + a LedgerLink quest
 * log, and the legacy Onyxia trio body keeps working unchanged.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { loginAsAdmin } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { CharacterQuestsService } from '../plugins/wow-common/character-quests.service';
import { WOW_FOREVER_GAME_SLUG } from '../plugins/wow-common/wow-forever-identity.helpers';
import {
  FOREVER_ATTUNEMENTS,
  attunementQuestSteps,
} from '../plugins/wow-common/data/forever-attunements';
import type { SeedGuildResponse } from './demo-test-guild.controller';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const LOG_AT = '2026-11-01T10:00:00.000Z';
const LIST_AT = '2026-11-10T10:00:00.000Z';

let testApp: TestApp;
let adminToken: string;

function post(route: string, body: Record<string, unknown>) {
  return testApp.request
    .post(route)
    .set('Authorization', `Bearer ${adminToken}`)
    .send(body);
}

async function seedWowGame(): Promise<void> {
  const [existing] = await testApp.db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, WOW_FOREVER_GAME_SLUG))
    .limit(1);
  if (existing) return;
  await testApp.db.insert(schema.games).values({
    name: 'World of Warcraft: Forever',
    slug: WOW_FOREVER_GAME_SLUG,
  });
}

async function seedGuild(name: string): Promise<SeedGuildResponse> {
  const res = await post('/admin/test/wow/seed-guild', {
    name,
    gameSlug: WOW_FOREVER_GAME_SLUG,
  });
  expect(res.status).toBe(200);
  return res.body as SeedGuildResponse;
}

function charId(guild: SeedGuildResponse, role: 'gm' | 'officer' | 'member') {
  return nonEmpty(
    [guild.users[role].characterId ?? ''].filter(Boolean),
    role,
  )[0];
}

async function characterRow(id: string) {
  const [row] = await testApp.db
    .select()
    .from(schema.characters)
    .where(eq(schema.characters.id, id));
  return row;
}

async function snapshotRow(id: string) {
  const [row] = await testApp.db
    .select()
    .from(schema.characterAddonSnapshots)
    .where(eq(schema.characterAddonSnapshots.characterId, id));
  return row;
}

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  await seedWowGame();
  process.env.DEMO_MODE = 'true';
  await testApp.app.get(SettingsService).setDemoMode(true);
});

// No truncate: integration-setup.ts owns the DB lifecycle.
afterAll(() => {
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
});

const mcAlliance = attunementQuestSteps(
  nonEmpty(
    FOREVER_ATTUNEMENTS.filter((d) => d.key === 'mc-alliance'),
    'mc-alliance',
  )[0],
).map((s) => s.questId);

describe('POST /admin/test/wow/seed-attunements — cast', () => {
  it('writes the Armory list, faction and an older quest log holding the next quest', async () => {
    const guild = await seedGuild('Attune Cast Guild');
    const id = charId(guild, 'officer');
    const next = nonEmpty(mcAlliance, 'mc-alliance quest')[0];
    const res = await post('/admin/test/wow/seed-attunements', {
      cast: [
        {
          characterId: id,
          attunement: 'mc-alliance',
          completedSteps: 0,
          questLog: [next],
          questLogCapturedAt: LOG_AT,
          completedAt: LIST_AT,
        },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.cast).toEqual([
      expect.objectContaining({
        characterId: id,
        key: 'mc-alliance',
        completedSteps: 0,
      }),
    ]);
    const row = await characterRow(id);
    expect(row?.faction).toBe('alliance');
    expect(row?.armoryQuests).toEqual({
      fetchedAt: LIST_AT,
      completed: [],
    });
    const snap = await snapshotRow(id);
    expect(snap?.data.quests).toEqual({ inProgress: [{ questId: next }] });
    expect(snap?.capturedAt.toISOString()).toBe(LOG_AT);
    const dto = await testApp.app
      .get(CharacterQuestsService)
      .getForCharacter(id);
    expect(dto?.inProgressSyncedAt).toBe(LOG_AT);
  });

  it('rejects an untracked def and an empty body', async () => {
    const guild = await seedGuild('Attune Cast Reject Guild');
    const bad = [
      {
        cast: [
          {
            characterId: charId(guild, 'gm'),
            attunement: 'naxx',
            completedSteps: 0,
          },
        ],
      },
      {},
    ];
    for (const body of bad) {
      expect(
        (await post('/admin/test/wow/seed-attunements', body)).status,
      ).toBe(400);
    }
  });

  it('still takes the legacy trio body and returns an empty cast', async () => {
    const guild = await seedGuild('Attune Trio Guild');
    const res = await post('/admin/test/wow/seed-attunements', {
      characters: {
        done: charId(guild, 'gm'),
        inProgress: charId(guild, 'officer'),
        notStarted: charId(guild, 'member'),
      },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      key: 'ony-horde',
      inProgressSteps: 3,
      cast: [],
    });
  });
});
