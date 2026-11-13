/**
 * Planned ephemeral voice channel (operator ruling 2026-11-13): the pure
 * decision, the settings loader and the surface conveniences.
 */
import {
  hasVoiceOverride,
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
    voiceOverride: false,
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
    ).resolves.toEqual({
      globalEnabled: true,
      forced: true,
      bufferMinutes: 15,
    });
  });
});

describe('resolvePlannedVoiceForEvent', () => {
  const event = {
    eventOverride: true,
    liveChannelId: null,
    voiceOverride: false,
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
      false,
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
      false,
      NOW,
    );
    expect(planned).toBeNull();
  });
});

/**
 * Codex r1: `resolveVoiceChannelHonoringOverride` returns a voice override
 * BEFORE the temporary channel, so a planned line for such an event would
 * advertise a room nobody gets sent to.
 */
describe('a voice-channel override is never planned', () => {
  it('returns null when the event has a voice override', () => {
    const planned = resolvePlannedEphemeralVoice(
      input({ voiceOverride: true }),
    );
    expect(planned).toBeNull();
  });

  it('skips the settings reads for a voice override', async () => {
    const settings = settingsMock();
    const event = {
      ...input({ voiceOverride: true }),
    };
    await expect(
      resolvePlannedVoiceForEvent(settings, event, NOW),
    ).resolves.toBeNull();
    expect(settings.getEphemeralVoiceEnabled).not.toHaveBeenCalled();
  });

  it('plannedVoiceForEmbed returns null when the override is voice', async () => {
    const planned = await plannedVoiceForEmbed(
      settingsMock(),
      { startTime: START.toISOString(), title: 'Stocks 5 man' },
      { channelId: null, enabled: true, cancelled: false, rescheduling: false },
      true,
      NOW,
    );
    expect(planned).toBeNull();
  });
});

describe('hasVoiceOverride', () => {
  const resolver = (isVoice: boolean) => ({
    overrideIsVoiceChannel: jest.fn().mockReturnValue(isVoice),
  });

  it('asks the resolver for a set override and returns its verdict', () => {
    const voice = resolver(true);
    expect(hasVoiceOverride(voice, 'vc-override')).toBe(true);
    expect(voice.overrideIsVoiceChannel).toHaveBeenCalledWith('vc-override');
    expect(hasVoiceOverride(resolver(false), 'text-override')).toBe(false);
  });

  it('is false without an override (no resolver call)', () => {
    const voice = resolver(true);
    expect(hasVoiceOverride(voice, null)).toBe(false);
    expect(hasVoiceOverride(voice, undefined)).toBe(false);
    expect(voice.overrideIsVoiceChannel).not.toHaveBeenCalled();
  });
});
