/**
 * ROK-2311 — Scheduling polls and Community Lineup are separate settings rows
 * now. Against a real Postgres prefs row, through `NotificationService.create`:
 *
 *   - a `scheduling_poll` notice still delivers (bell row + DM) with
 *     Community Lineup fully off, and is dropped with Scheduling polls off;
 *   - the reverse for a `community_lineup` notice: Community Lineup off drops
 *     it, Scheduling polls off does not touch it.
 *
 * Discord dispatch is stubbed on the real app singleton (no DMs sent).
 * `create` fires dispatch synchronously before it returns, so the spy has its
 * call once `create` resolves — no sleeps, no polling.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { at, nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import {
  DEFAULT_CHANNEL_PREFS,
  type NotificationType,
} from '../drizzle/schema/notification-preferences';
import { DiscordNotificationService } from './discord-notification.service';
import { NotificationService } from './notification.service';

const OFF = { inApp: false, push: false, discord: false };

let testApp: TestApp;
let service: NotificationService;
let dispatch: jest.SpiedFunction<DiscordNotificationService['dispatch']>;
let seq = 0;

async function insertUser(): Promise<number> {
  seq += 1;
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `split-${seq}`, username: `split-${seq}` })
      .returning({ id: schema.users.id }),
    'user',
  );
  return u.id;
}

/** Store full prefs with only `offType` switched fully off. */
async function turnOff(userId: number, offType: NotificationType) {
  const channelPrefs = { ...DEFAULT_CHANNEL_PREFS, [offType]: OFF };
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

/** Create one notice of `type` for a user whose `offType` row is off. */
async function send(type: NotificationType, offType: NotificationType) {
  const userId = await insertUser();
  await turnOff(userId, offType);
  const dto = await service.create({
    userId,
    type,
    title: `${type} notice`,
    message: `${type} body`,
    payload: { lineupId: 1, matchId: 2 },
  });
  return { userId, dto, rows: await rowsFor(userId) };
}

beforeAll(async () => {
  testApp = await getTestApp();
  service = testApp.app.get(NotificationService);
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  const discord = testApp.app.get(DiscordNotificationService);
  dispatch = jest.spyOn(discord, 'dispatch').mockResolvedValue(false);
});

afterEach(() => jest.restoreAllMocks());

// No afterAll truncate: the shared integration setup closes the pool.

describe('ROK-2311 split rows govern delivery (integration)', () => {
  it.each([
    ['scheduling_poll', 'community_lineup'],
    ['community_lineup', 'scheduling_poll'],
  ] as const)(
    '%s still delivers (bell + DM) with %s fully off',
    async (type, offType) => {
      const { userId, dto, rows } = await send(type, offType);

      expect(rows.map((r) => [r.type, r.inAppHidden])).toEqual([[type, false]]);
      expect(dto?.id).toBe(at(rows, 0).id);
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(at(dispatch.mock.calls, 0)[0]).toMatchObject({ userId, type });
    },
  );

  it.each(['scheduling_poll', 'community_lineup'] as const)(
    '%s with its own row fully off: no row, no DM',
    async (type) => {
      const { dto, rows } = await send(type, type);

      expect(dto).toBeNull();
      expect(rows).toEqual([]);
      expect(dispatch).not.toHaveBeenCalled();
    },
  );
});
