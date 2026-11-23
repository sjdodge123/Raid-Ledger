/**
 * ROK-2292 D4/D5/D7 — the event embed edit seam: announcement rows keep the
 * bot edit, forum starter rows go to the forum's port with no content, and a
 * starter the bot can no longer edit is untracked.
 */
import { Test } from '@nestjs/testing';
import {
  ActionRowBuilder,
  ButtonBuilder,
  DiscordAPIError,
  EmbedBuilder,
} from 'discord.js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { DiscordBotClientService } from '../discord-bot-client.service';
import {
  EventEmbedMessageEditor,
  FORUM_STARTER_EDIT_PORT,
} from './event-embed-message.editor';

function discordError(code: number): DiscordAPIError {
  const err = Object.create(DiscordAPIError.prototype) as DiscordAPIError;
  Object.defineProperty(err, 'code', { value: code, configurable: true });
  Object.defineProperty(err, 'message', { value: `code ${code}` });
  return err;
}

const ANNOUNCEMENT = { id: 'row-a', channelId: 'chan-1', messageId: 'msg-1' };
const STARTER = { id: 'row-s', channelId: 'thread-9', messageId: 'thread-9' };

async function setup() {
  const editEmbed = jest.fn().mockResolvedValue(undefined);
  const editStarter = jest.fn().mockResolvedValue('edited');
  const where = jest.fn().mockResolvedValue(undefined);
  const db = { delete: jest.fn().mockReturnValue({ where }) };
  const moduleRef = await Test.createTestingModule({
    providers: [
      EventEmbedMessageEditor,
      { provide: DrizzleAsyncProvider, useValue: db },
      { provide: DiscordBotClientService, useValue: { editEmbed } },
      { provide: FORUM_STARTER_EDIT_PORT, useValue: { editStarter } },
    ],
  }).compile();
  const editor = moduleRef.get(EventEmbedMessageEditor);
  return { editor, editEmbed, editStarter, db, where };
}

function card() {
  const embed = new EmbedBuilder().setTitle('Raid');
  const row = new ActionRowBuilder<ButtonBuilder>();
  return { embed, row, content: '📅 Raid | Sat | 3/10' };
}

describe('EventEmbedMessageEditor — announcement rows', () => {
  it('edits with the bot exactly as before (no content by default)', async () => {
    const { editor, editEmbed, editStarter } = await setup();
    const built = card();
    await expect(editor.edit(ANNOUNCEMENT, built)).resolves.toBe('edited');
    expect(editEmbed).toHaveBeenCalledWith('chan-1', 'msg-1', built.embed, [
      built.row,
    ]);
    expect(editStarter).not.toHaveBeenCalled();
  });

  it('sends the push line only when asked (embed sync)', async () => {
    const { editor, editEmbed } = await setup();
    const built = card();
    await editor.edit(ANNOUNCEMENT, built, { withContent: true });
    expect(editEmbed).toHaveBeenCalledWith(
      'chan-1',
      'msg-1',
      built.embed,
      [built.row],
      built.content,
    );
  });

  it('rethrows a bot failure and keeps the row (callers classify it)', async () => {
    const { editor, editEmbed, db } = await setup();
    const failure = discordError(50005);
    editEmbed.mockRejectedValue(failure);
    await expect(editor.edit(ANNOUNCEMENT, card())).rejects.toBe(failure);
    expect(db.delete).not.toHaveBeenCalled();
  });
});

describe('EventEmbedMessageEditor — forum starter rows', () => {
  it('goes to the port with embeds + buttons and no content', async () => {
    const { editor, editEmbed, editStarter } = await setup();
    const built = card();
    await expect(
      editor.edit(STARTER, built, { withContent: true }),
    ).resolves.toBe('edited');
    expect(editEmbed).not.toHaveBeenCalled();
    expect(editStarter).toHaveBeenCalledWith('thread-9', {
      embeds: [built.embed],
      components: [built.row],
    });
    const sent: unknown = editStarter.mock.calls[0]?.[1];
    expect(JSON.stringify(sent)).not.toContain(built.content);
  });

  // 10008 / 50001 / 50013: permanent embed-edit codes outside the starter
  // set (review MINOR) — dropped too, so the sync stops retrying them.
  it.each([50005, 50083, 10003, 10008, 50001, 50013])(
    'Discord %i → gone and the row is deleted',
    async (code) => {
      const { editor, editStarter, db, where } = await setup();
      editStarter.mockRejectedValue(discordError(code));
      await expect(editor.edit(STARTER, card())).resolves.toBe('gone');
      expect(db.delete).toHaveBeenCalledTimes(1);
      expect(where).toHaveBeenCalledTimes(1);
    },
  );

  it('a permanent code on an ANNOUNCEMENT still rethrows (unchanged)', async () => {
    const { editor, editEmbed, db } = await setup();
    const failure = discordError(50001);
    editEmbed.mockRejectedValue(failure);
    await expect(editor.edit(ANNOUNCEMENT, card())).rejects.toBe(failure);
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('a port "gone" (post deleted) also deletes the row', async () => {
    const { editor, editStarter, db } = await setup();
    editStarter.mockResolvedValue('gone');
    await expect(editor.edit(STARTER, card())).resolves.toBe('gone');
    expect(db.delete).toHaveBeenCalledTimes(1);
  });

  it('any other failure rethrows and keeps the row (retry)', async () => {
    const { editor, editStarter, db } = await setup();
    const transient = discordError(500);
    editStarter.mockRejectedValue(transient);
    await expect(editor.edit(STARTER, card())).rejects.toBe(transient);
    expect(db.delete).not.toHaveBeenCalled();
  });
});
