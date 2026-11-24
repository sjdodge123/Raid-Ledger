/**
 * ROK-2311 migration 0319 data step — real database.
 *
 * Three notification types were split out of older rows. Each new type
 * inherits the stored entry of the row it used to live under, only where the
 * member has no entry for it yet:
 *   community_lineup -> scheduling_poll, lineup_lfg_offer
 *   slot_vacated     -> voice_access_lost
 * The UPDATEs are read from the shipped .sql file (the spec and the migration
 * share one text) and run against seeded pre-migration prefs.
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
  '../drizzle/migrations/0319_notification_prefs_split_inherit.sql',
);

/** The migration's data UPDATEs, verbatim. */
const inherit = readFileSync(MIGRATION, 'utf8')
  .split('--> statement-breakpoint')
  .filter((s) => /UPDATE "user_notification_preferences"/.test(s));

type Prefs = Record<string, unknown>;

const OFF = { inApp: false, push: false, discord: false };
const ON = { inApp: true, push: true, discord: true };
const MIXED = { inApp: false, push: true, discord: true };

/** Each case: stored prefs before, and what the data step must leave. */
const CASES: Record<string, { before: Prefs; after: Prefs }> = {
  lineupOff: {
    before: { community_lineup: OFF },
    after: {
      community_lineup: OFF,
      scheduling_poll: OFF,
      lineup_lfg_offer: OFF,
    },
  },
  lineupOn: {
    before: { community_lineup: ON },
    after: { community_lineup: ON, scheduling_poll: ON, lineup_lfg_offer: ON },
  },
  lineupPartialEntry: {
    before: { community_lineup: { inApp: false } },
    after: {
      community_lineup: { inApp: false },
      scheduling_poll: { inApp: false },
      lineup_lfg_offer: { inApp: false },
    },
  },
  slotVacatedOff: {
    before: { slot_vacated: OFF, new_event: ON },
    after: { slot_vacated: OFF, voice_access_lost: OFF, new_event: ON },
  },
  slotVacatedMixed: {
    before: { slot_vacated: MIXED },
    after: { slot_vacated: MIXED, voice_access_lost: MIXED },
  },
  bothSources: {
    before: { community_lineup: MIXED, slot_vacated: OFF },
    after: {
      community_lineup: MIXED,
      scheduling_poll: MIXED,
      lineup_lfg_offer: MIXED,
      slot_vacated: OFF,
      voice_access_lost: OFF,
    },
  },
  targetsAlreadyPresent: {
    before: {
      community_lineup: OFF,
      scheduling_poll: ON,
      slot_vacated: OFF,
      voice_access_lost: MIXED,
    },
    after: {
      community_lineup: OFF,
      scheduling_poll: ON,
      lineup_lfg_offer: OFF,
      slot_vacated: OFF,
      voice_access_lost: MIXED,
    },
  },
  noSourceKey: {
    before: { new_event: OFF, event_reminder: MIXED },
    after: { new_event: OFF, event_reminder: MIXED },
  },
  emptyObject: { before: {}, after: {} },
  scalarSourceEntry: {
    before: { community_lineup: true, slot_vacated: 'x' },
    after: { community_lineup: true, slot_vacated: 'x' },
  },
};

/** Non-object prefs no app path writes; they must pass through untouched. */
const MALFORMED: Record<string, unknown> = {
  array: [{ community_lineup: OFF }],
  string: 'community_lineup',
  number: 5,
  jsonNull: null,
};

let testApp: TestApp;
let ids: Record<string, number>;

async function seedRow(name: string, prefs: unknown): Promise<number> {
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `split-${name}`, username: `split-${name}` })
      .returning({ id: schema.users.id }),
    'user',
  );
  // Raw jsonb: partial and malformed entries are outside the column's TS type.
  await testApp.db.execute(
    sql`INSERT INTO user_notification_preferences (user_id, channel_prefs)
        VALUES (${u.id}, ${JSON.stringify(prefs)}::jsonb)`,
  );
  return u.id;
}

async function runInherit(): Promise<void> {
  expect(inherit).toHaveLength(3);
  for (const statement of inherit) {
    await testApp.db.execute(sql.raw(statement));
  }
}

/** Stored prefs keyed by case name. */
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

const pick = (key: 'before' | 'after'): Record<string, Prefs> =>
  Object.fromEntries(Object.entries(CASES).map(([n, c]) => [n, c[key]]));

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  ids = {};
  for (const [name, c] of Object.entries(CASES)) {
    ids[name] = await seedRow(name, c.before);
  }
});

// No afterAll truncate: the shared integration setup closes the pool.

describe('ROK-2311 0319 data step — split types inherit their old row', () => {
  it('seeds exactly the pre-migration shapes (fixture proof)', async () => {
    expect(await storedFor(ids)).toEqual(pick('before'));
  });

  it('copies each source entry to its absent split targets only', async () => {
    await runInherit();
    expect(await storedFor(ids)).toEqual(pick('after'));
  });

  it('is idempotent: a second run changes nothing more', async () => {
    await runInherit();
    const once = await storedFor(ids);
    await runInherit();
    expect(await storedFor(ids)).toEqual(once);
    expect(once).toEqual(pick('after'));
  });
});

describe('ROK-2311 0319 data step — malformed stored prefs', () => {
  it('leaves non-object prefs untouched without raising', async () => {
    const malformedIds: Record<string, number> = {};
    for (const [name, value] of Object.entries(MALFORMED)) {
      malformedIds[name] = await seedRow(`bad-${name}`, value);
    }
    await expect(runInherit()).resolves.toBeUndefined();
    expect(await storedFor(malformedIds)).toEqual(MALFORMED);
    expect(await storedFor(ids)).toEqual(pick('after'));
  });
});
