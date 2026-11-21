/**
 * ROK-2284 lane 1 — the sign-in reminder claim helpers against a real
 * database: concurrent claims never share a row, the batch limit holds,
 * opted-out / capped / inside-cadence / recent-50007 / account-holder /
 * non-candidate rows are never claimed, a failure is recorded and counted,
 * and an abandoned claim becomes claimable again after 30 minutes.
 */
import { eq, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import {
  DISCORD_DM_CLOSED_CODE,
  claimDueSigninReminders,
  ensureSigninReminderRows,
  markSigninReminderSent,
  optOutOfSigninReminders,
  recordSigninReminderFailure,
} from './signin-reminder.db';

const T = schema.discordSigninReminders;
let testApp: TestApp;

const ids = (n: number, prefix = '92840'): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(3, '0')}`);

async function claim(
  candidateIds: readonly string[],
  opts: { weeks?: number; max?: number; limit?: number } = {},
): Promise<string[]> {
  return claimDueSigninReminders(testApp.db, {
    candidateIds,
    weeks: opts.weeks ?? 3,
    max: opts.max ?? 3,
    ...(opts.limit === undefined ? {} : { limit: opts.limit }),
  });
}

async function row(
  discordId: string,
): Promise<schema.DiscordSigninReminderSelect> {
  const rows = await testApp.db
    .select()
    .from(T)
    .where(eq(T.discordId, discordId));
  return nonEmpty(rows, `reminder row ${discordId}`)[0];
}

/** Move a timestamp column of one row `minutes` minutes into the past. */
async function backdate(
  discordId: string,
  column: 'last_sent_at' | 'last_failure_at' | 'claimed_at',
  minutes: number,
): Promise<void> {
  await testApp.db.execute(sql`
    UPDATE discord_signin_reminders
    SET ${sql.identifier(column)} = now() - make_interval(mins => ${minutes})
    WHERE discord_id = ${discordId}`);
}

const DAY = 24 * 60;
const ONE = '928400999';

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('claimDueSigninReminders — batching and concurrency', () => {
  it('claims at most the batch limit (25 by default) and stamps claimed_at', async () => {
    const all = ids(30);
    await ensureSigninReminderRows(testApp.db, all);
    const got = await claim(all);
    expect(got).toHaveLength(25);
    expect((await row(nonEmpty(got, 'claimed')[0])).claimedAt).not.toBeNull();
    expect(await claim(all)).toHaveLength(5);
    expect(await claim(all)).toEqual([]);
  });

  it('two concurrent claims never return the same row', async () => {
    const all = ids(30);
    await ensureSigninReminderRows(testApp.db, all);
    const [a, b] = await Promise.all([claim(all), claim(all)]);
    const overlap = a.filter((id) => b.includes(id));
    expect(overlap).toEqual([]);
    expect(new Set([...a, ...b]).size).toBe(30);
  });

  it('never claims a row that is not among the current candidates', async () => {
    const [inGuild, left] = ['928410001', '928420001'];
    await ensureSigninReminderRows(testApp.db, [inGuild, left]);
    expect(await claim([inGuild])).toEqual([inGuild]);
    expect(await claim([])).toEqual([]);
  });

  it('a live claim blocks a re-claim; a claim older than 30 min is claimable again', async () => {
    const id = ONE;
    await ensureSigninReminderRows(testApp.db, [id]);
    expect(await claim([id])).toEqual([id]);
    await backdate(id, 'claimed_at', 29);
    expect(await claim([id])).toEqual([]);
    await backdate(id, 'claimed_at', 31);
    expect(await claim([id])).toEqual([id]);
  });
});

describe('claimDueSigninReminders — who is never claimed', () => {
  it('skips an opted-out member, and opting out twice keeps the first stamp', async () => {
    const id = ONE;
    await optOutOfSigninReminders(testApp.db, id);
    await testApp.db.execute(sql`
      UPDATE discord_signin_reminders SET opted_out_at = now() - interval '1 day'
      WHERE discord_id = ${id}`);
    const first = (await row(id)).optedOutAt;
    await optOutOfSigninReminders(testApp.db, id);
    await ensureSigninReminderRows(testApp.db, [id]);
    expect((await row(id)).optedOutAt?.toISOString()).toBe(
      first?.toISOString(),
    );
    expect(await claim([id])).toEqual([]);
  });

  it('skips Discord ids that have a user row (linked or unlinked:)', async () => {
    const [linked, unlinked, none] = ['928430001', '928430002', '928430003'];
    await testApp.db.insert(schema.users).values([
      { discordId: linked, username: 'sr-linked', role: 'member' },
      { discordId: `unlinked:${unlinked}`, username: 'sr-unl', role: 'member' },
    ]);
    await ensureSigninReminderRows(testApp.db, [linked, unlinked, none]);
    expect(await claim([linked, unlinked, none])).toEqual([none]);
  });

  it('respects the lifetime maximum', async () => {
    const id = ONE;
    await ensureSigninReminderRows(testApp.db, [id]);
    await testApp.db.update(T).set({ sentCount: 3 }).where(eq(T.discordId, id));
    expect(await claim([id], { max: 3 })).toEqual([]);
    expect(await claim([id], { max: 4 })).toEqual([id]);
  });

  it('respects the cadence: due only once the set number of weeks has passed', async () => {
    const id = ONE;
    await ensureSigninReminderRows(testApp.db, [id]);
    await markSigninReminderSent(testApp.db, id);
    const sent = await row(id);
    expect(sent.sentCount).toBe(1);
    expect(sent.claimedAt).toBeNull();
    expect(await claim([id])).toEqual([]);
    await backdate(id, 'last_sent_at', 20 * DAY);
    expect(await claim([id], { weeks: 3 })).toEqual([]);
    expect(await claim([id], { weeks: 2 })).toEqual([id]);
  });
});

describe('recordSigninReminderFailure', () => {
  it('records a closed DM, counts it as a send and does not re-claim it inside the cadence', async () => {
    const id = ONE;
    await ensureSigninReminderRows(testApp.db, [id]);
    expect(await claim([id])).toEqual([id]);
    await recordSigninReminderFailure(testApp.db, id, DISCORD_DM_CLOSED_CODE);
    const failed = await row(id);
    expect(failed.sentCount).toBe(1);
    expect(failed.lastFailureCode).toBe(50007);
    expect(failed.lastFailureAt).not.toBeNull();
    expect(failed.lastSentAt).not.toBeNull();
    expect(failed.claimedAt).toBeNull();
    expect(await claim([id])).toEqual([]);
    // A recent 50007 blocks on its own, even if the send clock were older.
    await backdate(id, 'last_sent_at', 22 * DAY);
    expect(await claim([id])).toEqual([]);
    await backdate(id, 'last_failure_at', 22 * DAY);
    expect(await claim([id])).toEqual([id]);
  });

  it('a failure on the last allowed attempt stops all further reminders', async () => {
    const id = ONE;
    await ensureSigninReminderRows(testApp.db, [id]);
    await testApp.db.update(T).set({ sentCount: 2 }).where(eq(T.discordId, id));
    await recordSigninReminderFailure(testApp.db, id, null);
    await backdate(id, 'last_sent_at', 30 * DAY);
    await backdate(id, 'last_failure_at', 30 * DAY);
    expect((await row(id)).sentCount).toBe(3);
    expect(await claim([id], { max: 3 })).toEqual([]);
  });
});
