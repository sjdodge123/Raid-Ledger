/**
 * ROK-1800 Codex r2 P2 — a voice leave and a server leave for one linked
 * player, landing together, must close the row exactly once.
 *
 * Deterministic race: a holder transaction locks the row, both leaves start
 * and queue behind it (two lock waiters), then the holder lets go. Without
 * serialisation each leave read both flags true and cleared only its own,
 * leaving the row open with both flags false and no PARTICIPANT_LEFT.
 */
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { AD_HOC_EVENTS } from '../discord-bot.constants';
import { AdHocParticipantService } from './ad-hoc-participant.service';

const t = schema.adHocParticipants;
const STEAM_A = '76561198000000301';
const DISCORD_A = 'rok1800-fc-race';

let testApp: TestApp;
let service: AdHocParticipantService;
let emitter: EventEmitter2;

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

async function lockWaiters(): Promise<number> {
  const rows = await testApp.db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`,
  );
  return rows[0]?.n ?? 0;
}

/** Poll until `n` sessions wait on a lock (bounded; fails loudly after). */
async function untilLockWaiters(n: number): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if ((await lockWaiters()) >= n) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`never saw ${n} lock waiters`);
}

beforeAll(async () => {
  testApp = await getTestApp();
  emitter = new EventEmitter2();
  service = new AdHocParticipantService(testApp.db, emitter);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('concurrent voice + server leave (Codex r2 P2)', () => {
  it('closes the merged row once and emits PARTICIPANT_LEFT', async () => {
    const eventId = await insertEvent();
    const userId = testApp.seed.adminUser.id;
    await service.addParticipant(eventId, {
      discordUserId: DISCORD_A,
      discordUsername: 'VoiceName',
      discordAvatarHash: null,
      userId,
    });
    await service.addServerParticipant(eventId, {
      steamId: STEAM_A,
      displayName: 'Ragnhild',
      userId,
      pelicanServerId: 9700,
    });
    const [row] = nonEmpty(
      await testApp.db.select().from(t).where(eq(t.eventId, eventId)),
      'merged row',
    );
    const emit = jest.spyOn(emitter, 'emit');

    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    let held: () => void = () => undefined;
    const isHeld = new Promise<void>((r) => (held = r));
    const holder = testApp.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM ad_hoc_participants
                           WHERE id = ${row.id} FOR UPDATE`);
      held();
      await gate;
    });
    await isHeld;
    const leaves = Promise.all([
      service.markLeave(eventId, DISCORD_A),
      service.markServerLeave(eventId, STEAM_A),
    ]);
    await untilLockWaiters(2);
    release();
    await holder;
    await leaves;

    const [after] = nonEmpty(
      await testApp.db.select().from(t).where(eq(t.id, row.id)),
      'row after',
    );
    expect({
      closed: after.leftAt !== null,
      inVoice: after.inVoice,
      onServer: after.onServer,
    }).toEqual({ closed: true, inVoice: false, onServer: false });
    const left = emit.mock.calls.filter(
      (c) => c[0] === AD_HOC_EVENTS.PARTICIPANT_LEFT,
    );
    expect(left).toHaveLength(1);
  });
});
