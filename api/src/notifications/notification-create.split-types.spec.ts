/**
 * ROK-2311 AC2: the split types are governed only by their own row. A
 * scheduling poll still delivers with Community Lineup off and stops with
 * Scheduling polls off (ROK-2290 bell/DM rules); an LFG offer (`skipDiscord`,
 * no DM path) stays in-app only whatever its Discord switch says; the
 * standalone voice-access notice ignores Slot Vacated.
 */
import {
  DEFAULT_CHANNEL_PREFS,
  type ChannelPrefs,
} from '../drizzle/schema/notification-preferences';
import {
  resolveDelivery,
  resolveInputDelivery,
  resolveStoredDelivery,
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

describe('scheduling_poll delivery (ROK-2311)', () => {
  it('Community Lineup fully off does not stop a scheduling poll', () => {
    const prefs = prefsWith({ community_lineup: sw(false, false) });
    expect(resolveDelivery('scheduling_poll', prefs)).toBe('both');
  });

  it('Scheduling polls fully off stops it even with Community Lineup on', () => {
    const prefs = prefsWith({
      community_lineup: sw(true, true),
      scheduling_poll: sw(false, false),
    });
    expect(resolveDelivery('scheduling_poll', prefs)).toBe('none');
  });

  it("Scheduling polls bell off + Discord on → 'dm-only'", () => {
    const prefs = prefsWith({ scheduling_poll: sw(false, true) });
    expect(resolveDelivery('scheduling_poll', prefs)).toBe('dm-only');
  });

  it('an older stored row without the key resolves to the default (on)', () => {
    const stored = { community_lineup: sw(false, false) };
    expect(resolveStoredDelivery('scheduling_poll', stored)).toBe('both');
  });
});

describe('lineup_lfg_offer delivery — in-app only (ROK-2311)', () => {
  const offer = {
    userId: 1,
    type: 'lineup_lfg_offer' as const,
    title: 't',
    message: 'm',
    skipDiscord: true,
  };

  it('Community Lineup off does not stop an LFG offer', () => {
    const prefs = prefsWith({ community_lineup: sw(false, false) });
    expect(resolveInputDelivery(offer, prefs)).toBe('both');
  });

  it("bell off + Discord on still goes 'none' — no DM path, no hidden row", () => {
    const prefs = prefsWith({ lineup_lfg_offer: sw(false, true) });
    expect(resolveInputDelivery(offer, prefs)).toBe('none');
  });
});

describe('voice_access_lost delivery (ROK-2311)', () => {
  it('Slot Vacated off does not stop the voice-access notice', () => {
    const prefs = prefsWith({ slot_vacated: sw(false, false) });
    expect(resolveDelivery('voice_access_lost', prefs)).toBe('both');
  });

  it('its own row off stops it', () => {
    const prefs = prefsWith({ voice_access_lost: sw(false, false) });
    expect(resolveDelivery('voice_access_lost', prefs)).toBe('none');
  });
});
