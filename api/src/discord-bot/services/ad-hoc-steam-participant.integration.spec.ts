/**
 * ROK-1800 — game-server (Steam) ad-hoc participants against a real database.
 *
 * What only a real Postgres can prove: the CHECK on identity, the two PARTIAL
 * unique indexes (and that ON CONFLICT infers them via `targetWhere`), and the
 * operator ruling that a linked user in voice AND on the server is ONE row.
 */
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { AdHocParticipantService } from './ad-hoc-participant.service';
import { hasOpenServerPlayers } from './ad-hoc-server-presence.helpers';

const t = schema.adHocParticipants;
const STEAM_A = '76561198000000001';
const STEAM_B = '76561198000000002';
const DISCORD_A = 'rok1800-discord-a';

let testApp: TestApp;
let service: AdHocParticipantService;

/** The PG error drizzle wraps (SQLSTATE + constraint live on `.cause`). */
function pgError(code: string, constraint: string) {
  return {
    cause: expect.objectContaining({ code, constraint_name: constraint }),
  };
}

async function insertEvent(): Promise<number> {
  const now = new Date();
  const [event] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: 'Quick Play',
        creatorId: testApp.seed.adminUser.id,
        duration: [now, new Date(now.getTime() + 3_600_000)],
        isAdHoc: true,
        adHocStatus: 'live',
      })
      .returning(),
    'event',
  );
  return event.id;
}

const rowsOf = (eventId: number) =>
  testApp.db.select().from(t).where(eq(t.eventId, eventId));

const userId = () => testApp.seed.adminUser.id;

function voiceMember(linked: boolean) {
  return {
    discordUserId: DISCORD_A,
    discordUsername: 'VoiceName',
    discordAvatarHash: null,
    userId: linked ? userId() : null,
  };
}

