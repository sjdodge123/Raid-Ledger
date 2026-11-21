/**
 * ROK-2292 — per-row side effects skip a forum post's starter row
 * (`channel_id = message_id`): event delete removes it from the DB only
 * (never the Discord message — that would delete the whole post), and the
 * recruitment-bump paths never touch it.
 */
import type { Logger } from '@nestjs/common';
import { EMBED_STATES } from '../discord-bot.constants';
import {
  deleteEmbedRecord,
  type EventListenerDeps,
} from '../listeners/event.listener.handlers';
import {
  deleteRecordBump,
  reconcileBumpMessage,
  type BumpSyncDeps,
} from '../processors/embed-sync-bump.helpers';
import type { EmbedEventData } from './discord-embed.factory';

type Row = Parameters<typeof deleteEmbedRecord>[1];

function row(channelId: string, messageId: string): Row {
  const now = new Date();
  return {
    id: 'row-1',
    eventId: 42,
    guildId: 'guild-1',
    channelId,
    messageId,
    embedState: EMBED_STATES.POSTED,
    bumpMessageId: 'bump-1',
    bumpChannelId: 'bump-channel',
    createdAt: now,
    updatedAt: now,
  };
}

function makeDeps() {
  const where = jest.fn().mockResolvedValue(undefined);
  const set = jest.fn().mockReturnValue({ where });
  const db = {
    delete: jest.fn().mockReturnValue({ where }),
    update: jest.fn().mockReturnValue({ set }),
  };
  const clientService = {
    deleteMessage: jest.fn().mockResolvedValue(undefined),
    getClient: jest.fn().mockReturnValue(null),
  };
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { db, clientService, logger };
}

const asListenerDeps = (d: ReturnType<typeof makeDeps>) =>
  ({
    ...d,
    logger: d.logger as unknown as Logger,
  }) as unknown as EventListenerDeps;
const asBumpDeps = (d: ReturnType<typeof makeDeps>) =>
  d as unknown as BumpSyncDeps;

describe('deleteEmbedRecord (ROK-2292)', () => {
  it('deletes a forum starter row from the DB without deleting its Discord message', async () => {
    const d = makeDeps();
    await deleteEmbedRecord(asListenerDeps(d), row('thread-9', 'thread-9'), 42);
    expect(d.clientService.deleteMessage).not.toHaveBeenCalled();
    expect(d.db.delete).toHaveBeenCalledTimes(1);
  });

  it('still deletes an announcement row’s Discord message', async () => {
    const d = makeDeps();
    await deleteEmbedRecord(asListenerDeps(d), row('chan-1', 'msg-1'), 42);
    expect(d.clientService.deleteMessage).toHaveBeenCalledWith(
      'chan-1',
      'msg-1',
    );
    expect(d.db.delete).toHaveBeenCalledTimes(1);
  });
});

describe('bump paths skip forum starter rows (ROK-2292)', () => {
  const eventData = { id: 42 } as unknown as EmbedEventData;

  it('deleteRecordBump leaves a starter row alone', async () => {
    const d = makeDeps();
    await deleteRecordBump(asBumpDeps(d), row('thread-9', 'thread-9'), 42);
    expect(d.clientService.deleteMessage).not.toHaveBeenCalled();
  });

  it('reconcileBumpMessage leaves a starter row alone', async () => {
    const d = makeDeps();
    const record = row('thread-9', 'thread-9');
    await reconcileBumpMessage(asBumpDeps(d), {
      record,
      newState: EMBED_STATES.FULL,
      eventData,
      context: {},
    });
    expect(d.clientService.deleteMessage).not.toHaveBeenCalled();
  });

  it('deleteRecordBump still deletes an announcement row’s bump', async () => {
    const d = makeDeps();
    await deleteRecordBump(asBumpDeps(d), row('chan-1', 'msg-1'), 42);
    expect(d.clientService.deleteMessage).toHaveBeenCalledWith(
      'bump-channel',
      'bump-1',
    );
  });
});
