/**
 * ROK-1927 (P5-api) — the own attunement checklists on
 * `GET /plugins/wow/characters/:id/quests`, against a real database. They
 * ride on the Quests section's visibility, carry only tracked defs of the
 * character's faction whose FINAL quest Blizzard confirmed, and list only
 * confirmed steps (Lead call 2026-11-12).
 */
import { eq } from 'drizzle-orm';
import { CharacterQuestsResponseSchema } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { WOW_FOREVER_GAME_SLUG } from './wow-forever-identity.helpers';

const CAPTURED_AT = new Date('2026-10-01T12:00:00.000Z');
/** MC Horde final, two Onyxia Horde steps and its final; 4974 etc. unconfirmed. */
const CONFIRMED = [7487, 4903, 4941, 6602];
/** Two Onyxia Horde steps done, plus an unrelated quest. */
const QUESTS = { completed: [4903, 4941, 5001], inProgress: [] };
const BASE_DATA = { gear: [], talents: { nodes: [] }, lockouts: [] };

let testApp: TestApp;

async function ensureGame(slug: string): Promise<number> {
  const [existing] = await testApp.db
    .select()
    .from(schema.games)
    .where(eq(schema.games.slug, slug))
    .limit(1);
  if (existing) return existing.id;
  const rows = await testApp.db
    .insert(schema.games)
    .values({ name: slug, slug })
    .returning();
  return nonEmpty(rows, slug)[0].id;
}

async function confirm(ids: readonly number[]): Promise<void> {
  await testApp.db
    .insert(schema.wowDungeonQuestBlizzard)
    .values(
      ids.map((questId) => ({
        questId,
        areaId: 0,
        title: `Quest ${questId}`,
        raw: {},
        fetchedAt: CAPTURED_AT,
        runId: 'rok-1927-p5',
      })),
    )
    .onConflictDoNothing();
}

async function seedCharacter(withQuests: boolean): Promise<string> {
  const gameId = await ensureGame(WOW_FOREVER_GAME_SLUG);
  const rows = await testApp.db
    .insert(schema.characters)
    .values({
      userId: testApp.seed.adminUser.id,
      gameId,
      name: 'Attuned Orc',
      region: 'us',
      race: 'Orc',
      level: 52,
    })
    .returning();
  const id = nonEmpty(rows, 'character')[0].id;
  if (!withQuests) return id;
  await testApp.db.insert(schema.characterAddonSnapshots).values({
    characterId: id,
    section: 'char',
    schema: 2,
    data: { ...BASE_DATA, quests: QUESTS },
    capturedAt: CAPTURED_AT,
    payloadSha256: 'c'.repeat(64),
  });
  return id;
}

async function getQuests(id: string) {
  const res = await testApp.request.get(`/plugins/wow/characters/${id}/quests`);
  expect(res.status).toBe(200);
  return CharacterQuestsResponseSchema.parse(res.body).quests;
}

describe('GET /plugins/wow/characters/:id/quests — attunements (ROK-1927)', () => {
  beforeAll(async () => {
    testApp = await getTestApp();
    testApp.seed = await truncateAllTables(testApp.db);
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  it('lists the faction checklists with only confirmed steps', async () => {
    await confirm(CONFIRMED);
    const quests = await getQuests(await seedCharacter(true));
    const keys = quests?.attunements?.map((a) => a.key);
    expect(keys).toEqual(['mc-horde', 'ony-horde']);
    const ony = quests?.attunements?.find((a) => a.key === 'ony-horde');
    expect(ony).toEqual({
      key: 'ony-horde',
      groupKey: 'onyxia',
      instance: "Onyxia's Lair",
      state: 'in_progress',
      belowLevel: true,
      requiredLevel: 55,
      nextStep: 'Blood of the Black Dragon Champion',
      steps: [
        { label: "Warlord's Command", done: true },
        { label: "Eitrigg's Wisdom", done: true },
        { label: 'Blood of the Black Dragon Champion', done: false },
      ],
    });
  });

  it('hides an attunement until its final quest id is confirmed', async () => {
    await confirm(CONFIRMED);
    const id = await seedCharacter(true);
    const before = await getQuests(id);
    expect(before?.attunements?.some((a) => a.key === 'bwl')).toBe(false);
    await confirm([7761]);
    const after = await getQuests(id);
    expect(after?.attunements?.some((a) => a.key === 'bwl')).toBe(true);
  });

  it('sends an empty list while no attunement id is confirmed', async () => {
    const quests = await getQuests(await seedCharacter(true));
    expect(quests).not.toBeNull();
    expect(quests?.attunements).toEqual([]);
  });

  it('sends no attunements when the quests section is hidden', async () => {
    await confirm(CONFIRMED);
    const id = await seedCharacter(false);
    const res = await testApp.request.get(
      `/plugins/wow/characters/${id}/quests`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ quests: null });
  });
});
