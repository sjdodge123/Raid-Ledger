/**
 * ROK-1454 D10 — `/help` must list `/lfg`.
 *
 * The help listing is the bot's only discovery surface: a command that is
 * registered with Discord but missing from `COMMANDS` is invisible to every
 * player who has not read the spec. This pins the `/lfg` row (and one
 * pre-existing row as a control against a replace-instead-of-append edit)
 * rather than the whole listing, so a future command does not make the spec
 * fail for the wrong reason.
 */
import type { ChatInputCommandInteraction } from 'discord.js';
import { HelpCommand } from './help.command';

interface ReplyPayload {
  embeds: { data: { description?: string } }[];
}

describe('HelpCommand — command listing', () => {
  let command: HelpCommand;
  let reply: jest.Mock;

  beforeEach(() => {
    command = new HelpCommand();
    reply = jest.fn().mockResolvedValue(undefined);
  });

  /** The single line rendered for a command, or null when it is unlisted. */
  async function lineFor(name: string): Promise<string | null> {
    await command.handleInteraction({
      reply,
    } as unknown as ChatInputCommandInteraction);
    const payload = reply.mock.calls[0]?.[0] as ReplyPayload;
    const description = payload?.embeds?.[0]?.data?.description ?? '';
    const line = description
      .split('\n')
      .find((l) => l.startsWith(`**${name}**`));
    return line ?? null;
  }

  it('lists /lfg with a description of what it does', async () => {
    const line = await lineFor('/lfg');
    expect(line).not.toBeNull();
    expect(line).toMatch(/^\*\*\/lfg\*\* — \S.*$/u);
  });

  it('still lists /playing — the new row is appended, not substituted', async () => {
    expect(await lineFor('/playing')).not.toBeNull();
  });
});
