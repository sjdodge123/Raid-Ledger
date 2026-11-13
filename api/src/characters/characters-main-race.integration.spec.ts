/**
 * Concurrent creates for one (user, game) against a real database. Two
 * creates in flight at once used to both count 0 rows (or both demote on an
 * explicit `isMain`), both insert `is_main = true`, and the second hit the
 * partial unique index `idx_one_main_per_game` → 500. `insertCharacterTx` now
 * takes a per-(user, game) advisory lock, so both succeed with one main.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as bcrypt from 'bcrypt';
import { and, eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import { nonEmpty } from '../common/testing/narrow';

async function createMember(
  testApp: TestApp,
  username: string,
): Promise<{ userId: number; token: string }> {
  const email = `${username}@test.local`;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${email}`, username, role: 'member' })
      .returning(),
    'user',
  );
  await testApp.db.insert(schema.localCredentials).values({
    email,
    passwordHash: await bcrypt.hash('TestPassword123!', 4),
    userId: user.id,
  });
  const res = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  return { userId: user.id, token: res.body.access_token as string };
}

function describeMainRace() {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  function create(token: string, name: string, isMain?: boolean) {
    return testApp.request
      .post('/users/me/characters')
      .set('Authorization', `Bearer ${token}`)
      .send({
        gameId: testApp.seed.game.id,
        name,
        class: 'Rogue',
        role: 'dps',
        ...(isMain !== undefined ? { isMain } : {}),
      });
  }

  async function mainFlags(userId: number): Promise<boolean[]> {
    const rows = await testApp.db
      .select({ isMain: schema.characters.isMain })
      .from(schema.characters)
      .where(
        and(
          eq(schema.characters.userId, userId),
          eq(schema.characters.gameId, testApp.seed.game.id),
        ),
      );
    return rows.map((row) => row.isMain);
  }

  it('two first creates at once both succeed with exactly one main', async () => {
    const { userId, token } = await createMember(testApp, 'racer');

    const [a, b] = await Promise.all([
      create(token, 'RacerOne'),
      create(token, 'RacerTwo'),
    ]);

    expect([a.status, b.status]).toEqual([201, 201]);
    const flags = await mainFlags(userId);
    expect(flags).toHaveLength(2);
    expect(flags.filter(Boolean)).toHaveLength(1);
  });

  it('two explicit isMain creates at once both succeed with exactly one main', async () => {
    const { userId, token } = await createMember(testApp, 'mainracer');
    expect((await create(token, 'Existing')).status).toBe(201);

    const [a, b] = await Promise.all([
      create(token, 'MainOne', true),
      create(token, 'MainTwo', true),
    ]);

    expect([a.status, b.status]).toEqual([201, 201]);
    const flags = await mainFlags(userId);
    expect(flags).toHaveLength(3);
    expect(flags.filter(Boolean)).toHaveLength(1);
  });
}

describe('Concurrent character creates (integration)', describeMainRace);
