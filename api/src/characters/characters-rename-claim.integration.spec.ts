/**
 * Rename duplicate-claim check against a real database (TECH-DEBT-BACKLOG
 * 2808). PATCH /users/me/characters/:id re-runs the create-time realm claim
 * check on a real name/realm change only: another user's name+realm is a 409,
 * while the caller's own name (re-sent, or re-cased) never is — even when an
 * old cross-user collision already exists.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import { nonEmpty } from '../common/testing/narrow';

const REALM = 'Stormrage';

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

function describeRenameClaim() {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  async function createCharacter(token: string, name: string) {
    const res = await testApp.request
      .post('/users/me/characters')
      .set('Authorization', `Bearer ${token}`)
      .send({
        gameId: testApp.seed.game.id,
        name,
        realm: REALM,
        class: 'Rogue',
        role: 'dps',
      });
    if (res.status !== 201) {
      throw new Error(`createCharacter ${name} failed: ${res.status}`);
    }
    return res.body.id as string;
  }

  const patch = (token: string, id: string, body: Record<string, unknown>) =>
    testApp.request
      .patch(`/users/me/characters/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  async function storedName(id: string): Promise<string | undefined> {
    const [row] = await testApp.db
      .select({ name: schema.characters.name })
      .from(schema.characters)
      .where(eq(schema.characters.id, id));
    return row?.name;
  }

  it("refuses a rename onto another user's name+realm with 409", async () => {
    const owner = await createMember(testApp, 'owner');
    const renamer = await createMember(testApp, 'renamer');
    await createCharacter(owner.token, 'UniqueChar');
    const mine = await createCharacter(renamer.token, 'OtherChar');

    const res = await patch(renamer.token, mine, { name: 'uniquechar' });

    expect(res.status).toBe(409);
    expect(await storedName(mine)).toBe('OtherChar');
  });

  it('allows a case-only rename of your own character', async () => {
    const owner = await createMember(testApp, 'owner');
    const mine = await createCharacter(owner.token, 'UniqueChar');

    const res = await patch(owner.token, mine, { name: 'UNIQUECHAR' });

    expect(res.status).toBe(200);
    expect(await storedName(mine)).toBe('UNIQUECHAR');
  });

  it('lets an edit re-send the stored name+realm despite an old collision', async () => {
    const owner = await createMember(testApp, 'owner');
    const other = await createMember(testApp, 'other');
    await createCharacter(owner.token, 'UniqueChar');
    // A collision older than the check: inserted directly, bypassing it.
    const [legacy] = nonEmpty(
      await testApp.db
        .insert(schema.characters)
        .values({
          userId: other.userId,
          gameId: testApp.seed.game.id,
          name: 'UniqueChar',
          realm: REALM,
        })
        .returning({ id: schema.characters.id }),
      'legacy character',
    );

    const res = await patch(other.token, legacy.id, {
      name: 'UniqueChar',
      realm: REALM,
      spec: 'Subtlety',
    });

    expect(res.status).toBe(200);
    expect(res.body.spec).toBe('Subtlety');
  });

  it('treats % and _ in a name as literal characters, not wildcards', async () => {
    const owner = await createMember(testApp, 'owner');
    const other = await createMember(testApp, 'other');
    await createCharacter(owner.token, 'Abc');
    const mine = await createCharacter(other.token, 'OtherChar');

    // `A_c` / `A%` would match `Abc` under ILIKE; an exact compare does not.
    const created = await testApp.request
      .post('/users/me/characters')
      .set('Authorization', `Bearer ${other.token}`)
      .send({
        gameId: testApp.seed.game.id,
        name: 'A_c',
        realm: REALM,
        class: 'Rogue',
        role: 'dps',
      });
    const renamed = await patch(other.token, mine, { name: 'A%' });

    expect({ created: created.status, renamed: renamed.status }).toEqual({
      created: 201,
      renamed: 200,
    });
  });
}

describe('Character rename claim check (integration)', describeRenameClaim);
