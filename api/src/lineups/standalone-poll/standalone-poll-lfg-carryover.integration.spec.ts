/**
 * ROK-2352 AC7 — an LFG group converted into a poll (`POST /lfg/:gameId/convert
 * ?group` + `pollId`), then locked in: voters AND the poll creator sign up
 * with their hand's roles from the grouping adapter's `buildCarryover`; a
 * follow-up source-event signup (ROK-2320) wins on a clash; the event gets no
 * instance (v1 — the poll schema has no `contentInstances`).
 *
 * A stub `lfg-grouping` adapter owned by `blizzard` is registered on this
 * spec's own game slug; every carried hand is a healer.
 */
import { eq, inArray } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { EXTENSION_POINTS } from '../../plugins/plugin-host/extension-points';
import type { LfgGroupingAdapter } from '../../plugins/plugin-host/lfg-grouping.adapter';
import { PluginRegistryService } from '../../plugins/plugin-host/plugin-registry.service';
import {
  createGame,
  createMembers,
} from '../../lfg/lfg.integration.spec-helpers';
import { LineupNotificationService } from '../lineup-notification.service';

const OWNER = 'blizzard';
const SLUG = 'rok2352-poll-carryover-spec';
const KEY = 'dungeon:1';
const SLOT = new Date('2099-11-12T20:00:00.000Z');
const SLOT_END = new Date('2099-11-12T22:00:00.000Z');
const MMO = { type: 'mmo', tank: 1, healer: 1, dps: 3, flex: 0 };
const TITLE = 'LFG poll carryover lock';

/** Stub adapter: one dungeon; every converted hand carries `healer`. */
const stubAdapter: LfgGroupingAdapter = {
  behaviourId: 'rok2352-poll-spec-grouping',
  listGroups: () => Promise.resolve([]),
  describeGroup: (_ctx, key) =>
    Promise.resolve(
      key === KEY ? { key, label: key, kind: 'dungeon', size: 5 } : null,
    ),
  saveHandDetail: () => Promise.resolve(),
  readMemberDetails: () => Promise.resolve(new Map()),
  buildLockInPatch: () => Promise.resolve({ carryover: new Map() }),
  buildCarryover: async ({ intentIds }) => {
    const ids = intentIds.length > 0 ? intentIds : [-1];
    const rows = await testApp.db
      .select({ userId: schema.lfgIntents.userId })
      .from(schema.lfgIntents)
      .where(inArray(schema.lfgIntents.id, ids));
    return new Map(
      rows.map((r) => [r.userId, { preferredRoles: ['healer' as const] }]),
    );
  },
};

let testApp: TestApp;
let adminToken: string;
let registry: PluginRegistryService;

