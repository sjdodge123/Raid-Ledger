import { inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { addonErrorRecordHash } from '../plugins/wow-common/companion/wow-addon-errors.scrub';

type Db = PostgresJsDatabase<typeof schema>;
type RecordInsert = schema.WowAddonErrorRecordInsert;

/** Stand-in account key (the real one is a SHA-256 of a folder name). */
export const DEMO_ACCOUNT_KEY = '0'.repeat(64);
const HOUR_MS = 3_600_000;

/** One scrubbed record row; hash computed like the S2 handler (D5). */
export function addonErrorRow(
  userId: number,
  r: Pick<RecordInsert, 'addon' | 'message'> & Partial<RecordInsert>,
  now: Date,
): RecordInsert {
  const stack = r.stack ?? null;
  return {
    accountKey: DEMO_ACCOUNT_KEY,
    source: 'buggrabber',
    sourceVersion: '10.2.0',
    count: 1,
    firstSeenAt: new Date(now.getTime() - 48 * HOUR_MS),
    lastSeenAt: new Date(now.getTime() - HOUR_MS),
    ...r,
    userId,
    stack,
    recordHash: addonErrorRecordHash(r.addon, r.message, stack),
  };
}

const DEMO_USERS = ['addon-err-aldric', 'addon-err-brannoc', 'addon-err-cyra'];
const QUESTIE = {
  addon: 'Questie',
  message:
    "Questie\\Modules\\QuestieTracker.lua:812: attempt to index field 'quest' (a nil value)",
};

/** Records per demo user index: 2 addons, one group shared by two members. */
function demoRecords(ids: number[], now: Date): RecordInsert[] {
  const [a = 0, b = 0, c = 0] = ids;
  const stack = (line: number) =>
    `[string "@Interface\\AddOns\\Questie\\Modules\\QuestieTracker.lua"]:${line}: in function <...>`;
  return [
    addonErrorRow(
      a,
      {
        ...QUESTIE,
        stack: stack(812),
        count: 14,
        characterName: 'Aldric',
        characterRealm: 'Demo Realm',
      },
      now,
    ),
    addonErrorRow(
      b,
      {
        ...QUESTIE,
        stack: stack(813),
        count: 3,
        characterName: 'Brannoc',
        characterRealm: 'Demo Realm',
        lastSeenAt: new Date(now.getTime() - 3 * HOUR_MS),
      },
      now,
    ),
    addonErrorRow(
      a,
      {
        addon: 'DBM-Core',
        message:
          'DBM-Core\\DBM-Core.lua:5120: bad argument #1 to "format", got nil',
        stack: '[C]: in function `format`',
        count: 2,
        characterName: 'Aldric',
        characterRealm: 'Demo Realm',
      },
      now,
    ),
    addonErrorRow(
      c,
      {
        addon: 'Details',
        message: 'Details\\core\\parser.lua:44: "spell, id" is not a number',
        characterName: 'Cyra',
        characterRealm: 'Other Realm',
        lastSeenAt: new Date(now.getTime() - 26 * HOUR_MS),
      },
      now,
    ),
  ];
}

export interface SeedAddonErrorsResult {
  userIds: number[];
  inserted: number;
}

/**
 * Idempotent: (re)creates the three demo uploaders and replaces their
 * records with the fixed set above. Touches no other user's records.
 */
export async function seedAddonErrors(
  db: Db,
  now: Date,
): Promise<SeedAddonErrorsResult> {
  const users = await db
    .insert(schema.users)
    .values(
      DEMO_USERS.map((username) => ({
        username,
        discordId: `local:${username}@demo.local`,
        role: 'member' as const,
      })),
    )
    .onConflictDoUpdate({
      target: schema.users.discordId,
      set: { updatedAt: now },
    })
    .returning({ id: schema.users.id, username: schema.users.username });
  const ids = DEMO_USERS.map(
    (n) => users.find((u) => u.username === n)?.id ?? 0,
  );
  const t = schema.wowAddonErrorRecords;
  await db.delete(t).where(inArray(t.userId, ids));
  const rows = await db
    .insert(t)
    .values(demoRecords(ids, now))
    .returning({ id: t.id });
  return { userIds: ids, inserted: rows.length };
}
