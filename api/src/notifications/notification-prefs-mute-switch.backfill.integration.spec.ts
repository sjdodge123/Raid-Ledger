/**
 * ROK-2290 migration 0317 data step — real database.
 *
 * Until 0317 the bell switch silenced Discord too. The migration turns the
 * Discord switch OFF for every stored type entry whose bell is off and whose
 * Discord is effectively on, so members who muted a bell keep getting
 * nothing. The UPDATE is read from the shipped .sql file (the spec and the
 * migration share one text) and run against seeded pre-migration prefs.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inArray, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';

const MIGRATION = join(
  __dirname,
  '../drizzle/migrations/0317_notifications_in_app_hidden.sql',
);

/** The migration's data UPDATE, verbatim (the ALTER already ran). */
const backfill = readFileSync(MIGRATION, 'utf8')
  .split('--> statement-breakpoint')
  .filter((s) => /UPDATE "user_notification_preferences"/.test(s));

type Prefs = Record<string, Record<string, boolean>>;

/** Each case: stored prefs before, and what the data step must leave. */
const CASES: Record<string, { before: Prefs; after: Prefs }> = {
  bellOffDiscordOn: {
    before: {
      new_event: { push: true, inApp: false, discord: true },
      slot_vacated: { push: true, inApp: true, discord: true },
    },
    after: {
      new_event: { push: true, inApp: false, discord: false },
      slot_vacated: { push: true, inApp: true, discord: true },
    },
  },
  bellOffDiscordAbsentDefaultOn: {
    before: { event_reminder: { inApp: false } },
    after: { event_reminder: { inApp: false, discord: false } },
  },
  bellOffDiscordOff: {
    before: { bench_promoted: { push: true, inApp: false, discord: false } },
    after: { bench_promoted: { push: true, inApp: false, discord: false } },
  },
  bellOn: {
    before: { new_event: { push: false, inApp: true, discord: true } },
    after: { new_event: { push: false, inApp: true, discord: true } },
  },
  valheimDmOnly: {
    before: {
      valheim_claim_suggestion: { push: false, inApp: false, discord: true },
    },
    after: {
      valheim_claim_suggestion: { push: false, inApp: false, discord: true },
    },
  },
  bellOffDiscordAbsentDefaultOff: {
    before: { system: { inApp: false } },
    after: { system: { inApp: false } },
  },
  defaultOffTypeExplicitDiscordOn: {
    before: {
      system: { inApp: false },
      level_up: { inApp: false, discord: true },
    },
    after: {
      system: { inApp: false },
      level_up: { inApp: false, discord: false },
    },
  },
};

let testApp: TestApp;
let ids: Record<string, number>;

async function seedCase(name: string, prefs: Prefs): Promise<number> {
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `bf-${name}`, username: `bf-${name}` })
      .returning({ id: schema.users.id }),
    'user',
  );
  // Raw jsonb: partial entries are what members really have stored, and the
  // column's TS type only admits the full matrix.
  await testApp.db.execute(
    sql`INSERT INTO user_notification_preferences (user_id, channel_prefs)
        VALUES (${u.id}, ${JSON.stringify(prefs)}::jsonb)`,
  );
  return u.id;
}

async function runBackfill(): Promise<void> {
  expect(backfill).toHaveLength(1);
  for (const statement of backfill) {
    await testApp.db.execute(sql.raw(statement));
  }
}

/** Stored prefs keyed by case name. */
async function stored(): Promise<Record<string, unknown>> {
  const rows = await testApp.db
    .select({
      userId: schema.userNotificationPreferences.userId,
      prefs: schema.userNotificationPreferences.channelPrefs,
    })
    .from(schema.userNotificationPreferences)
    .where(
      inArray(schema.userNotificationPreferences.userId, Object.values(ids)),
    );
  const byUser = new Map(rows.map((r) => [r.userId, r.prefs]));
  return Object.fromEntries(
    Object.entries(ids).map(([name, id]) => [name, byUser.get(id)]),
  );
}

/** Malformed shapes no app path writes; jsonb_each raises on a non-object. */
const MALFORMED: Record<string, unknown> = {
  array: [],
  string: 'x',
  number: 5,
  jsonNull: null,
  emptyObject: {},
  scalarEntry: { new_event: true },
};

async function seedMalformed(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(MALFORMED)) {
    const [u] = nonEmpty(
      await testApp.db
        .insert(schema.users)
        .values({ discordId: `bf-bad-${name}`, username: `bf-bad-${name}` })
        .returning({ id: schema.users.id }),
      'user',
    );
    out[name] = u.id;
    await testApp.db.execute(
      sql`INSERT INTO user_notification_preferences (user_id, channel_prefs)
          VALUES (${u.id}, ${JSON.stringify(value)}::jsonb)`,
    );
  }
  return out;
}

async function storedFor(
  byName: Record<string, number>,
): Promise<Record<string, unknown>> {
  const rows = await testApp.db
    .select({
      userId: schema.userNotificationPreferences.userId,
      prefs: schema.userNotificationPreferences.channelPrefs,
    })
    .from(schema.userNotificationPreferences)
    .where(
      inArray(schema.userNotificationPreferences.userId, Object.values(byName)),
    );
  const byUser = new Map<number, unknown>(rows.map((r) => [r.userId, r.prefs]));
  return Object.fromEntries(
    Object.entries(byName).map(([name, id]) => [name, byUser.get(id)]),
  );
}

const expectedAfter = (): Record<string, Prefs> =>
  Object.fromEntries(Object.entries(CASES).map(([n, c]) => [n, c.after]));

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  ids = {};
  for (const [name, c] of Object.entries(CASES)) {
    ids[name] = await seedCase(name, c.before);
  }
});

// No afterAll truncate: the shared integration setup closes the pool.

describe('ROK-2290 0317 data step — mute switch carried to Discord', () => {
  it('seeds exactly the pre-migration shapes (fixture proof)', async () => {
    expect(await stored()).toEqual(
      Object.fromEntries(Object.entries(CASES).map(([n, c]) => [n, c.before])),
    );
  });

  it('turns Discord off only where the bell is off and Discord is effectively on', async () => {
    await runBackfill();
    expect(await stored()).toEqual(expectedAfter());
  });

  it('is idempotent: a second run changes nothing more', async () => {
    await runBackfill();
    const once = await stored();
    await runBackfill();
    expect(await stored()).toEqual(once);
    expect(once).toEqual(expectedAfter());
  });
});

describe('ROK-2290 0317 data step — malformed stored prefs', () => {
  it('leaves non-object prefs and non-object entries untouched without raising', async () => {
    const malformedIds = await seedMalformed();
    await expect(runBackfill()).resolves.toBeUndefined();
    expect(await storedFor(malformedIds)).toEqual(MALFORMED);
    expect(await stored()).toEqual(expectedAfter());
  });
});
