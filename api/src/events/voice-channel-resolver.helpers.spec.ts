/**
 * GET /events/:id/voice-channel + the detail bundle's `voiceChannel`: a
 * planned temporary channel (operator ruling 2026-11-13) is returned by name
 * with its open time and no channel id; otherwise the resolver path is
 * unchanged.
 */
import type { EventResponseDto } from '@raid-ledger/contract';
import {
  resolveVoiceChannelForEvent,
  type VoiceChannelResolverDeps,
} from './voice-channel-resolver.helpers';

const START = new Date(Date.now() + 5 * 3_600_000);

function makeEvent(over: Partial<EventResponseDto> = {}): EventResponseDto {
  const base = {
    id: 42,
    title: 'Stocks 5 man',
    startTime: START.toISOString(),
    endTime: new Date(START.getTime() + 3_600_000).toISOString(),
    game: null,
    recurrenceGroupId: null,
    ephemeralVoiceEnabled: true,
    ephemeralVoiceChannelId: null,
    notificationChannelOverride: null,
    cancelledAt: null,
    reschedulingPollId: null,
  };
  return { ...base, ...over } as EventResponseDto;
}

function makeDeps(globalEnabled = true) {
  const resolve = jest.fn().mockResolvedValue(null);
  const deps = {
    channelResolver: { resolveVoiceChannelHonoringOverride: resolve },
    bot: { getGuildId: jest.fn(), getClient: jest.fn() },
    settings: {
      getEphemeralVoiceEnabled: jest.fn().mockResolvedValue(globalEnabled),
      getEphemeralVoiceForced: jest.fn().mockResolvedValue(false),
      getEphemeralVoiceCreateBufferMinutes: jest.fn().mockResolvedValue(30),
    },
  };
  return { deps: deps as unknown as VoiceChannelResolverDeps, resolve };
}

describe('resolveVoiceChannelForEvent — planned temporary channel', () => {
  it('returns the planned name and open time, with no channel id', async () => {
    const { deps, resolve } = makeDeps();
    const result = await resolveVoiceChannelForEvent(deps, makeEvent(), true);
    expect(result).toEqual({
      channelId: null,
      channelName: '⏰ Stocks 5 man',
      guildId: null,
      plannedOpensAt: new Date(START.getTime() - 30 * 60_000).toISOString(),
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('falls back to the resolver when ephemeral voice is off', async () => {
    const { deps, resolve } = makeDeps(false);
    const result = await resolveVoiceChannelForEvent(deps, makeEvent(), true);
    expect(result).toEqual({
      channelId: null,
      channelName: null,
      guildId: null,
    });
    expect(resolve).toHaveBeenCalled();
  });

  it('falls back to the resolver once the live channel exists', async () => {
    const { deps, resolve } = makeDeps();
    const live = makeEvent({ ephemeralVoiceChannelId: 'vc-live' });
    await resolveVoiceChannelForEvent(deps, live, true);
    expect(resolve).toHaveBeenCalledWith(null, null, 'vc-live', null);
  });

  it('is not planned while a reschedule poll is open', async () => {
    const { deps, resolve } = makeDeps();
    const voting = makeEvent({ reschedulingPollId: 3 });
    const result = await resolveVoiceChannelForEvent(deps, voting, true);
    expect(result.plannedOpensAt).toBeUndefined();
    expect(resolve).toHaveBeenCalled();
  });

  it('is not planned for a cancelled event', async () => {
    const { deps } = makeDeps();
    const cancelled = makeEvent({ cancelledAt: new Date().toISOString() });
    const result = await resolveVoiceChannelForEvent(deps, cancelled, true);
    expect(result.plannedOpensAt).toBeUndefined();
  });
});
