/**
 * ROK-2290: delivery is decided from the member's switches only — bell on →
 * 'both', bell off + Discord on → 'dm-only' (hidden row + DM), both off →
 * 'none'. A type missing from stored prefs resolves to its default.
 */
import {
  DEFAULT_CHANNEL_PREFS,
  type ChannelPrefs,
} from '../drizzle/schema/notification-preferences';
import {
  HIDDEN_ROW_TTL_MS,
  buildNotificationValues,
  resolveDelivery,
  resolveInputDelivery,
} from './notification-create.helpers';
import type { NotificationPreferencesDto } from './notification.types';

function prefsWith(
  overrides: Partial<ChannelPrefs>,
): NotificationPreferencesDto {
  return {
    userId: 1,
    channelPrefs: { ...DEFAULT_CHANNEL_PREFS, ...overrides },
  };
}

const sw = (inApp: boolean, discord: boolean) => ({
  inApp,
  push: false,
  discord,
});

describe('resolveDelivery', () => {
  it("bell on → 'both' (Discord switch checked later in dispatch)", () => {
    expect(
      resolveDelivery('new_event', prefsWith({ new_event: sw(true, false) })),
    ).toBe('both');
    expect(
      resolveDelivery('new_event', prefsWith({ new_event: sw(true, true) })),
    ).toBe('both');
  });

  it("bell off + Discord on → 'dm-only'", () => {
    expect(
      resolveDelivery('new_event', prefsWith({ new_event: sw(false, true) })),
    ).toBe('dm-only');
  });

  it("bell off + Discord off → 'none'", () => {
    expect(
      resolveDelivery('new_event', prefsWith({ new_event: sw(false, false) })),
    ).toBe('none');
  });

  it('a type missing from stored prefs resolves to its default', () => {
    const stored = { userId: 1, channelPrefs: {} as ChannelPrefs };
    expect(resolveDelivery('new_event', stored)).toBe('both');
    expect(resolveDelivery('valheim_claim_suggestion', stored)).toBe('dm-only');
    expect(resolveDelivery('new_event', undefined)).toBe('both');
  });

  it("a type whose default Discord is off goes 'none' once the bell is off", () => {
    const prefs = prefsWith({
      level_up: { ...DEFAULT_CHANNEL_PREFS.level_up, inApp: false },
    });
    expect(resolveDelivery('level_up', prefs)).toBe('none');
    expect(resolveDelivery('level_up', prefsWith({}))).toBe('both');
  });
});

describe('buildNotificationValues', () => {
  const now = new Date('2026-11-23T00:00:00.000Z');
  const input = {
    userId: 7,
    type: 'new_event' as const,
    title: 't',
    message: 'm',
  };

  it('a hidden row with no caller expiry expires 30 days out', () => {
    const values = buildNotificationValues(input, 'dm-only', now);
    expect(values.inAppHidden).toBe(true);
    expect(values.expiresAt).toEqual(
      new Date(now.getTime() + HIDDEN_ROW_TTL_MS),
    );
    expect(HIDDEN_ROW_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("a hidden row keeps the caller's own expiry", () => {
    const expiresAt = new Date('2026-11-24T00:00:00.000Z');
    const values = buildNotificationValues(
      { ...input, expiresAt },
      'dm-only',
      now,
    );
    expect(values.expiresAt).toEqual(expiresAt);
  });

  it('a visible row is not hidden and gets no fallback expiry', () => {
    const values = buildNotificationValues(input, 'both', now);
    expect(values.inAppHidden).toBe(false);
    expect(values.expiresAt).toBeNull();
    expect(values.payload).toBeNull();
  });
});

describe('resolveInputDelivery — skipDiscord callers', () => {
  const off = prefsWith({ new_event: sw(false, true) });
  const base = {
    userId: 1,
    type: 'new_event' as const,
    title: 't',
    message: 'm',
  };

  it("skipDiscord with no DM of its own: bell off → 'none'", () => {
    expect(resolveInputDelivery({ ...base, skipDiscord: true }, off)).toBe(
      'none',
    );
  });

  it("skipDiscord + callerSendsDm: bell off → 'dm-only'", () => {
    expect(
      resolveInputDelivery(
        { ...base, skipDiscord: true, callerSendsDm: true },
        off,
      ),
    ).toBe('dm-only');
  });

  it("no skipDiscord: bell off + Discord on → 'dm-only'", () => {
    expect(resolveInputDelivery(base, off)).toBe('dm-only');
  });

  it("skipDiscord with the bell on stays 'both'", () => {
    const on = prefsWith({ new_event: sw(true, true) });
    expect(resolveInputDelivery({ ...base, skipDiscord: true }, on)).toBe(
      'both',
    );
  });
});
