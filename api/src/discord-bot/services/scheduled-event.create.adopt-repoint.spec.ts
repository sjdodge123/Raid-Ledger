/**
 * Planned-voice adopt race (follow-up to PR #2134).
 *
 * When the temporary voice channel is created seconds after its planned
 * (External) Scheduled Event — before the SE create bound its id onto the
 * event — the repoint falls into the create path, which ADOPTS the live
 * External SE by name+start. The adopt must also switch it External → Voice
 * in the now-real channel; otherwise the SE keeps the placeholder location.
 */
import { Logger } from '@nestjs/common';
import { GuildScheduledEventEntityType } from 'discord.js';
import {
  createScheduledEventIdempotent,
  type CreatePreamble,
} from './scheduled-event.create';
import * as dbHelpers from './scheduled-event.db-helpers';
import * as revalidate from './scheduled-event.revalidate';
import * as discordOps from './scheduled-event.discord-ops';
import type { ScheduledEventData } from './scheduled-event.helpers';

jest.mock('./scheduled-event.db-helpers', () => ({
  ...jest.requireActual('./scheduled-event.db-helpers'),
  resolveVoiceForCreate: jest.fn(),
}));
jest.mock('./scheduled-event.revalidate', () => ({
  ...jest.requireActual('./scheduled-event.revalidate'),
  applyCreateEntryGuard: jest.fn(),
  saveScheduledEventId: jest.fn(),
  getEventLiveState: jest.fn(),
  clearScheduledEventIdBySeId: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./scheduled-event.discord-ops', () => ({
  ...jest.requireActual('./scheduled-event.discord-ops'),
  tryCreateNewEvent: jest.fn(),
}));

const resolveVoiceForCreate = jest.mocked(dbHelpers.resolveVoiceForCreate);
const saveScheduledEventId = jest.mocked(revalidate.saveScheduledEventId);
const getEventLiveState = jest.mocked(revalidate.getEventLiveState);
const applyCreateEntryGuard = jest.mocked(revalidate.applyCreateEntryGuard);
const tryCreateNewEvent = jest.mocked(discordOps.tryCreateNewEvent);

const START = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const START_MS = Date.parse(START);
const END = new Date(START_MS + 3 * 60 * 60 * 1000).toISOString();
const EVENT_ID = 91;
const eventData: ScheduledEventData = {
  title: 'Planned Voice Raid',
  startTime: START,
  endTime: END,
  signupCount: 1,
};
const LIVE = {
  reschedulingPollId: null,
  cancelledAt: null,
  startIso: START,
  endIso: END,
};

type Guild = Parameters<typeof createScheduledEventIdempotent>[0];
const db = {} as Parameters<typeof createScheduledEventIdempotent>[1];
const logger = new Logger('test');

function preamble(): CreatePreamble {
  return {
    gameId: 1,
    channelResolver: {
      resolveVoiceChannelHonoringOverride: jest.fn().mockResolvedValue('v'),
      overrideIsVoiceChannel: jest.fn().mockReturnValue(true),
    },
    describe: jest.fn().mockResolvedValue('desc'),
  };
}

interface LiveSE {
  entityType: GuildScheduledEventEntityType;
  channelId: string | null;
}

/** A guild holding one RL-fingerprinted SE for EVENT_ID with the given entity. */
function guildWith(se: LiveSE): { guild: Guild; edit: jest.Mock } {
  const edit = jest.fn().mockResolvedValue({ id: 'se-1' });
  const entry = {
    id: 'se-1',
    name: eventData.title,
    scheduledStartTimestamp: START_MS,
    description: `x\n\nView event: https://rl.example/events/${EVENT_ID}`,
    ...se,
  };
  const scheduledEvents = {
    fetch: jest.fn().mockResolvedValue(new Map([['se-1', entry]])),
    edit,
  };
  return { guild: { scheduledEvents } as unknown as Guild, edit };
}

async function runCreate(guild: Guild): Promise<void> {
  await createScheduledEventIdempotent(
    guild,
    db,
    logger,
    EVENT_ID,
    eventData,
    preamble(),
  );
}

beforeEach(() => {
  resolveVoiceForCreate.mockReset().mockResolvedValue('temp-voice-1');
  saveScheduledEventId.mockReset().mockResolvedValue({ bound: true });
  getEventLiveState.mockReset().mockResolvedValue(LIVE);
  applyCreateEntryGuard
    .mockReset()
    .mockImplementation((_db, _logger, _id, ed) => Promise.resolve(ed));
  tryCreateNewEvent.mockReset();
});

describe('adopt path repoints a planned (External) SE to the real channel', () => {
  it('edits the adopted External SE to Voice in the resolved channel', async () => {
    const { guild, edit } = guildWith({
      entityType: GuildScheduledEventEntityType.External,
      channelId: null,
    });

    await runCreate(guild);

    expect(tryCreateNewEvent).not.toHaveBeenCalled();
    expect(saveScheduledEventId).toHaveBeenCalledWith(db, EVENT_ID, 'se-1');
    expect(edit).toHaveBeenCalledWith(
      'se-1',
      expect.objectContaining({
        entityType: GuildScheduledEventEntityType.Voice,
        channel: 'temp-voice-1',
      }),
    );
  });

  it('leaves an adopted SE already Voice in that channel untouched', async () => {
    const { guild, edit } = guildWith({
      entityType: GuildScheduledEventEntityType.Voice,
      channelId: 'temp-voice-1',
    });

    await runCreate(guild);

    expect(saveScheduledEventId).toHaveBeenCalledWith(db, EVENT_ID, 'se-1');
    expect(edit).not.toHaveBeenCalled();
  });

  it('does not edit when the bind lost the row (SE compensated instead)', async () => {
    saveScheduledEventId.mockResolvedValue({ bound: false });
    const { guild, edit } = guildWith({
      entityType: GuildScheduledEventEntityType.External,
      channelId: null,
    });
    (guild.scheduledEvents as unknown as { delete: jest.Mock }).delete = jest
      .fn()
      .mockResolvedValue(undefined);

    await runCreate(guild);

    expect(edit).not.toHaveBeenCalled();
  });
});
