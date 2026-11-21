/**
 * ROK-2292 review fixes on the listener handlers:
 * - a forum starter row never hides a missing announcement (Codex P2);
 * - a cancelled card carries no buttons on either row kind;
 * - an event DELETE leaves its forum post on a button-free "removed" card.
 */
import { ActionRowBuilder, ButtonBuilder, EmbedBuilder } from 'discord.js';
import { EMBED_COLORS } from '../discord-bot.constants';
import type { EmbedEventData } from '../services/discord-embed.factory';
import {
  cancelEmbedRecord,
  deleteEmbedRecord,
  lacksAnnouncement,
  type EventListenerDeps,
} from './event.listener.handlers';

type MessageRecord = Parameters<typeof cancelEmbedRecord>[1];

const announcement = {
  id: 'ann',
  eventId: 42,
  guildId: 'guild-1',
  channelId: 'channel-789',
  messageId: 'msg-456',
  embedState: 'posted',
  bumpMessageId: null,
  bumpChannelId: null,
} as MessageRecord;
const starter = {
  ...announcement,
  id: 'starter',
  channelId: 'thread-1',
  messageId: 'thread-1',
};

function makeDeps(edit = jest.fn().mockResolvedValue('edited')) {
  const where = jest.fn().mockResolvedValue(undefined);
  const set = jest.fn().mockReturnValue({ where });
  const deleteMessage = jest.fn().mockResolvedValue(undefined);
  const row = new ActionRowBuilder<ButtonBuilder>();
  const deps = {
    db: {
      update: jest.fn().mockReturnValue({ set }),
      delete: jest.fn().mockReturnValue({ where }),
    },
    clientService: { deleteMessage },
    messageEditor: { edit },
    embedFactory: {
      buildEventCancelled: jest
        .fn()
        .mockReturnValue({ embed: new EmbedBuilder(), row, content: 'x' }),
    },
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
  } as unknown as EventListenerDeps;
  return { deps, edit, deleteMessage, db: deps.db };
}

describe('lacksAnnouncement', () => {
  it('is true with no rows or only forum-starter rows', () => {
    expect(lacksAnnouncement([])).toBe(true);
    expect(lacksAnnouncement([starter])).toBe(true);
  });

  it('is false once an announcement row exists', () => {
    expect(lacksAnnouncement([starter, announcement])).toBe(false);
  });
});

describe('cancelEmbedRecord — no buttons on a cancelled card', () => {
  const event = { id: 42, title: 'Onyxia' } as EmbedEventData;

  it.each([
    ['announcement', announcement],
    ['forum starter', starter],
  ])('strips the factory row for a %s row', async (_kind, record) => {
    const { deps, edit } = makeDeps();
    await cancelEmbedRecord(deps, record, event, {}, 42);
    const card = edit.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(card).sort()).toEqual(['content', 'embed']);
  });
});

describe('deleteEmbedRecord — forum starter', () => {
  it('edits the starter to the button-free removed card, keeps the post, drops the row', async () => {
    const { deps, edit, deleteMessage, db } = makeDeps();
    await deleteEmbedRecord(deps, starter, 42);
    expect(deleteMessage).not.toHaveBeenCalled();
    expect(edit).toHaveBeenCalledTimes(1);
    const card = edit.mock.calls[0]?.[1] as { embed: EmbedBuilder };
    expect(Object.keys(card)).toEqual(['embed']);
    expect(card.embed.data.color).toBe(EMBED_COLORS.ERROR);
    expect(card.embed.data.title).toBe('Event removed');
    expect(db.delete).toHaveBeenCalledTimes(1);
  });

  it('still drops the row when the starter edit fails', async () => {
    const failing = jest.fn().mockRejectedValue(new Error('boom'));
    const { deps, db } = makeDeps(failing);
    await deleteEmbedRecord(deps, starter, 42);
    expect(db.delete).toHaveBeenCalledTimes(1);
  });

  it('deletes an announcement message without editing it', async () => {
    const { deps, edit, deleteMessage } = makeDeps();
    await deleteEmbedRecord(deps, announcement, 42);
    expect(deleteMessage).toHaveBeenCalledWith('channel-789', 'msg-456');
    expect(edit).not.toHaveBeenCalled();
  });
});