beforeAll(async () => {
  testApp = await getTestApp();
  service = new AdHocParticipantService(testApp.db, new EventEmitter2());
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('AdHocParticipantService — Steam participants (real DB)', () => {
  it('inserts a Steam-only row, then re-opens the same row on rejoin', async () => {
    const eventId = await insertEvent();
    const member = { steamId: STEAM_A, displayName: 'Ragnhild', userId: null };

    expect(await service.addServerParticipant(eventId, member)).toBe(
      'inserted',
    );
    expect(await service.markServerLeave(eventId, STEAM_A)).toBe(true);
    expect(await service.addServerParticipant(eventId, member)).toBe(
      'rejoined',
    );

    const rows = await rowsOf(eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      discordUserId: null,
      steamId: STEAM_A,
      source: 'steam',
      discordUsername: 'Ragnhild',
      leftAt: null,
      sessionCount: 2,
    });
    const [dto] = await service.getRoster(eventId);
    expect(dto).toMatchObject({
      discordUserId: null,
      steamId: STEAM_A,
      source: 'steam',
    });
  });

  it('partial uniques: many null-discord rows coexist, a duplicate steam_id does not', async () => {
    const eventId = await insertEvent();
    await service.addServerParticipant(eventId, {
      steamId: STEAM_A,
      displayName: STEAM_A,
      userId: null,
    });
    await service.addServerParticipant(eventId, {
      steamId: STEAM_B,
      displayName: STEAM_B,
      userId: null,
    });
    await testApp.db
      .insert(t)
      .values({ eventId, discordUserId: 'd-1', discordUsername: 'One' });
    await testApp.db
      .insert(t)
      .values({ eventId, discordUserId: 'd-2', discordUsername: 'Two' });
    expect(await rowsOf(eventId)).toHaveLength(4);

    await expect(
      testApp.db.insert(t).values({
        eventId,
        steamId: STEAM_A,
        source: 'steam',
        discordUsername: 'Dup',
      }),
    ).rejects.toMatchObject(
      pgError('23505', 'ad_hoc_participants_event_steam_unique'),
    );
    await expect(
      testApp.db
        .insert(t)
        .values({ eventId, discordUserId: 'd-1', discordUsername: 'Dup' }),
    ).rejects.toMatchObject(
      pgError('23505', 'ad_hoc_participants_event_discord_user_unique'),
    );
  });
});

describe('AdHocParticipantService — Discord path on the partial index (real DB)', () => {
  it('a voice rejoin still upserts on the partial Discord index', async () => {
    const eventId = await insertEvent();
    await service.addParticipant(eventId, voiceMember(false));
    await service.markLeave(eventId, DISCORD_A);
    await service.addParticipant(eventId, voiceMember(false));
    const rows = await rowsOf(eventId);
    expect(
      rows.map((r) => [r.discordUserId, r.sessionCount, r.leftAt]),
    ).toEqual([[DISCORD_A, 2, null]]);
  });
});

describe('AdHocParticipantService — one participant per linked user (real DB)', () => {
  it('voice first, then the same user on the server → ONE row carrying both ids', async () => {
    const eventId = await insertEvent();
    await service.addParticipant(eventId, voiceMember(true));
    const outcome = await service.addServerParticipant(eventId, {
      steamId: STEAM_A,
      displayName: 'Ragnhild',
      userId: userId(),
    });
    expect(outcome).toBe('merged');
    const rows = await rowsOf(eventId);
    expect(
      rows.map((r) => [
        r.discordUserId,
        r.steamId,
        r.userId,
        r.discordUsername,
      ]),
    ).toEqual([[DISCORD_A, STEAM_A, userId(), 'VoiceName']]);
    // A server leave must not close the row while the player is in voice.
    expect(await service.markServerLeave(eventId, STEAM_A)).toBe(false);
  });

  it('server first, then the same user in voice → ONE row carrying both ids', async () => {
    const eventId = await insertEvent();
    await service.addServerParticipant(eventId, {
      steamId: STEAM_A,
      displayName: 'Ragnhild',
      userId: userId(),
    });
    await service.addParticipant(eventId, voiceMember(true));
    const rows = await rowsOf(eventId);
    expect(
      rows.map((r) => [r.discordUserId, r.steamId, r.userId, r.source]),
    ).toEqual([[DISCORD_A, STEAM_A, userId(), 'steam']]);
  });

  it('CHECK rejects a row with neither a Discord nor a Steam id', async () => {
    const eventId = await insertEvent();
    await expect(
      testApp.db.insert(t).values({ eventId, discordUsername: 'Nobody' }),
    ).rejects.toMatchObject(
      pgError('23514', 'ad_hoc_participants_identity_check'),
    );
  });
});

/** Move every open row's session start `seconds` into the past. */
async function backdate(eventId: number, seconds: number): Promise<void> {
  await testApp.db
    .update(t)
    .set({ joinedAt: new Date(Date.now() - seconds * 1000) })
    .where(eq(t.eventId, eventId));
}

async function onlyRow(eventId: number) {
  const [row] = nonEmpty(await rowsOf(eventId), 'participant row');
  return row;
}

const linkedServer = () => ({
  steamId: STEAM_A,
  displayName: 'Ragnhild',
  userId: userId(),
});

describe('AdHocParticipantService — per-source presence on a shared row (B1)', () => {
  it('a voice leave while still on the server keeps the row open and on the server', async () => {
    const eventId = await insertEvent();
    await service.addParticipant(eventId, voiceMember(true));
    await service.addServerParticipant(eventId, linkedServer());
    await service.markLeave(eventId, DISCORD_A);

    expect(await onlyRow(eventId)).toMatchObject({
      leftAt: null,
      inVoice: false,
      onServer: true,
    });
    expect(await hasOpenServerPlayers(testApp.db, eventId)).toBe(true);
  });

  it('a server leave while still in voice keeps the row open; the voice leave then closes it', async () => {
    const eventId = await insertEvent();
    await service.addServerParticipant(eventId, linkedServer());
    await service.addParticipant(eventId, voiceMember(true));

    expect(await service.markServerLeave(eventId, STEAM_A)).toBe(false);
    expect(await onlyRow(eventId)).toMatchObject({ leftAt: null });
    expect(await hasOpenServerPlayers(testApp.db, eventId)).toBe(false);

    await service.markLeave(eventId, DISCORD_A);
    expect((await onlyRow(eventId)).leftAt).toBeInstanceOf(Date);
  });

  it('after the voice leave, the server leave closes the merged row', async () => {
    const eventId = await insertEvent();
    await service.addParticipant(eventId, voiceMember(true));
    await service.addServerParticipant(eventId, linkedServer());
    await service.markLeave(eventId, DISCORD_A);

    expect(await service.markServerLeave(eventId, STEAM_A)).toBe(true);
    expect((await onlyRow(eventId)).leftAt).toBeInstanceOf(Date);
  });
});

describe('AdHocParticipantService — a re-opened row restarts its session (m10)', () => {
  it('a Steam rejoin does not re-add the earlier span', async () => {
    const eventId = await insertEvent();
    const member = { steamId: STEAM_A, displayName: 'Ragnhild', userId: null };
    await service.addServerParticipant(eventId, member);
    await backdate(eventId, 100);
    await service.markServerLeave(eventId, STEAM_A);
    await service.addServerParticipant(eventId, member);
    await service.markServerLeave(eventId, STEAM_A);

    expect((await onlyRow(eventId)).totalDurationSeconds).toBeLessThan(150);
  });

  it('a voice rejoin does not re-add the earlier span', async () => {
    const eventId = await insertEvent();
    await service.addParticipant(eventId, voiceMember(false));
    await backdate(eventId, 100);
    await service.markLeave(eventId, DISCORD_A);
    await service.addParticipant(eventId, voiceMember(false));
    await service.markLeave(eventId, DISCORD_A);

    expect((await onlyRow(eventId)).totalDurationSeconds).toBeLessThan(150);
  });

  it('markSteamLeave closes a row merged after a voice session, counting once', async () => {
    const eventId = await insertEvent();
    await service.addParticipant(eventId, voiceMember(true));
    await backdate(eventId, 100);
    await service.markLeave(eventId, DISCORD_A);
    expect(await service.addServerParticipant(eventId, linkedServer())).toBe(
      'merged',
    );

    expect(await service.markServerLeave(eventId, STEAM_A)).toBe(true);
    expect((await onlyRow(eventId)).totalDurationSeconds).toBeLessThan(150);
  });
});
