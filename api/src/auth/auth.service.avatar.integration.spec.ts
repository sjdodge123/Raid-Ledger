/**
 * ROK-1714 — a removed Discord avatar must clear `users.avatar` (real DB).
 *
 * Discord reports a removed avatar as `null`. It used to be coerced to
 * `undefined`, which Drizzle skips in `.set()`, so the dead CDN hash stayed
 * on the row forever and every surface rendered a broken image. These cases
 * prove the column is actually written NULL on each Discord write path.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

const DISCORD_ID = '100000000000001714';
const STALE_HASH = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

async function insertUser(discordId: string): Promise<number> {
  const [row] = await testApp.db
    .insert(schema.users)
    .values({ discordId, username: 'had-avatar', avatar: STALE_HASH })
    .returning({ id: schema.users.id });
  if (!row) throw new Error('insert returned no row');
  return row.id;
}

async function avatarOf(userId: number): Promise<string | null> {
  const [row] = await testApp.db
    .select({ avatar: schema.users.avatar })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  if (!row) throw new Error(`user ${userId} vanished`);
  return row.avatar;
}

describe('ROK-1714 — removed Discord avatar clears users.avatar', () => {
  it('login of an existing user with avatar null clears the stored hash', async () => {
    const userId = await insertUser(DISCORD_ID);
    const auth = testApp.app.get(AuthService);

    await auth.validateDiscordUser(DISCORD_ID, 'had-avatar', null);

    expect(await avatarOf(userId)).toBeNull();
  });

  it('relink of an unlinked account with avatar null clears the stored hash', async () => {
    const userId = await insertUser(`unlinked:${DISCORD_ID}`);
    const auth = testApp.app.get(AuthService);

    await auth.validateDiscordUser(DISCORD_ID, 'had-avatar', null);

    expect(await avatarOf(userId)).toBeNull();
  });

  it('linkDiscord with avatar null clears the stored hash', async () => {
    const userId = await insertUser(`local:${DISCORD_ID}@test.local`);
    const users = testApp.app.get(UsersService);

    await users.linkDiscord(userId, DISCORD_ID, 'had-avatar', null);

    expect(await avatarOf(userId)).toBeNull();
  });

  it('login with a fresh hash replaces the stale one', async () => {
    const userId = await insertUser(DISCORD_ID);
    const auth = testApp.app.get(AuthService);

    await auth.validateDiscordUser(DISCORD_ID, 'had-avatar', 'freshhash');

    expect(await avatarOf(userId)).toBe('freshhash');
  });
});
