/**
 * `quietDms` on the DEMO_MODE `seed-non-guild-user` fixture — the admin
 * moderation smoke's member must survive a live fleet bot's DM fan-out.
 */
import { BadRequestException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import * as schema from '../drizzle/schema';
import { NOTIFICATION_TYPES } from '../drizzle/schema/notification-preferences';
import { DemoTestDeactivationController } from './demo-test-deactivation.controller';
import type { SettingsService } from '../settings/settings.service';
import {
  buildQuietDmChannelPrefs,
  parseQuietDms,
} from './demo-test-quiet-dms.helpers';

describe('parseQuietDms', () => {
  it.each([
    ['no body', undefined, false],
    ['empty body', {}, false],
    ['quietDms true', { quietDms: true }, true],
    ['quietDms false', { quietDms: false }, false],
  ])('parses %s as %s', (_label, body, expected) => {
    expect(parseQuietDms(body)).toBe(expected);
  });

  it('rejects a non-boolean quietDms', () => {
    expect(() => parseQuietDms({ quietDms: 'yes' })).toThrow(
      BadRequestException,
    );
  });
});

describe('buildQuietDmChannelPrefs', () => {
  it('turns Discord off for EVERY notification type, including the nudge paths', () => {
    const prefs = buildQuietDmChannelPrefs();
    const stillOn = NOTIFICATION_TYPES.filter(
      (t) => prefs[t]?.discord !== false,
    );
    expect(stillOn).toEqual([]);
    expect(prefs.lineup_steam_nudge.inApp).toBe(true);
  });
});

describe('POST /admin/test/seed-non-guild-user — quietDms', () => {
  let mockDb: MockDb;
  let controller: DemoTestDeactivationController;
  const prevDemoMode = process.env.DEMO_MODE;

  beforeEach(() => {
    process.env.DEMO_MODE = 'true';
    mockDb = createDrizzleMock();
    mockDb.returning.mockResolvedValue([{ id: 42 }]);
    const settings = {
      getDemoMode: jest.fn().mockResolvedValue(true),
    } as unknown as SettingsService;
    controller = new DemoTestDeactivationController(
      mockDb as unknown as PostgresJsDatabase<typeof schema>,
      settings,
      { add: jest.fn() } as never,
    );
  });

  afterAll(() => {
    process.env.DEMO_MODE = prevDemoMode;
  });

  it('quietDms:true upserts a prefs row with Discord off for the seeded user', async () => {
    const res = await controller.seedNonGuildUser({ quietDms: true });

    expect(res).toMatchObject({ userId: 42, quietDms: true });
    expect(mockDb.insert).toHaveBeenCalledWith(
      schema.userNotificationPreferences,
    );
    expect(mockDb.values).toHaveBeenCalledWith({
      userId: 42,
      channelPrefs: buildQuietDmChannelPrefs(),
    });
  });

  it('default (no body) writes NO prefs row — other callers keep DMs on', async () => {
    const res = await controller.seedNonGuildUser(undefined);

    expect(res.quietDms).toBe(false);
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
    expect(mockDb.insert).toHaveBeenCalledWith(schema.users);
    expect(mockDb.insert).not.toHaveBeenCalledWith(
      schema.userNotificationPreferences,
    );
  });
});
