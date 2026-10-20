/**
 * ROK-1592 L15 / ROK-1596 W3 / ROK-1598 §2.8: the DEMO_MODE
 * `seed-connection` body and the row it writes.
 *
 * `provider: 'apple'` (ROK-1598) seeds an Apple row WITHOUT iCloud: the
 * subject keeps the `demo-fake:` prefix, so the registry routes every call
 * to the Fake (never CalDAV), and the stored credentials are a `caldav`
 * shape pointing at a fake home set. `status: 'needs_reconnect'` renders the
 * "Password was revoked · reconnect" card (smoke P3, test plans).
 */
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { CalDavCredentials } from '../providers/calendar-provider.interface';
import { DEMO_FAKE_SUBJECT_PREFIX } from '../providers/calendar-provider.registry';
import type { FakeCalendarProvider } from '../providers/testing/fake-calendar.provider';
import { upsertCalendarConnection } from '../services/calendar-connect.helpers';
import { writeConnectionRow } from '../services/calendar-connect.helpers';
import { encryptCalendarCredentials } from '../services/calendar-credentials.helpers';

type Db = PostgresJsDatabase<typeof schema>;

export const SeedConnectionSchema = z
  .object({
    userId: z.number().int().positive().optional(),
    accountLabel: z.string().min(1).max(255).optional(),
    writeEnabled: z.boolean().optional(),
    writeTarget: z.enum(['dedicated', 'primary']).optional(),
    provider: z.enum(['google', 'apple']).optional(),
    status: z.enum(['active', 'needs_reconnect']).optional(),
  })
  .strict();

export type SeedConnectionInput = z.infer<typeof SeedConnectionSchema>;

/** A home set no request ever reaches (the row routes to the Fake). */
const DEMO_HOME_SET = 'https://caldav.icloud.com/0000000/calendars/';

function demoCalDavCredentials(label: string): CalDavCredentials {
  return {
    kind: 'caldav',
    username: label,
    appPassword: 'demo-only-not-a-password',
    principalUrl: 'https://caldav.icloud.com/0000000/principal/',
    homeSetUrl: DEMO_HOME_SET,
  };
}

async function seedApple(
  db: Db,
  userId: number,
  input: SeedConnectionInput,
): Promise<number> {
  const id = randomBytes(6).toString('hex');
  const label = input.accountLabel ?? `demo-${id}@icloud.example`;
  const row = {
    userId,
    provider: 'apple' as const,
    accountSubject: `${DEMO_FAKE_SUBJECT_PREFIX}${id}`,
    accountLabel: label,
  };
  const creds = encryptCalendarCredentials(demoCalDavCredentials(label));
  return writeConnectionRow(db, row, creds, true);
}

async function seedGoogle(
  db: Db,
  fake: FakeCalendarProvider,
  userId: number,
  input: SeedConnectionInput,
): Promise<number> {
  const result = fake.seedConnection({
    id: randomBytes(6).toString('hex'),
    label: input.accountLabel ?? null,
  });
  const { id } = await upsertCalendarConnection(db, {
    userId,
    provider: 'google',
    result,
  });
  return id;
}

/** The optional write/status overrides, in one UPDATE (none → no write). */
function overrides(input: SeedConnectionInput) {
  return {
    ...(input.writeEnabled !== undefined && {
      writeEnabled: input.writeEnabled,
    }),
    ...(input.writeTarget && { writeTarget: input.writeTarget }),
    ...(input.status === 'needs_reconnect' && {
      status: 'needs_reconnect' as const,
      lastErrorCode: 'auth' as const,
    }),
  };
}

export async function seedDemoConnection(
  db: Db,
  fake: FakeCalendarProvider,
  userId: number,
  input: SeedConnectionInput,
): Promise<{ id: number }> {
  const id =
    input.provider === 'apple'
      ? await seedApple(db, userId, input)
      : await seedGoogle(db, fake, userId, input);
  const set = overrides(input);
  if (Object.keys(set).length > 0) {
    await db
      .update(schema.calendarConnections)
      .set(set)
      .where(eq(schema.calendarConnections.id, id));
  }
  return { id };
}
