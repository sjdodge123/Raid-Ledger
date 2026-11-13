/**
 * Planned ephemeral voice channel (operator ruling 2026-11-13): the pure
 * decision, the settings loader and the surface conveniences.
 */
import {
  loadPlannedVoiceSettings,
  plannedVoiceForEmbed,
  resolvePlannedEphemeralVoice,
  resolvePlannedVoiceForEvent,
  type PlannedEphemeralVoiceInput,
} from './planned-ephemeral-voice.helpers';

const START = new Date('2026-11-20T20:30:00.000Z');
const NOW = new Date('2026-11-20T18:00:00.000Z');

function input(
  over: Partial<PlannedEphemeralVoiceInput> = {},
): PlannedEphemeralVoiceInput {
  return {
    globalEnabled: true,
    forced: false,
    bufferMinutes: 30,
    eventOverride: true,
    liveChannelId: null,
    cancelled: false,
    rescheduling: false,
    startTime: START,
    title: 'Stocks 5 man',
    gameName: null,
    now: NOW,
    ...over,
  };
}

function settingsMock(enabled = true, forced = false, buffer = 30) {
  return {
    getEphemeralVoiceEnabled: jest.fn().mockResolvedValue(enabled),
    getEphemeralVoiceForced: jest.fn().mockResolvedValue(forced),
    getEphemeralVoiceCreateBufferMinutes: jest.fn().mockResolvedValue(buffer),
  };
}

describe('resolvePlannedEphemeralVoice', () => {
  it('plans the channel name and opens at start − buffer', () => {
    expect(resolvePlannedEphemeralVoice(input())).toEqual({
      name: '⏰ Stocks 5 man',
      opensAt: '2026-11-20T20:00:00.000Z',
    });
  });

  it('honours a non-default buffer', () => {
    const planned = resolvePlannedEphemeralVoice(input({ bufferMinutes: 45 }));
    expect(planned?.opensAt).toBe('2026-11-20T19:45:00.000Z');
  });

  it('appends the game name the way the scheduler names the channel', () => {
    const planned = resolvePlannedEphemeralVoice(input({ gameName: 'WoW' }));
    expect(planned?.name).toBe('⏰ Stocks 5 man — WoW');
  });

  it('returns null when the global toggle is off, even if forced', () => {
    const off = input({ globalEnabled: false, forced: true });
    expect(resolvePlannedEphemeralVoice(off)).toBeNull();
  });

  it('plans for every event when forced, whatever the override', () => {
    for (const eventOverride of [null, false, true]) {
      const forced = input({ forced: true, eventOverride });
      expect(resolvePlannedEphemeralVoice(forced)).not.toBeNull();
    }
  });

  it.each([
    [null, false],
    [false, false],
    [true, true],
  ])('per-event override %s ⇒ planned %s', (eventOverride, planned) => {
    const result = resolvePlannedEphemeralVoice(input({ eventOverride }));
    expect(result !== null).toBe(planned);
  });

  it('returns null once the live channel exists', () => {
    const live = input({ liveChannelId: 'vc-1' });
    expect(resolvePlannedEphemeralVoice(live)).toBeNull();
  });

  it('returns null for a cancelled event', () => {
    expect(resolvePlannedEphemeralVoice(input({ cancelled: true }))).toBeNull();
  });

  it('returns null while a reschedule poll is open', () => {
    const voting = input({ rescheduling: true });
    expect(resolvePlannedEphemeralVoice(voting)).toBeNull();
  });

  it('returns null once the event has started (now == start and later)', () => {
    expect(resolvePlannedEphemeralVoice(input({ now: START }))).toBeNull();
    const later = new Date(START.getTime() + 60_000);
    expect(resolvePlannedEphemeralVoice(input({ now: later }))).toBeNull();
  });

  it('returns null for an unparseable start time', () => {
    const bad = input({ startTime: new Date('nope') });
    expect(resolvePlannedEphemeralVoice(bad)).toBeNull();
  });
});

describe('loadPlannedVoiceSettings', () => {
  it('reads the three ephemeral settings', async () => {
    await expect(
      loadPlannedVoiceSettings(settingsMock(true, true, 15)),
    ).resolves.toEqual({ globalEnabled: true, forced: true, bufferMinutes: 15 });
  });
});

describe('resolvePlannedVoiceForEvent', () => {
  const event = {
    eventOverride: true,
    liveChannelId: null,
    cancelled: false,
    rescheduling: false,
    startTime: START,
    title: 'Stocks 5 man',
    gameName: null,
  };

  it('loads the settings and resolves', async () => {
    const planned = await resolvePlannedVoiceForEvent(
      settingsMock(true, false, 30),
      event,
      NOW,
    );
    expect(planned).toEqual({
      name: '⏰ Stocks 5 man',
      opensAt: '2026-11-20T20:00:00.000Z',
    });
  });

  it('skips the settings reads when the live channel exists', async () => {
    const settings = settingsMock();
    const live = { ...event, liveChannelId: 'vc-1' };
    await expect(
      resolvePlannedVoiceForEvent(settings, live, NOW),
    ).resolves.toBeNull();
    expect(settings.getEphemeralVoiceEnabled).not.toHaveBeenCalled();
  });
});

describe('plannedVoiceForEmbed', () => {
  it('maps the embed data and the row state onto the decision', async () => {
    const planned = await plannedVoiceForEmbed(
      settingsMock(true, false, 30),
      {
        startTime: START.toISOString(),
        title: 'Stocks 5 man',
        game: { name: 'WoW' },
      },
      { channelId: null, enabled: true, cancelled: false, rescheduling: false },
      NOW,
    );
    expect(planned).toEqual({
      name: '⏰ Stocks 5 man — WoW',
      opensAt: '2026-11-20T20:00:00.000Z',
    });
  });

  it('returns null when the row says rescheduling', async () => {
    const planned = await plannedVoiceForEmbed(
      settingsMock(),
      { startTime: START.toISOString(), title: 'Stocks 5 man' },
      { channelId: null, enabled: true, cancelled: false, rescheduling: true },
      NOW,
    );
    expect(planned).toBeNull();
  });
});
