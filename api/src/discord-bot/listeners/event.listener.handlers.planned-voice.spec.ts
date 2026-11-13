/**
 * Codex r1 (2026-11-13): the event-update re-render (`updateExistingEmbeds` →
 * `enrichEventData`) must make the SAME planned-temporary-channel decision as
 * embed-poster and embed-sync. It used to resolve the default voice channel,
 * so editing a title before the channel existed swapped the planned line for
 * a link to the wrong room.
 */
import type { EmbedEventData } from '../services/discord-embed.factory';
import {
  enrichEventData,
  type EventListenerDeps,
} from './event.listener.handlers';

const START = new Date(Date.now() + 5 * 3_600_000);

function ephemeralRow(over: Record<string, unknown> = {}) {
  return {
    ephemeralVoiceChannelId: null,
    ephemeralVoiceEnabled: true,
    cancelledAt: null,
    reschedulingPollId: null,
    ...over,
  };
}

function makeDeps(row: Record<string, unknown>, overrideIsVoice = true) {
  const chain: Record<string, jest.Mock> = {};
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockResolvedValue([row]);
  const resolve = jest.fn().mockResolvedValue('default-vc');
  const deps = {
    db: { select: jest.fn().mockReturnValue(chain) },
    embedPoster: {
      enrichWithLiveRoster: jest.fn((_id: number, e: EmbedEventData) =>
        Promise.resolve({ ...e }),
      ),
    },
    channelResolver: {
      resolveVoiceChannelHonoringOverride: resolve,
      overrideIsVoiceChannel: jest.fn().mockReturnValue(overrideIsVoice),
    },
    settings: {
      getEphemeralVoiceEnabled: jest.fn().mockResolvedValue(true),
      getEphemeralVoiceForced: jest.fn().mockResolvedValue(false),
      getEphemeralVoiceCreateBufferMinutes: jest.fn().mockResolvedValue(30),
    },
  };
  return { deps: deps as unknown as EventListenerDeps, resolve };
}

function payload(notificationChannelOverride: string | null = null) {
  const event = {
    id: 42,
    title: 'Stocks 5 man',
    startTime: START.toISOString(),
    endTime: new Date(START.getTime() + 3_600_000).toISOString(),
    signupCount: 0,
    maxAttendees: null,
    slotConfig: null,
  } as unknown as EmbedEventData;
  return { eventId: 42, event, gameId: 1, notificationChannelOverride };
}

describe('enrichEventData — planned temporary voice channel', () => {
  it('keeps the planned line on an edit, never the default channel link', async () => {
    const { deps, resolve } = makeDeps(ephemeralRow());
    const data = await enrichEventData(deps, payload());
    expect(data.plannedVoiceChannel).toEqual({
      name: '⏰ Stocks 5 man',
      opensAt: new Date(START.getTime() - 30 * 60_000).toISOString(),
    });
    expect(data.voiceChannelId).toBeUndefined();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('links the live temporary channel once it exists (ROK-1352)', async () => {
    const row = ephemeralRow({ ephemeralVoiceChannelId: 'eph-vc' });
    const { deps, resolve } = makeDeps(row);
    resolve.mockResolvedValue('eph-vc');
    const data = await enrichEventData(deps, payload());
    expect(data.plannedVoiceChannel).toBeUndefined();
    expect(resolve).toHaveBeenCalledWith(1, undefined, 'eph-vc', null);
    expect(data.voiceChannelId).toBe('eph-vc');
  });

  it('links a voice override instead of planning (it wins the live slot too)', async () => {
    const { deps, resolve } = makeDeps(ephemeralRow(), true);
    resolve.mockResolvedValue('vc-override');
    const data = await enrichEventData(deps, payload('vc-override'));
    expect(data.plannedVoiceChannel).toBeUndefined();
    expect(data.voiceChannelId).toBe('vc-override');
  });
});
