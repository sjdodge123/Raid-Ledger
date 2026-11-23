/**
 * ROK-2292 review MAJOR — archived ≠ gone. A forum post auto-archives when
 * idle, so a 50083 on a post our records say is NOT locked unarchives it and
 * retries the edit once (the row is kept); only a locked post's 50083 reaches
 * the editor, which drops the row. Codex P2: a post `findStarterPost` rules
 * out (hub unlinked/rebound) is `'gone'` without any Discord call.
 */
import { DiscordAPIError } from 'discord.js';
import { ForumStarterEditor } from './forum-starter-edit.port';
import { findStarterPost, type StarterPost } from './forum-starter-edit.target';
import type { HubForumDiscordOutboundGateway } from './hub-forum-discord-outbound.discord';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

jest.mock('./forum-starter-edit.target', () => ({
  findStarterPost: jest.fn(),
}));
const findPost = jest.mocked(findStarterPost);

function discordError(code: number): DiscordAPIError {
  const err = Object.create(DiscordAPIError.prototype) as DiscordAPIError;
  Object.defineProperty(err, 'code', { value: code, configurable: true });
  Object.defineProperty(err, 'message', { value: `code ${code}` });
  return err;
}

const CARD = { embeds: [], components: [] };
const BOT_POST: StarterPost = { author: { kind: 'bot' }, locked: false };

function setup(post: StarterPost | 'gone') {
  findPost.mockReset().mockResolvedValue(post);
  const gateway = {
    editStarterCard: jest.fn().mockResolvedValue('ok'),
    unarchiveThread: jest.fn().mockResolvedValue(true),
  };
  const port = new ForumStarterEditor(
    {} as ForumDiscordDb,
    gateway as unknown as HubForumDiscordOutboundGateway,
  );
  return { port, gateway };
}

describe('ROK-2292 ForumStarterEditor', () => {
  it('edits as the author our records name', async () => {
    const { port, gateway } = setup(BOT_POST);
    await expect(port.editStarter('t1', CARD)).resolves.toBe('edited');
    expect(gateway.editStarterCard).toHaveBeenCalledWith('t1', CARD, {
      kind: 'bot',
    });
  });

  it('archived but NOT locked → unarchive, retry once, edited', async () => {
    const { port, gateway } = setup(BOT_POST);
    gateway.editStarterCard
      .mockRejectedValueOnce(discordError(50083))
      .mockResolvedValueOnce('ok');
    await expect(port.editStarter('t1', CARD)).resolves.toBe('edited');
    expect(gateway.unarchiveThread).toHaveBeenCalledWith('t1');
    expect(gateway.editStarterCard).toHaveBeenCalledTimes(2);
  });

  it('archived AND locked → 50083 rethrown (the editor drops the row), no unarchive', async () => {
    const { port, gateway } = setup({ ...BOT_POST, locked: true });
    const archived = discordError(50083);
    gateway.editStarterCard.mockRejectedValueOnce(archived);
    await expect(port.editStarter('t1', CARD)).rejects.toBe(archived);
    expect(gateway.unarchiveThread).not.toHaveBeenCalled();
  });

  it('archived, records say open, but Discord already shows it locked → 50083 rethrown, no retry', async () => {
    const { port, gateway } = setup(BOT_POST);
    const archived = discordError(50083);
    gateway.editStarterCard.mockRejectedValueOnce(archived);
    gateway.unarchiveThread.mockResolvedValueOnce(false);
    await expect(port.editStarter('t1', CARD)).rejects.toBe(archived);
    expect(gateway.unarchiveThread).toHaveBeenCalledWith('t1');
    expect(gateway.editStarterCard).toHaveBeenCalledTimes(1);
  });

  it('a retry that fails again surfaces that failure (no second unarchive)', async () => {
    const { port, gateway } = setup(BOT_POST);
    const again = discordError(50083);
    gateway.editStarterCard
      .mockRejectedValueOnce(discordError(50083))
      .mockRejectedValueOnce(again);
    await expect(port.editStarter('t1', CARD)).rejects.toBe(again);
    expect(gateway.unarchiveThread).toHaveBeenCalledTimes(1);
  });

  it('any other failure is rethrown without an unarchive', async () => {
    const { port, gateway } = setup(BOT_POST);
    const other = discordError(50005);
    gateway.editStarterCard.mockRejectedValueOnce(other);
    await expect(port.editStarter('t1', CARD)).rejects.toBe(other);
    expect(gateway.unarchiveThread).not.toHaveBeenCalled();
  });

  it('Codex P2: a post our records rule out (hub unbound/rebound) is gone, no Discord call', async () => {
    const { port, gateway } = setup('gone');
    await expect(port.editStarter('t1', CARD)).resolves.toBe('gone');
    expect(gateway.editStarterCard).not.toHaveBeenCalled();
  });

  it('a gateway gone (deleted post / webhook) is gone', async () => {
    const { port, gateway } = setup(BOT_POST);
    gateway.editStarterCard.mockResolvedValueOnce('gone');
    await expect(port.editStarter('t1', CARD)).resolves.toBe('gone');
  });
});
