/**
 * The shared embed builder carries the embed voice decision (operator ruling
 * 2026-11-13, Codex finding): the interactive writers (signup buttons, unfurls,
 * share) rebuild the tracked embed through `buildEmbedEventData`, so without
 * the voice line there a Sign Up click wiped the planned temporary channel
 * (and the "Join Voice" link).
 */
import type { EventResponseDto } from '@raid-ledger/contract';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import {
  buildEmbedEventData,
  embedVoiceDepsFrom,
} from './event-response-embed.helpers';
import { getEphemeralVoiceState } from '../discord-bot/services/ephemeral-voice.db-helpers';
import { ChannelResolverService } from '../discord-bot/services/channel-resolver.service';
import type { EmbedVoiceDeps } from '../discord-bot/services/embed-voice.helpers';

jest.mock('../discord-bot/services/ephemeral-voice.db-helpers', () => ({
  getEphemeralVoiceState: jest.fn(),
}));
const mockedState = jest.mocked(getEphemeralVoiceState);

type EmbedDb = PostgresJsDatabase<typeof schema>;

/** Awaitable select chain resolving to no rows (role counts + signups). */
function makeDb(): EmbedDb {
  const chain: Record<string, unknown> = {};
  for (const k of ['select', 'from', 'where', 'leftJoin']) {
    chain[k] = jest.fn(() => chain);
  }
  chain.groupBy = jest.fn().mockResolvedValue([]);
  chain.then = (resolve: (v: unknown) => void) =>
    Promise.resolve([]).then(resolve);
  return { select: jest.fn(() => chain) } as unknown as EmbedDb;
}

function makeEvent(): EventResponseDto {
  return {
    id: 7,
    title: 'Raid Night',
    description: null,
    startTime: new Date(Date.now() + 3 * 3_600_000).toISOString(),
    endTime: new Date(Date.now() + 5 * 3_600_000).toISOString(),
    game: null,
    recurrenceGroupId: null,
    notificationChannelOverride: null,
  } as unknown as EventResponseDto;
}

function makeVoice(gateOpen: boolean): EmbedVoiceDeps {
  return {
    settings: {
      getEphemeralVoiceEnabled: jest.fn().mockResolvedValue(gateOpen),
      getEphemeralVoiceForced: jest.fn().mockResolvedValue(false),
      getEphemeralVoiceCreateBufferMinutes: jest.fn().mockResolvedValue(30),
    },
    channelResolver: {
      resolveVoiceChannelHonoringOverride: jest
        .fn()
        .mockResolvedValue('default-voice'),
      overrideIsVoiceChannel: jest.fn(() => false),
    },
  };
}

beforeEach(() => {
  mockedState.mockResolvedValue({
    channelId: null,
    enabled: true,
    cancelled: false,
    rescheduling: false,
  });
});

describe('buildEmbedEventData — embed voice decision', () => {
  it('carries the planned temporary channel, not the default room', async () => {
    const data = await buildEmbedEventData(
      makeDb(),
      makeEvent(),
      7,
      makeVoice(true),
    );
    expect(data.plannedVoiceChannel?.name).toContain('Raid Night');
    expect(data.voiceChannelId).toBeUndefined();
  });

  it('keeps the Join Voice link when no temporary channel is planned', async () => {
    const data = await buildEmbedEventData(
      makeDb(),
      makeEvent(),
      7,
      makeVoice(false),
    );
    expect(data.plannedVoiceChannel).toBeUndefined();
    expect(data.voiceChannelId).toBe('default-voice');
  });

  it('renders no voice line without voice deps', async () => {
    const data = await buildEmbedEventData(makeDb(), makeEvent(), 7);
    expect(data.plannedVoiceChannel).toBeUndefined();
    expect(data.voiceChannelId).toBeUndefined();
  });
});

describe('embedVoiceDepsFrom', () => {
  const settings = makeVoice(true).settings;
  if (!settings) throw new Error('settings fixture missing');

  it('looks the channel resolver up non-strictly', () => {
    const resolver = { id: 'resolver' };
    const get = jest.fn().mockReturnValue(resolver);
    const deps = embedVoiceDepsFrom({ get }, settings);
    expect(get).toHaveBeenCalledWith(ChannelResolverService, {
      strict: false,
    });
    expect(deps?.channelResolver).toBe(resolver);
    expect(deps?.settings).toBe(settings);
  });

  it('returns undefined when the resolver is not registered', () => {
    const get = jest.fn(() => {
      throw new Error('not found');
    });
    expect(embedVoiceDepsFrom({ get }, settings)).toBeUndefined();
  });
});