beforeAll(async () => {
  testApp = await getTestApp();
  registry = testApp.app.get(PluginRegistryService);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

beforeEach(async () => {
  jest
    .spyOn(testApp.app.get(LineupNotificationService), 'notifyEventCreated')
    .mockResolvedValue(undefined);
  await registry.ensureInstalled(OWNER);
  await registry.activate(OWNER);
  registry.registerAdapter(EXTENSION_POINTS.LFG_GROUPING, SLUG, stubAdapter, {
    ownerPluginId: OWNER,
  });
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

async function raiseHand(token: string, gameId: number): Promise<void> {
  const res = await testApp.request
    .post('/lfg')
    .set('Authorization', `Bearer ${token}`)
    .send({ gameId, groupKey: KEY, urgency: 'week' });
  expect(res.status).toBe(201);
}

async function openPoll(gameId: number): Promise<number> {
  const res = await testApp.request
    .post('/scheduling-polls')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ gameId });
  expect(res.status).toBe(201);
  return (res.body as { id: number }).id;
}

async function convertToPoll(gameId: number, pollId: number): Promise<void> {
  const res = await testApp.request
    .post(`/lfg/${gameId}/convert?group=${encodeURIComponent(KEY)}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ pollId });
  expect(res.status).toBe(201);
}

async function seedVotes(matchId: number, userIds: number[]): Promise<void> {
  const [slot] = nonEmpty(
    await testApp.db
      .insert(schema.communityLineupScheduleSlots)
      .values({ matchId, proposedTime: SLOT, suggestedBy: 'user' })
      .returning(),
    'slot',
  );
  for (const userId of userIds) {
    await testApp.db
      .insert(schema.communityLineupScheduleVotes)
      .values({ userId, slotId: slot.id, stance: 'yes' });
  }
}

async function lockIn(matchId: number, gameId: number): Promise<number> {
  const res = await testApp.request
    .post(`/scheduling-polls/${matchId}/lock-in`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      event: {
        title: TITLE,
        startTime: SLOT.toISOString(),
        endTime: SLOT_END.toISOString(),
        gameId,
        slotConfig: MMO,
      },
      startTime: SLOT.toISOString(),
    });
  expect(res.status).toBe(200);
  const [event] = nonEmpty(
    await testApp.db
      .select({ id: schema.events.id })
      .from(schema.events)
      .where(eq(schema.events.title, TITLE)),
    'locked-in event',
  );
  return event.id;
}

async function rolesByUser(
  eventId: number,
): Promise<Record<number, string[] | null>> {
  const rows = await testApp.db
    .select({
      userId: schema.eventSignups.userId,
      preferredRoles: schema.eventSignups.preferredRoles,
    })
    .from(schema.eventSignups)
    .where(eq(schema.eventSignups.eventId, eventId));
  return Object.fromEntries(rows.map((r) => [r.userId, r.preferredRoles]));
}

/** LFG game + poll: admin, a and b hold hands converted into the poll. */
async function seedLfgPoll() {
  const [a, b, voter] = await createMembers(testApp, 'pc-a', 'pc-b', 'pc-v');
  const game = await createGame(testApp, 'Poll Carryover', { slug: SLUG });
  const adminId = testApp.seed.adminUser.id;
  for (const token of [adminToken, a.token, b.token]) {
    await raiseHand(token, game.id);
  }
  const matchId = await openPoll(game.id);
  await convertToPoll(game.id, matchId);
  await seedVotes(matchId, [adminId, a.userId, b.userId, voter.userId]);
  return { game, matchId, adminId, a, b, voter };
}

describe('LFG → poll → lock-in carries hand roles (ROK-2352 AC7)', () => {
  it('signs the creator and the LFG voters up with their hand roles; a plain voter stays blank; no instance', async () => {
    const { game, matchId, adminId, a, b, voter } = await seedLfgPoll();

    const eventId = await lockIn(matchId, game.id);

    expect(await rolesByUser(eventId)).toEqual({
      [adminId]: ['healer'],
      [a.userId]: ['healer'],
      [b.userId]: ['healer'],
      [voter.userId]: null,
    });
    const [event] = await testApp.db
      .select({ contentInstances: schema.events.contentInstances })
      .from(schema.events)
      .where(eq(schema.events.id, eventId));
    expect(event?.contentInstances ?? []).toEqual([]);
  });

  it('a follow-up source-event signup wins over the LFG hand on a clash', async () => {
    const { game, matchId, a } = await seedLfgPoll();
    const [source] = nonEmpty(
      await testApp.db
        .insert(schema.events)
        .values({
          title: 'Ended run',
          creatorId: testApp.seed.adminUser.id,
          gameId: game.id,
          slotConfig: MMO,
          duration: [
            new Date(Date.now() - 3 * 60 * 60 * 1000),
            new Date(Date.now() - 60 * 60 * 1000),
          ],
        })
        .returning(),
      'source event',
    );
    await testApp.db.insert(schema.eventSignups).values({
      eventId: source.id,
      userId: a.userId,
      status: 'signed_up',
      confirmationStatus: 'confirmed',
      preferredRoles: ['tank'],
    });
    await testApp.db
      .insert(schema.postEventFollowupSent)
      .values({ eventId: source.id, matchId });

    const roles = await rolesByUser(await lockIn(matchId, game.id));

    expect(roles[a.userId]).toEqual(['tank']);
  });
});
