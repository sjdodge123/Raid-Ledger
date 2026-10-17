/**
 * ROK-1537 — fleet first-Discord-login admin against a REAL Postgres.
 *
 * The unit spec pins the gates with a mocked db; this one proves the SQL:
 * the placeholder-id exclusion, NULL handling, the NOT EXISTS predicate and
 * the relink path (`AuthService.validateDiscordUser` → `relinkUnlinkedAccount`)
 * all behave as designed on real rows.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { AuthService } from './auth.service';
import {
  FLEET_ADMIN_ID_ENV,
  FLEET_FIRST_LOGIN_ENV,
} from './fleet-first-login-admin.helpers';

const FIRST_ID = '100000000000000001';
const SECOND_ID = '100000000000000002';
const ENV_KEYS = ['DEMO_MODE', FLEET_FIRST_LOGIN_ENV, FLEET_ADMIN_ID_ENV];

let testApp: TestApp;
let auth: AuthService;
const saved: Record<string, string | undefined> = {};

function setFleetEnv(on: boolean): void {
  for (const k of ENV_KEYS) delete process.env[k];
  if (!on) return;
  process.env.DEMO_MODE = 'true';
  process.env[FLEET_FIRST_LOGIN_ENV] = 'true';
}

async function roleOf(discordId: string): Promise<string> {
  const [row] = await testApp.db
    .select({ role: schema.users.role })
    .from(schema.users)
    .where(eq(schema.users.discordId, discordId));
  return row ? String(row.role) : '<no-row>';
}

async function insertUser(discordId: string, role: 'admin' | 'member') {
  await testApp.db
    .insert(schema.users)
    .values({ discordId, username: `u-${discordId}`, role });
}

beforeAll(async () => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  testApp = await getTestApp();
  auth = testApp.app.get(AuthService);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('ROK-1537 — first Discord login admin (real DB)', () => {
  beforeEach(() => setFleetEnv(true));

  it('promotes the first real Discord login, past the admin@local placeholder', async () => {
    // Baseline seed already holds `local:admin@test.local` as admin; add the
    // fleet's own placeholder and a null-id admin (SeedAdmin shape) too.
    await insertUser('local:admin@local', 'admin');
    await testApp.db
      .insert(schema.users)
      .values({ discordId: null, username: 'seed-admin', role: 'admin' });

    const user = await auth.validateDiscordUser(FIRST_ID, 'first');

    expect({ jwtRole: user?.role, dbRole: await roleOf(FIRST_ID) }).toEqual({
      jwtRole: 'admin',
      dbRole: 'admin',
    });
  });

  it('does not promote the second login', async () => {
    await auth.validateDiscordUser(FIRST_ID, 'first');
    const second = await auth.validateDiscordUser(SECOND_ID, 'second');

    expect({ jwtRole: second?.role, dbRole: await roleOf(SECOND_ID) }).toEqual({
      jwtRole: 'member',
      dbRole: 'member',
    });
  });

  it('an existing real Discord admin blocks the promotion', async () => {
    await insertUser(SECOND_ID, 'admin');

    const user = await auth.validateDiscordUser(FIRST_ID, 'first');

    expect({ jwtRole: user?.role, dbRole: await roleOf(FIRST_ID) }).toEqual({
      jwtRole: 'member',
      dbRole: 'member',
    });
  });

  it('an unlinked admin does not count, and the relink path promotes too', async () => {
    // A stale admin whose Discord link was removed must not block the window.
    await insertUser(`unlinked:${SECOND_ID}`, 'admin');
    await insertUser(`unlinked:${FIRST_ID}`, 'member');

    const user = await auth.validateDiscordUser(FIRST_ID, 'relinked');

    expect({ jwtRole: user?.role, dbRole: await roleOf(FIRST_ID) }).toEqual({
      jwtRole: 'admin',
      dbRole: 'admin',
    });
  });

  it('a relink after a Discord admin exists stays member', async () => {
    await insertUser(SECOND_ID, 'admin');
    await insertUser(`unlinked:${FIRST_ID}`, 'member');

    const user = await auth.validateDiscordUser(FIRST_ID, 'relinked');

    expect({ jwtRole: user?.role, dbRole: await roleOf(FIRST_ID) }).toEqual({
      jwtRole: 'member',
      dbRole: 'member',
    });
  });
});

describe('ROK-1537 — outside a fleet env nothing happens (real DB)', () => {
  it('DEMO_MODE unset → the first Discord login stays member', async () => {
    setFleetEnv(false);
    process.env[FLEET_FIRST_LOGIN_ENV] = 'true';

    const user = await auth.validateDiscordUser(FIRST_ID, 'first');

    expect({ jwtRole: user?.role, dbRole: await roleOf(FIRST_ID) }).toEqual({
      jwtRole: 'member',
      dbRole: 'member',
    });
  });
});
