/**
 * Missed creation window (Codex finding, 2026-11-13): an SE still External at
 * the planned temporary channel when its event starts would advertise a room
 * that is never created. The start pass re-places it in the event's voice
 * channel before activating it, and leaves it External when none resolves.
 */
import {
  GuildScheduledEventEntityType,
  GuildScheduledEventStatus,
} from 'discord.js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import { runStartPass, tryStartEvent } from './scheduled-event.start';
import {
  findStartCandidates,
  resolveVoiceForCreate,
} from './scheduled-event.db-helpers';

jest.mock('./scheduled-event.db-helpers', () => ({
  findStartCandidates: jest.fn(),
  clearScheduledEventId: jest.fn(),
  resolveVoiceForCreate: jest.fn(),
}));

type Guild = Parameters<typeof tryStartEvent>[0];

function makeGuild(entityType: GuildScheduledEventEntityType) {
  const se = {
    status: GuildScheduledEventStatus.Scheduled,
    entityType,
    channelId:
      entityType === GuildScheduledEventEntityType.Voice ? 'vc-old' : null,
  };
  const edit = jest.fn().mockResolvedValue(se);
  const fetch = jest.fn().mockResolvedValue(se);
  const guild = { scheduledEvents: { fetch, edit } } as unknown as Guild;
  return { guild, edit };
}

const ACTIVE = { status: GuildScheduledEventStatus.Active };
const VOICE_IN = (channel: string) => ({
  entityType: GuildScheduledEventEntityType.Voice,
  channel,
});

describe('tryStartEvent — External SE at start', () => {
  it('re-places an External SE in the resolved voice channel, then activates it', async () => {
    const { guild, edit } = makeGuild(GuildScheduledEventEntityType.External);
    const resolveVoiceChannel = jest.fn().mockResolvedValue('vc-default');
    const out = await tryStartEvent(guild, 7, 'se-1', { resolveVoiceChannel });
    expect(resolveVoiceChannel).toHaveBeenCalledWith(7);
    expect(edit.mock.calls).toEqual([
      ['se-1', VOICE_IN('vc-default')],
      ['se-1', ACTIVE],
    ]);
    expect(out).toEqual({ cleared: false });
  });

  it('leaves the SE External when no voice channel resolves', async () => {
    const { guild, edit } = makeGuild(GuildScheduledEventEntityType.External);
    const resolveVoiceChannel = jest.fn().mockResolvedValue(null);
    await tryStartEvent(guild, 7, 'se-1', { resolveVoiceChannel });
    expect(edit.mock.calls).toEqual([['se-1', ACTIVE]]);
  });

  it('never re-places a Voice SE', async () => {
    const { guild, edit } = makeGuild(GuildScheduledEventEntityType.Voice);
    const resolveVoiceChannel = jest.fn().mockResolvedValue('vc-default');
    await tryStartEvent(guild, 7, 'se-1', { resolveVoiceChannel });
    expect(resolveVoiceChannel).not.toHaveBeenCalled();
    expect(edit.mock.calls).toEqual([['se-1', ACTIVE]]);
  });
});

/** Select chain resolving one events row (gameId + override). */
function makeDb(): PostgresJsDatabase<typeof schema> {
  const row = { gameId: 3, notificationChannelOverride: null };
  const chain: Record<string, unknown> = {};
  for (const k of ['select', 'from', 'where']) chain[k] = jest.fn(() => chain);
  chain.limit = jest.fn().mockResolvedValue([row]);
  return { select: jest.fn(() => chain) } as unknown as PostgresJsDatabase<
    typeof schema
  >;
}

describe('runStartPass — wires the start-time re-place', () => {
  it('re-places an External SE through the event voice resolution', async () => {
    jest
      .mocked(findStartCandidates)
      .mockResolvedValue([{ id: 7, discordScheduledEventId: 'se-1' }]);
    jest.mocked(resolveVoiceForCreate).mockResolvedValue('vc-default');
    const { guild, edit } = makeGuild(GuildScheduledEventEntityType.External);
    const channelResolver = { resolveVoiceChannelHonoringOverride: jest.fn() };
    const logger = { warn: jest.fn(), error: jest.fn() };
    const db = makeDb();
    await runStartPass(guild, {
      db,
      logger,
      warned: new Set(),
      channelResolver,
    });
    expect(resolveVoiceForCreate).toHaveBeenCalledWith(
      db,
      7,
      3,
      null,
      channelResolver,
    );
    expect(edit.mock.calls).toEqual([
      ['se-1', VOICE_IN('vc-default')],
      ['se-1', ACTIVE],
    ]);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
