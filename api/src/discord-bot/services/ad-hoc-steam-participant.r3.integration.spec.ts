/**
 * ROK-1800 Codex r3 P2 — participant merges against a real database.
 *
 * 1. A join that overlaps the other source's leave must read the row under
 *    its lock: a stale open snapshot would set only its own flag and leave
 *    `left_at` set while the player is present. The race is made
 *    deterministic: a holder transaction locks the row and applies the leave,
 *    the join queues behind it, then the holder commits.
 * 2. A Steam row left behind while the player was unlinked is folded into
 *    their voice row once the SteamID resolves to them: one row per person.
 */
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { AdHocParticipantService } from './ad-hoc-participant.service';

const t = schema.adHocParticipants;
const STEAM_A = '76561198000000401';
const DISCORD_A = 'rok1800-fe-merge';

let testApp: TestApp;
let service: AdHocParticipantService;

async function insertEvent(): Promise<number> {
  const now = new Date();
  const rows = await testApp.db
    .insert(schema.events)
    .values({
      title: 'Quick Play',
      creatorId: testApp.seed.adminUser.id,
      duration: [now, new Date(now.getTime() + 3_600_000)],
      isAdHoc: true,
      adHocStatus: 'live',
    })
    .returning();
  return nonEmpty(rows, 'event')[0].id;
}

async function untilLockWaiters(n: number): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const rows = await testApp.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if ((rows[0]?.n ?? 0) >= n) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`never saw ${n} lock waiters`);
}

/**
 * Apply `leaveSql` to the row inside a transaction holding its lock, start
 * `join` while it is held, wait until the join queues, then commit.
 */
async function joinDuringLeave(
  rowId: string,
  leaveSql: ReturnType<typeof sql>,
  join: () => Promise<unknown>,
): Promise<void> {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  let held: () => void = () => undefined;
  const isHeld = new Promise<void>((r) => (held = r));
  const holder = testApp.db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM ad_hoc_participants WHERE id = ${rowId} FOR UPDATE`,
    );
    await tx.execute(leaveSql);
    held();
    await gate;
  });
  await isHeld;
  const joined = join();
  await untilLockWaiters(1);
  release();
  await holder;
  await joined;
}

const voiceMember = (userId: number) => ({
  discordUserId: DISCORD_A,
  discordUsername: 'VoiceName',
  discordAvatarHash: null,
  userId,
});

const serverMember = (userId: number | null) => ({
  steamId: STEAM_A,
  displayName: 'Ragnhild',
  userId,
  pelicanServerId: 9800,
});

async function onlyRow(eventId: number) {
  const rows = await testApp.db.select().from(t).where(eq(t.eventId, eventId));
  return nonEmpty(rows, 'participant row')[0];
}

beforeAll(async () => {
  testApp = await getTestApp();
  service = new AdHocParticipantService(testApp.db, new EventEmitter2());
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('a join overlapping the other source leave (Codex r3 P2)', () => {
  it('a voice join re-opens a Steam row a concurrent server leave closed', async () => {
    const eventId = await insertEvent();
    const userId = testApp.seed.adminUser.id;
    await service.addServerParticipant(eventId, serverMember(userId));
    const row = await onlyRow(eventId);

    await joinDuringLeave(
      row.id,
      sql`UPDATE ad_hoc_participants SET left_at = now(), on_server = false
          WHERE id = ${row.id}`,
      () => service.addParticipant(eventId, voiceMember(userId)),
    );

    const after = await onlyRow(eventId);
    expect({
      closed: after.leftAt !== null,
      inVoice: after.inVoice,
      discordUserId: after.discordUserId,
    }).toEqual({ closed: false, inVoice: true, discordUserId: DISCORD_A });
  });

  it('a server join re-opens a voice row a concurrent voice leave closed', async () => {
    const eventId = await insertEvent();
    const userId = testApp.seed.adminUser.id;
    await service.addParticipant(eventId, voiceMember(userId));
    const row = await onlyRow(eventId);

    await joinDuringLeave(
      row.id,
      sql`UPDATE ad_hoc_participants SET left_at = now(), in_voice = false
          WHERE id = ${row.id}`,
      () => service.addServerParticipant(eventId, serverMember(userId)),
    );

    const after = await onlyRow(eventId);
    expect({
      closed: after.leftAt !== null,
      onServer: after.onServer,
      steamId: after.steamId,
    }).toEqual({ closed: false, onServer: true, steamId: STEAM_A });
  });
});

describe('a Steam account linked mid-Quick-Play (Codex r3 P2)', () => {
  it('folds the earlier unlinked Steam row into the voice row: one row per person', async () => {
    const eventId = await insertEvent();
    const userId = testApp.seed.adminUser.id;
    await service.addServerParticipant(eventId, serverMember(null));
    await service.markServerLeave(eventId, STEAM_A);
    await service.addParticipant(eventId, voiceMember(userId));

    await service.addServerParticipant(eventId, serverMember(userId));

    const rows = await testApp.db
      .select()
      .from(t)
      .where(eq(t.eventId, eventId));
    expect(
      rows.map((r) => ({
        steamId: r.steamId,
        discordUserId: r.discordUserId,
        userId: r.userId,
        open: r.leftAt === null,
      })),
    ).toEqual([
      { steamId: STEAM_A, discordUserId: DISCORD_A, userId, open: true },
    ]);
  });
});
