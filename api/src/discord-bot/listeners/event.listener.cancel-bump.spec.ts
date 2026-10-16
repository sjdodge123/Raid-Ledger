/**
 * ROK-1812 — a cancel takes down the "Spots still available" bump.
 *
 * `PATCH /events/:id/cancel` reaches Discord through
 * `EventListener.handleEventCancelled` → `cancelEmbedRecord`. The embed sync
 * skips cancelled events, so this is the only place the bump can be deleted;
 * before the fix every real cancel left the card (and its Sign-Up button) up.
 */
import { DiscordAPIError, EmbedBuilder } from 'discord.js';
import {
  cancelEmbedRecord,
  type EventListenerDeps,
} from './event.listener.handlers';
import type { EmbedEventData } from '../services/discord-embed.factory';

type MessageRecord = Parameters<typeof cancelEmbedRecord>[1];

function makeDiscordApiError(code: number, message: string): DiscordAPIError {
  const err = Object.create(DiscordAPIError.prototype) as DiscordAPIError;
  Object.defineProperty(err, 'code', { value: code, configurable: true });
  Object.defineProperty(err, 'message', { value: message, configurable: true });
  return err;
}

function makeDeps() {
  const set = jest.fn();
  set.mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) });
  const editEmbed = jest.fn().mockResolvedValue(undefined);
  const deleteMessage = jest.fn().mockResolvedValue(undefined);
  const deps = {
    db: { update: jest.fn().mockReturnValue({ set }) },
    clientService: { editEmbed, deleteMessage },
    embedFactory: {
      buildEventCancelled: jest
        .fn()
        .mockReturnValue({ embed: new EmbedBuilder(), content: undefined }),
    },
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
  } as unknown as EventListenerDeps;
  return { deps, set, editEmbed, deleteMessage };
}

const record = {
  id: 'record-uuid',
  eventId: 42,
  guildId: 'guild-123',
  channelId: 'channel-789',
  messageId: 'msg-456',
  embedState: 'filling',
  bumpMessageId: 'bump-msg-001',
  bumpChannelId: 'channel-bump',
} as MessageRecord;

const event = { id: 42, title: 'Elder prep' } as EmbedEventData;

const bumpIdsCleared = expect.objectContaining({
  bumpMessageId: null,
  bumpChannelId: null,
});

describe('cancelEmbedRecord — recruitment bump (ROK-1812)', () => {
  it('deletes the bump from its own channel and clears its ids', async () => {
    const { deps, set, editEmbed, deleteMessage } = makeDeps();
    await cancelEmbedRecord(deps, record, event, {}, 42);
    expect(editEmbed).toHaveBeenCalledTimes(1);
    expect(deleteMessage).toHaveBeenCalledWith('channel-bump', 'bump-msg-001');
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ embedState: 'cancelled' }),
    );
    expect(set).toHaveBeenCalledWith(bumpIdsCleared);
  });

  it('clears the bump ids when Discord says the bump is already gone (10008)', async () => {
    const { deps, set, deleteMessage } = makeDeps();
    deleteMessage.mockRejectedValue(
      makeDiscordApiError(10008, 'Unknown Message'),
    );
    await expect(
      cancelEmbedRecord(deps, record, event, {}, 42),
    ).resolves.toBeUndefined();
    expect(set).toHaveBeenCalledWith(bumpIdsCleared);
  });

  it('falls back to the embed channel for legacy rows without bumpChannelId', async () => {
    const { deps, deleteMessage } = makeDeps();
    await cancelEmbedRecord(
      deps,
      { ...record, bumpChannelId: null },
      event,
      {},
      42,
    );
    expect(deleteMessage).toHaveBeenCalledWith('channel-789', 'bump-msg-001');
  });

  it('leaves Discord alone when the record never had a bump', async () => {
    const { deps, deleteMessage } = makeDeps();
    await cancelEmbedRecord(
      deps,
      { ...record, bumpMessageId: null },
      event,
      {},
      42,
    );
    expect(deleteMessage).not.toHaveBeenCalled();
  });
});
