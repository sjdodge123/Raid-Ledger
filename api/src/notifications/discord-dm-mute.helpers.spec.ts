/**
 * ROK-2317: unit tests for the shared direct-DM switch check.
 */
import { isDiscordDmMuted } from './discord-dm-mute.helpers';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';

let db: MockDb;

beforeEach(() => {
  db = createDrizzleMock();
});

describe('isDiscordDmMuted — by user id', () => {
  it('is muted when the stored Discord channel is OFF for the type', async () => {
    db.limit.mockResolvedValueOnce([
      { channelPrefs: { slot_vacated: { discord: false } } },
    ]);
    await expect(
      isDiscordDmMuted(db as never, { userId: 7 }, 'slot_vacated'),
    ).resolves.toBe(true);
  });

  it('is not muted when the stored Discord channel is ON', async () => {
    db.limit.mockResolvedValueOnce([
      { channelPrefs: { slot_vacated: { discord: true } } },
    ]);
    await expect(
      isDiscordDmMuted(db as never, { userId: 7 }, 'slot_vacated'),
    ).resolves.toBe(false);
  });

  it('only reads the asked type: another type OFF does not mute', async () => {
    db.limit.mockResolvedValueOnce([
      { channelPrefs: { new_event: { discord: false } } },
    ]);
    await expect(
      isDiscordDmMuted(db as never, { userId: 7 }, 'scheduling_poll'),
    ).resolves.toBe(false);
  });

  it('uses the defaults (Discord on) when the account has no prefs row', async () => {
    db.limit.mockResolvedValueOnce([{ channelPrefs: null }]);
    await expect(
      isDiscordDmMuted(db as never, { userId: 7 }, 'new_event'),
    ).resolves.toBe(false);
  });

  it('is not muted when no user row exists', async () => {
    db.limit.mockResolvedValueOnce([]);
    await expect(
      isDiscordDmMuted(db as never, { userId: 7 }, 'new_event'),
    ).resolves.toBe(false);
  });
});

describe('isDiscordDmMuted — by Discord id', () => {
  it('is muted when the linked account has the switch OFF', async () => {
    db.limit.mockResolvedValueOnce([
      { channelPrefs: { post_event_followup: { discord: false } } },
    ]);
    await expect(
      isDiscordDmMuted(
        db as never,
        { discordId: '123' },
        'post_event_followup',
      ),
    ).resolves.toBe(true);
    expect(db.leftJoin).toHaveBeenCalledTimes(1);
  });

  it('is never muted for a Discord id with no Raid Ledger account', async () => {
    db.limit.mockResolvedValueOnce([]);
    await expect(
      isDiscordDmMuted(
        db as never,
        { discordId: '123' },
        'post_event_followup',
      ),
    ).resolves.toBe(false);
  });
});
