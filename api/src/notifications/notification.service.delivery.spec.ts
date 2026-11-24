/**
 * ROK-2290: `create` / `createMany` honour the bell and Discord switches
 * separately — bell off + Discord on writes a row hidden from the bell and
 * still dispatches the DM with that row's id; both off writes nothing.
 */
import { Logger } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { createManyNotifications } from './notification-batch.helpers';
import { DEFAULT_CHANNEL_PREFS } from '../drizzle/schema/notification-preferences';
import type { DiscordNotificationService } from './discord-notification.service';
import type { CronJobService } from '../cron-jobs/cron-job.service';
import type { CreateNotificationInput } from './notification.types';

type Db = ConstructorParameters<typeof NotificationService>[0];

const sw = (inApp: boolean, discord: boolean) => ({
  inApp,
  push: false,
  discord,
});

function rowFor(values: Record<string, unknown>, idx: number) {
  return {
    id: `row-${idx}`,
    readAt: null,
    createdAt: new Date('2026-11-23T00:00:00.000Z'),
    ...values,
  };
}

/** Db whose select resolves `prefRows` and whose insert echoes its values. */
function makeDb(prefRows: { userId: number; channelPrefs: object }[]) {
  const values = jest.fn(
    (v: Record<string, unknown> | Record<string, unknown>[]) => ({
      returning: jest
        .fn()
        .mockResolvedValue(
          (Array.isArray(v) ? v : [v]).map((x, i) => rowFor(x, i)),
        ),
    }),
  );
  const where = jest.fn(() =>
    Object.assign(Promise.resolve(prefRows), {
      limit: jest.fn().mockResolvedValue(prefRows),
    }),
  );
  const db = {
    select: jest.fn(() => ({ from: jest.fn(() => ({ where })) })),
    insert: jest.fn(() => ({ values, onConflictDoNothing: jest.fn() })),
  };
  return { db: db as unknown as Db, values, insert: db.insert };
}

function makeDiscord() {
  return {
    dispatch: jest.fn().mockResolvedValue(true),
    dispatchMany: jest.fn().mockResolvedValue(1),
  };
}

const input = (userId: number): CreateNotificationInput => ({
  userId,
  type: 'new_event',
  title: 'New event',
  message: 'Raid night',
});

function serviceWith(newEvent: {
  inApp: boolean;
  push: boolean;
  discord: boolean;
}) {
  const prefs = [
    {
      userId: 1,
      channelPrefs: { ...DEFAULT_CHANNEL_PREFS, new_event: newEvent },
    },
  ];
  const { db, values, insert } = makeDb(prefs);
  const discord = makeDiscord();
  const service = new NotificationService(
    db,
    discord as unknown as DiscordNotificationService,
    null,
    {} as CronJobService,
  );
  return { service, values, insert, discord };
}

describe('NotificationService.create — bell vs Discord (ROK-2290)', () => {
  it('bell off + Discord on: inserts a hidden row, DMs with its id, returns the DTO', async () => {
    const { service, values, discord } = serviceWith(sw(false, true));
    const dto = await service.create(input(1));
    expect(values).toHaveBeenCalledTimes(1);
    expect(values.mock.calls[0]?.[0]).toMatchObject({ inAppHidden: true });
    expect(discord.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ notificationId: 'row-0', userId: 1 }),
    );
    expect(dto).toMatchObject({ id: 'row-0' });
  });

  it('bell off + Discord off: inserts nothing, dispatches nothing, returns null', async () => {
    const { service, insert, discord } = serviceWith(sw(false, false));
    expect(await service.create(input(1))).toBeNull();
    expect(insert).not.toHaveBeenCalled();
    expect(discord.dispatch).not.toHaveBeenCalled();
  });

  it('bell on: inserts a visible row and dispatches as before', async () => {
    const { service, values, discord } = serviceWith(sw(true, false));
    const dto = await service.create(input(1));
    expect(values.mock.calls[0]?.[0]).toMatchObject({
      inAppHidden: false,
      expiresAt: null,
    });
    expect(discord.dispatch).toHaveBeenCalledTimes(1);
    expect(dto).not.toBeNull();
  });
});

describe('create — skipDiscord callers with the bell off (ROK-2290 review)', () => {
  it('skipDiscord without callerSendsDm: no row, no DM, returns null (nothing reaches the member)', async () => {
    const { service, insert, discord } = serviceWith(sw(false, true));
    const dto = await service.create({ ...input(1), skipDiscord: true });
    expect(dto).toBeNull();
    expect(insert).not.toHaveBeenCalled();
    expect(discord.dispatch).not.toHaveBeenCalled();
  });

  it("skipDiscord + callerSendsDm: hidden row returned for the caller's own DM, no dispatch", async () => {
    const { service, values, discord } = serviceWith(sw(false, true));
    const dto = await service.create({
      ...input(1),
      skipDiscord: true,
      callerSendsDm: true,
    });
    expect(values.mock.calls[0]?.[0]).toMatchObject({ inAppHidden: true });
    expect(dto).toMatchObject({ id: 'row-0' });
    expect(discord.dispatch).not.toHaveBeenCalled();
  });
});

describe('createManyNotifications — per-input delivery (ROK-2290)', () => {
  it('keeps the input↔row index contract across visible, hidden and dropped inputs', async () => {
    const { db, values } = makeDb([
      { userId: 1, channelPrefs: { new_event: sw(true, true) } },
      { userId: 2, channelPrefs: { new_event: sw(false, false) } },
      { userId: 3, channelPrefs: { new_event: sw(false, true) } },
    ]);
    const discord = makeDiscord();
    const dtos = await createManyNotifications(
      db,
      new Logger('test'),
      discord as unknown as DiscordNotificationService,
      [input(1), input(2), input(3)],
    );
    const inserted = values.mock.calls[0]?.[0];
    expect(inserted).toEqual([
      expect.objectContaining({ userId: 1, inAppHidden: false }),
      expect.objectContaining({ userId: 3, inAppHidden: true }),
    ]);
    expect(dtos.map((d) => d.userId)).toEqual([1, 3]);
    expect(discord.dispatchMany).toHaveBeenCalledWith([
      expect.objectContaining({ notificationId: 'row-0', userId: 1 }),
      expect.objectContaining({ notificationId: 'row-1', userId: 3 }),
    ]);
  });

  it('returns [] and inserts nothing when every input has both switches off', async () => {
    const { db, values } = makeDb([
      { userId: 2, channelPrefs: { new_event: sw(false, false) } },
    ]);
    const dtos = await createManyNotifications(db, new Logger('test'), null, [
      input(2),
    ]);
    expect(dtos).toEqual([]);
    expect(values).not.toHaveBeenCalled();
  });

  it('drops a bell-off skipDiscord input without callerSendsDm, keeps one with it', async () => {
    const { db, values } = makeDb([
      { userId: 1, channelPrefs: { new_event: sw(false, true) } },
      { userId: 2, channelPrefs: { new_event: sw(false, true) } },
    ]);
    const dtos = await createManyNotifications(db, new Logger('test'), null, [
      { ...input(1), skipDiscord: true },
      { ...input(2), skipDiscord: true, callerSendsDm: true },
    ]);
    expect(values.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({ userId: 2, inAppHidden: true }),
    ]);
    expect(dtos.map((d) => d.userId)).toEqual([2]);
  });
});
