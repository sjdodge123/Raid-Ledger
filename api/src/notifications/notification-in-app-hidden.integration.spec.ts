/**
 * ROK-2290 — bell off + Discord on writes a row hidden from the bell and
 * still DMs, against a real Postgres.
 *
 *   AC1  bell off + Discord on → one `in_app_hidden` row, one dispatch with
 *        its id, non-null DTO, 30-day expiry unless the caller set one
 *   AC2  the hidden row never reaches the bell reads; markAllRead skips it
 *   AC3  bell off + Discord off → no row, no dispatch, null
 *   AC4  bell on → visible row + dispatch (unchanged)
 *   AC5  createMany with one input per outcome keeps the input↔row index
 *   AC6  POST /notifications/:id/read (the DM's `?notif=<id>`) marks it read
 *
 * Discord dispatch is stubbed on the real app singleton (no DMs sent).
 * `create` fires dispatch synchronously before it returns, so the spy has
 * its call once `create` resolves — no sleeps, no polling.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import { at, nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { DEFAULT_CHANNEL_PREFS } from '../drizzle/schema/notification-preferences';
import { DiscordNotificationService } from './discord-notification.service';
import {
  NotificationService,
  type CreateNotificationInput,
} from './notification.service';

const DAY = 24 * 60 * 60 * 1000;
const TYPE = 'new_event';

type Switches = { inApp: boolean; discord: boolean };

let testApp: TestApp;
let service: NotificationService;
let dispatch: jest.SpiedFunction<DiscordNotificationService['dispatch']>;
let dispatchMany: jest.SpiedFunction<
  DiscordNotificationService['dispatchMany']
>;

async function insertUser(tag: string): Promise<number> {
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `hidden-${tag}`, username: `hidden-${tag}` })
      .returning({ id: schema.users.id }),
    'user',
  );
  return u.id;
}

/** Store full prefs with `new_event` set to the given switches. */
async function setPrefs(userId: number, s: Switches): Promise<void> {
  const channelPrefs = {
    ...DEFAULT_CHANNEL_PREFS,
    [TYPE]: { inApp: s.inApp, push: false, discord: s.discord },
  };
  await testApp.db
    .insert(schema.userNotificationPreferences)
    .values({ userId, channelPrefs })
    .onConflictDoUpdate({
      target: schema.userNotificationPreferences.userId,
      set: { channelPrefs },
    });
}

const input = (
  userId: number,
  title: string,
  expiresAt?: Date,
): CreateNotificationInput => ({
  userId,
  type: TYPE,
  title,
  message: `${title} body`,
  ...(expiresAt !== undefined ? { expiresAt } : {}),
});

async function rowsFor(userId: number) {
  return testApp.db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId));
}

/** The DTO id, failing loudly when `create` returned null. */
function idOf(dto: { id: string } | null, what: string): string {
  if (dto === null) throw new Error(`Expected a ${what} DTO, got null`);
  return dto.id;
}

async function rowById(id: string) {
  const [row] = nonEmpty(
    await testApp.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.id, id)),
    `notification ${id}`,
  );
  return row;
}

beforeAll(async () => {
  testApp = await getTestApp();
  service = testApp.app.get(NotificationService);
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  const discord = testApp.app.get(DiscordNotificationService);
  dispatch = jest.spyOn(discord, 'dispatch').mockResolvedValue(false);
  dispatchMany = jest.spyOn(discord, 'dispatchMany').mockResolvedValue(0);
});

afterEach(() => jest.restoreAllMocks());

// No afterAll truncate: the shared integration setup closes the pool.

describe('ROK-2290 AC1 — bell off + Discord on', () => {
  it('stores one hidden row, dispatches once with its id, returns a DTO', async () => {
    const userId = await insertUser('ac1');
    await setPrefs(userId, { inApp: false, discord: true });
    const before = Date.now();

    const dto = await service.create(input(userId, 'Muted bell'));

    expect(dto).not.toBeNull();
    const rows = await rowsFor(userId);
    expect(rows).toHaveLength(1);
    const row = at(rows, 0);
    expect(row.inAppHidden).toBe(true);
    expect(dto?.id).toBe(row.id);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(at(dispatch.mock.calls, 0)[0]).toMatchObject({
      notificationId: row.id,
      userId,
      type: TYPE,
    });
    const expires = row.expiresAt?.getTime() ?? 0;
    expect(expires).toBeGreaterThanOrEqual(before + 30 * DAY - 60_000);
    expect(expires).toBeLessThanOrEqual(Date.now() + 30 * DAY + 60_000);
  });

  it("keeps the caller's own expiresAt on a hidden row", async () => {
    const userId = await insertUser('ac1-exp');
    await setPrefs(userId, { inApp: false, discord: true });
    const own = new Date(Date.now() + 2 * DAY);

    const dto = await service.create(input(userId, 'Own expiry', own));

    const row = await rowById(idOf(dto, 'dto'));
    expect(row.inAppHidden).toBe(true);
    expect(row.expiresAt?.getTime()).toBe(own.getTime());
  });
});

