/**
 * ROK-2311 — Scheduling polls and Community Lineup are separate settings rows
 * now. Against a real Postgres prefs row, through `NotificationService.create`
 * and the REAL `DiscordNotificationService.dispatch` (so the Discord switch is
 * read by the row's type):
 *
 *   - a `scheduling_poll` notice still delivers (bell row + DM) with
 *     Community Lineup fully off, and is dropped with Scheduling polls off;
 *   - the reverse for a `community_lineup` notice;
 *   - ROK-2290 middle state per split type: bell off + Discord on gives a
 *     hidden in-app row plus a DM;
 *   - the Discord switch is per row: a row's own Discord off stops its DM,
 *     the OTHER row's Discord off does not.
 *
 * The DM boundary is the `discord-notification` queue's `add('send-dm')`,
 * stubbed so no job runs; `isConnected` is pinned true so the outcome is the
 * preference gate's. `create` fires dispatch fire-and-forget, so each case
 * awaits the dispatch promise it captured — no sleeps, no polling.
 */
import { getQueueToken } from '@nestjs/bullmq';
import { Job, type Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { at, nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import {
  DEFAULT_CHANNEL_PREFS,
  type NotificationType,
} from '../drizzle/schema/notification-preferences';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { DISCORD_NOTIFICATION_QUEUE } from './discord-notification.constants';
import { DiscordNotificationService } from './discord-notification.service';
import { NotificationService } from './notification.service';

type Prefs = Partial<typeof DEFAULT_CHANNEL_PREFS>;
type SplitType = 'scheduling_poll' | 'community_lineup';

const OFF = { inApp: false, push: false, discord: false };
const DISCORD_ONLY = { inApp: false, push: false, discord: true };
const NO_DISCORD = { inApp: true, push: true, discord: false };
const OTHER: Record<SplitType, SplitType> = {
  scheduling_poll: 'community_lineup',
  community_lineup: 'scheduling_poll',
};

let testApp: TestApp;
let service: NotificationService;
let dispatch: jest.SpiedFunction<DiscordNotificationService['dispatch']>;
let sendDm: jest.SpiedFunction<Queue['add']>;
let seq = 0;

async function insertUser(): Promise<number> {
  seq += 1;
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `77230000000000${String(seq).padStart(4, '0')}`,
        username: `split-${seq}`,
      })
      .returning({ id: schema.users.id }),
    'user',
  );
  return u.id;
}

/** Store full prefs with `overrides` laid over the defaults. */
async function setPrefs(userId: number, overrides: Prefs) {
  const channelPrefs = { ...DEFAULT_CHANNEL_PREFS, ...overrides };
  await testApp.db
    .insert(schema.userNotificationPreferences)
    .values({ userId, channelPrefs })
    .onConflictDoUpdate({
      target: schema.userNotificationPreferences.userId,
      set: { channelPrefs },
    });
}

async function rowsFor(userId: number) {
  return testApp.db
    .select({
      id: schema.notifications.id,
      type: schema.notifications.type,
      inAppHidden: schema.notifications.inAppHidden,
    })
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId));
}

/** The real dispatch's resolved value (true = DM enqueued), or null if never called. */
async function dispatchOutcome(): Promise<boolean | null> {
  const first = dispatch.mock.results[0];
  return first ? await first.value : null;
}

/** Create one notice of `type` for a fresh user with `overrides` stored. */
async function send(type: NotificationType, overrides: Prefs) {
  const userId = await insertUser();
  await setPrefs(userId, overrides);
  const dto = await service.create({
    userId,
    type,
    title: `${type} notice`,
    message: `${type} body`,
    payload: { lineupId: 1, matchId: 2 },
  });
  const dm = await dispatchOutcome();
  return { userId, dto, dm, rows: await rowsFor(userId) };
}

function expectOneDm(userId: number, type: NotificationType) {
  expect(sendDm).toHaveBeenCalledTimes(1);
  const [name, data] = at(sendDm.mock.calls, 0);
  expect(name).toBe('send-dm');
  expect(data).toMatchObject({ userId, type });
}

beforeAll(async () => {
  testApp = await getTestApp();
  service = testApp.app.get(NotificationService);
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  jest
    .spyOn(testApp.app.get(DiscordBotClientService), 'isConnected')
    .mockReturnValue(true);
  dispatch = jest.spyOn(
    testApp.app.get(DiscordNotificationService),
    'dispatch',
  );
  const queue = testApp.app.get<Queue>(
    getQueueToken(DISCORD_NOTIFICATION_QUEUE),
  );
  sendDm = jest
    .spyOn(queue, 'add')
    .mockImplementation((name, data) =>
      Promise.resolve(new Job(queue, name, data)),
    );
});

afterEach(() => jest.restoreAllMocks());

// No afterAll truncate: the shared integration setup closes the pool.

describe('ROK-2311 split rows govern delivery (integration)', () => {
  it.each(['scheduling_poll', 'community_lineup'] as const)(
    '%s still delivers (bell + DM) with the other split row fully off',
    async (type) => {
      const { userId, dto, dm, rows } = await send(type, {
        [OTHER[type]]: OFF,
      });

      expect(rows.map((r) => [r.type, r.inAppHidden])).toEqual([[type, false]]);
      expect(dto?.id).toBe(at(rows, 0).id);
      expect(dm).toBe(true);
      expectOneDm(userId, type);
    },
  );

  it.each(['scheduling_poll', 'community_lineup'] as const)(
    '%s with its own row fully off: no row, no DM',
    async (type) => {
      const { dto, dm, rows } = await send(type, { [type]: OFF });

      expect(dto).toBeNull();
      expect(rows).toEqual([]);
      expect(dm).toBeNull();
      expect(sendDm).not.toHaveBeenCalled();
    },
  );

  it.each(['scheduling_poll', 'community_lineup'] as const)(
    'ROK-2290: %s bell off + Discord on (other row fully off) gives a hidden row and a DM',
    async (type) => {
      const { userId, dto, dm, rows } = await send(type, {
        [type]: DISCORD_ONLY,
        [OTHER[type]]: OFF,
      });

      expect(rows.map((r) => [r.type, r.inAppHidden])).toEqual([[type, true]]);
      expect(dto?.id).toBe(at(rows, 0).id);
      expect(dm).toBe(true);
      expectOneDm(userId, type);
    },
  );

  it.each(['scheduling_poll', 'community_lineup'] as const)(
    '%s with only its own Discord off: visible row, dispatch refuses, no DM',
    async (type) => {
      const { dm, rows } = await send(type, { [type]: NO_DISCORD });

      expect(rows.map((r) => [r.type, r.inAppHidden])).toEqual([[type, false]]);
      expect(dm).toBe(false);
      expect(sendDm).not.toHaveBeenCalled();
    },
  );

  it.each(['scheduling_poll', 'community_lineup'] as const)(
    '%s still DMs when only the OTHER split row has Discord off',
    async (type) => {
      const { userId, dm } = await send(type, { [OTHER[type]]: NO_DISCORD });

      expect(dm).toBe(true);
      expectOneDm(userId, type);
    },
  );
});
