/**
 * ROK-1613 — `POST /lfg/:gameId/start-now` against a real DB.
 *
 * The case the helper specs cannot prove: a group of WEEK hands, which the
 * threshold path would never spawn for, started on demand by one of them.
 * Every case carries a MUTATION note naming the single line to revert.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { createMemberAndLogin } from '../../events/signups.integration.spec-helpers';
import { createGame } from '../../lfg/lfg.integration.spec-helpers';
import * as schema from '../../drizzle/schema';
import { LFG_NOW_START_NEEDS_INTENT } from './lfg-now.constants';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

interface Member {
  userId: number;
  token: string;
  discordId: string;
}

async function member(name: string): Promise<Member> {
  const email = `${name}@startnow.test`;
  const m = await createMemberAndLogin(testApp, name, email);
  return { ...m, discordId: `local:${email}` };
}

const postWeek = (token: string, gameId: number) =>
  testApp.request
    .post('/lfg')
    .set('Authorization', `Bearer ${token}`)
    .send({ gameId, urgency: 'week' });

const startNow = (token: string, gameId: number) =>
  testApp.request
    .post(`/lfg/${gameId}/start-now`)
    .set('Authorization', `Bearer ${token}`)
    .send({});

async function liveAdHocEvents(gameId: number) {
  return testApp.db
    .select()
    .from(schema.events)
    .where(
      and(
        eq(schema.events.gameId, gameId),
        eq(schema.events.isAdHoc, true),
        isNull(schema.events.cancelledAt),
      ),
    );
}

async function rosterDiscordIds(eventId: number): Promise<string[]> {
  const rows = await testApp.db
    .select({ discordUserId: schema.eventSignups.discordUserId })
    .from(schema.eventSignups)
    .where(eq(schema.eventSignups.eventId, eventId));
  return rows.map((r) => r.discordUserId ?? '').sort();
}

async function intentStatus(userId: number, gameId: number): Promise<string> {
  const [row] = await testApp.db
    .select({ status: schema.lfgIntents.status })
    .from(schema.lfgIntents)
    .where(
      and(
        eq(schema.lfgIntents.userId, userId),
        eq(schema.lfgIntents.gameId, gameId),
      ),
    );
  return row?.status ?? 'missing';
}

describe('POST /lfg/:gameId/start-now (integration)', () => {
  it('starts a WEEK-only group: one live session, starter rostered, other invited', async () => {
    // MUTATION: derive the creator from `listLiveNowHands` and this 500s —
    // there is no `now` hand anywhere in this group.
    const { id: gameId } = await createGame(testApp, 'startnow-week');
    const starter = await member('starter');
    const other = await member('other');
    await postWeek(starter.token, gameId);
    await postWeek(other.token, gameId);

    const res = await startNow(starter.token, gameId);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      eventId: expect.any(Number),
      spawned: true,
      invited: expect.any(Number),
    });
    const events = await liveAdHocEvents(gameId);
    expect(events).toHaveLength(1);
    expect(events[0].creatorId).toBe(starter.userId);
    expect(events[0].adHocStatus).toBe('live');
    // AC4: the starter is IN, the other is only asked.
    expect(await rosterDiscordIds(events[0].id)).toEqual([starter.discordId]);
    expect(await intentStatus(starter.userId, gameId)).toBe('converted');
    expect(await intentStatus(other.userId, gameId)).toBe('active');
  });

  it('ATTACHES a second press to the live session instead of duplicating (AC5)', async () => {
    // MUTATION: skip `findOpenLfgNowEvent` on the manual branch and this mints
    // a second event on the same game.
    const { id: gameId } = await createGame(testApp, 'startnow-attach');
    const starter = await member('twice');
    await postWeek(starter.token, gameId);

    const first = await startNow(starter.token, gameId);
    const second = await startNow(starter.token, gameId);

    expect(first.body.spawned).toBe(true);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({
      eventId: first.body.eventId,
      spawned: false,
    });
    expect(await liveAdHocEvents(gameId)).toHaveLength(1);
  });

  it('refuses a caller who is not in the group, in the +1-first words (AC6)', async () => {
    // MUTATION: drop the `holdsLiveIntent` guard and a stranger starts a
    // session on somebody else's group.
    const { id: gameId } = await createGame(testApp, 'startnow-stranger');
    const insider = await member('insider');
    const stranger = await member('stranger');
    await postWeek(insider.token, gameId);

    const res = await startNow(stranger.token, gameId);

    expect(res.status).toBe(403);
    expect(res.body.message).toBe(LFG_NOW_START_NEEDS_INTENT);
    expect(await liveAdHocEvents(gameId)).toHaveLength(0);
  });
});