describe('ROK-2290 AC2 — hidden rows stay out of the bell', () => {
  it('getAll / getUnread / getUnreadCount skip it; markAllRead leaves it unread', async () => {
    const userId = await insertUser('ac2');
    await setPrefs(userId, { inApp: true, discord: true });
    const shown = await service.create(input(userId, 'Visible'));
    await setPrefs(userId, { inApp: false, discord: true });
    const hidden = await service.create(input(userId, 'Hidden'));
    const shownId = idOf(shown, 'shown');
    const hiddenId = idOf(hidden, 'hidden');
    expect((await rowById(hiddenId)).inAppHidden).toBe(true);

    expect((await service.getAll(userId)).map((n) => n.id)).toEqual([shownId]);
    expect((await service.getUnread(userId)).map((n) => n.id)).toEqual([
      shownId,
    ]);
    expect(await service.getUnreadCount(userId)).toBe(1);

    await service.markAllRead(userId);

    expect((await rowById(shownId)).readAt).not.toBeNull();
    expect((await rowById(hiddenId)).readAt).toBeNull();
    expect(await service.getUnreadCount(userId)).toBe(0);
  });
});

describe('ROK-2290 AC3 — bell off + Discord off', () => {
  it('writes no row, dispatches nothing, returns null', async () => {
    const userId = await insertUser('ac3');
    await setPrefs(userId, { inApp: false, discord: false });

    const dto = await service.create(input(userId, 'Silent'));

    expect(dto).toBeNull();
    expect(await rowsFor(userId)).toHaveLength(0);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('ROK-2290 AC4 — bell on', () => {
  it('stores a visible row with no default expiry and dispatches', async () => {
    const userId = await insertUser('ac4');
    await setPrefs(userId, { inApp: true, discord: true });

    const dto = await service.create(input(userId, 'Bell on'));

    const rows = await rowsFor(userId);
    expect(rows).toHaveLength(1);
    const row = at(rows, 0);
    expect(row.inAppHidden).toBe(false);
    expect(row.expiresAt).toBeNull();
    expect(dto?.id).toBe(row.id);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(at(dispatch.mock.calls, 0)[0].notificationId).toBe(row.id);
    expect((await service.getAll(userId)).map((n) => n.id)).toEqual([row.id]);
  });
});

describe('ROK-2290 AC5 — createMany with one input per outcome', () => {
  it('drops the muted input and keeps input↔row↔job alignment', async () => {
    const both = await insertUser('ac5-both');
    const dmOnly = await insertUser('ac5-dm');
    const none = await insertUser('ac5-none');
    await setPrefs(both, { inApp: true, discord: true });
    await setPrefs(dmOnly, { inApp: false, discord: true });
    await setPrefs(none, { inApp: false, discord: false });

    const created = await service.createMany([
      input(none, 'none'),
      input(both, 'both'),
      input(dmOnly, 'dm-only'),
    ]);

    expect(created.map((n) => [n.userId, n.title])).toEqual([
      [both, 'both'],
      [dmOnly, 'dm-only'],
    ]);
    expect(await rowsFor(none)).toHaveLength(0);
    const bothRow = await rowById(at(created, 0).id);
    const dmRow = await rowById(at(created, 1).id);
    expect([bothRow.userId, bothRow.inAppHidden]).toEqual([both, false]);
    expect([dmRow.userId, dmRow.inAppHidden]).toEqual([dmOnly, true]);
    expect(dmRow.expiresAt).not.toBeNull();

    expect(dispatchMany).toHaveBeenCalledTimes(1);
    const jobs = at(dispatchMany.mock.calls, 0)[0];
    expect(jobs.map((j) => [j.notificationId, j.userId, j.title])).toEqual([
      [bothRow.id, both, 'both'],
      [dmRow.id, dmOnly, 'dm-only'],
    ]);
  });
});

describe('ROK-2290 AC6 — the DM link marks the hidden row read', () => {
  it('POST /notifications/:id/read succeeds on a hidden row', async () => {
    const token = await loginAsAdmin(testApp.request, testApp.seed);
    const userId = testApp.seed.adminUser.id;
    await setPrefs(userId, { inApp: false, discord: true });
    const dto = await service.create(input(userId, 'DM link'));
    const id = idOf(dto, 'dto');
    expect((await rowById(id)).inAppHidden).toBe(true);

    const res = await testApp.request
      .post(`/notifications/${id}/read`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBeLessThan(300);
    expect(res.body).toEqual({ success: true });
    expect((await rowById(id)).readAt).not.toBeNull();
  });
});
