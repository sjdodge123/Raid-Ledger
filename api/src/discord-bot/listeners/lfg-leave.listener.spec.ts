/**
 * ROK-1660 — the board post's `I'm out` button.
 *
 * The high-risk assertion: the handler answers PRIVATELY and never touches the
 * shared post — no `deferUpdate`, no `update`, and its only `editReply` follows
 * an ephemeral `deferReply` (so it edits that reply, not the post).
 */
import { NotFoundException } from '@nestjs/common';
import { MessageFlags } from 'discord.js';
import { LFG_BUTTON_IDS } from '../discord-bot.constants';
import {
  LFG_BLOCKED_REPLY,
  LFG_UNLINKED_REPLY,
} from '../commands/lfg.command.helpers';
import { LfgLeaveListener } from './lfg-leave.listener';

type Row = Record<string, unknown>;

/** Queued-result drizzle stand-in: user lookup first, then the game lookup. */
function fakeDb(batches: Row[][]): never {
  let calls = 0;
  return {
    select: () => {
      const rows = batches[calls++] ?? [];
      return {
        from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
      };
    },
  } as never;
}

function makeButton(customId: string, discordId = 'discord-1') {
  const order: string[] = [];
  const track = (name: string) =>
    jest.fn().mockImplementation(() => {
      order.push(name);
      return Promise.resolve(undefined);
    });
  const mocks = {
    deferReply: track('deferReply'),
    editReply: track('editReply'),
    deferUpdate: track('deferUpdate'),
    update: track('update'),
    followUp: track('followUp'),
  };
  const interaction = { customId, user: { id: discordId }, ...mocks } as never;
  return { interaction, order, ...mocks };
}

const LINKED = [{ id: 7, deactivatedAt: null, bannedAt: null }];
const GAME = [{ name: 'Deep Rock Galactic' }];

function makeService(
  withdraw: jest.Mock = jest.fn().mockResolvedValue(undefined),
  stillLooking = 0,
): Record<string, jest.Mock> {
  return {
    withdraw,
    countStillLooking: jest.fn().mockResolvedValue(stillLooking),
  };
}

function build(
  batches: Row[][],
  service: Record<string, jest.Mock>,
  client: unknown = null,
): LfgLeaveListener {
  const clientService = { getClient: jest.fn().mockReturnValue(client) };
  return new LfgLeaveListener(
    fakeDb(batches),
    clientService as never,
    service as never,
  );
}

function content(editReply: jest.Mock): unknown {
  return (editReply.mock.calls[0]?.[0] as { content?: unknown } | undefined)
    ?.content;
}

describe("LfgLeaveListener — the board's I'm out (ROK-1660)", () => {
  it('withdraws the PRESSER and says how many are still looking', async () => {
    const service = makeService(undefined, 2);
    const listener = build([LINKED, GAME], service);
    const { interaction, editReply } = makeButton('lfg:leave:42');

    await listener.handleButtonInteraction(interaction);

    expect(service.withdraw).toHaveBeenCalledWith(7, 42);
    expect(service.countStillLooking).toHaveBeenCalledWith(42);
    expect(content(editReply)).toBe(
      "You're out — **Deep Rock Galactic**. 2 still looking.",
    );
  });

  it('drops the count when the presser was the last hand', async () => {
    const listener = build([LINKED, GAME], makeService());
    const { interaction, editReply } = makeButton('lfg:leave:42');

    await listener.handleButtonInteraction(interaction);

    expect(content(editReply)).toBe("You're out — **Deep Rock Galactic**.");
  });

  it('answers privately and NEVER edits the shared board post', async () => {
    const listener = build([LINKED, GAME], makeService());
    const { interaction, order, deferReply, deferUpdate, update, followUp } =
      makeButton('lfg:leave:42');

    await listener.handleButtonInteraction(interaction);

    expect(deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(deferUpdate).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(followUp).not.toHaveBeenCalled();
    // The only edit is of the ephemeral reply opened first.
    expect(order).toEqual(['deferReply', 'editReply']);
  });

  it('tells a member with no hand they are not in the group', async () => {
    const service = makeService(
      jest.fn().mockRejectedValue(new NotFoundException('nope')),
    );
    const listener = build([LINKED, GAME], service);
    const { interaction, editReply } = makeButton('lfg:leave:42');

    await listener.handleButtonInteraction(interaction);

    expect(content(editReply)).toBe(
      "You're not in the **Deep Rock Galactic** group.",
    );
  });
});

describe('LfgLeaveListener — guards and wiring (ROK-1660)', () => {
  it('tells an unlinked account to link, and withdraws nothing', async () => {
    const service = makeService();
    const listener = build([[]], service);
    const { interaction, editReply } = makeButton('lfg:leave:42');

    await listener.handleButtonInteraction(interaction);

    expect(service.withdraw).not.toHaveBeenCalled();
    expect(content(editReply)).toBe(LFG_UNLINKED_REPLY);
  });

  it.each([
    ['deactivated', { deactivatedAt: new Date(), bannedAt: null }],
    ['banned', { deactivatedAt: null, bannedAt: new Date() }],
  ])('refuses a %s account and withdraws nothing', async (_label, flags) => {
    const service = makeService();
    const listener = build([[{ id: 7, ...flags }], GAME], service);
    const { interaction, editReply } = makeButton('lfg:leave:42');

    await listener.handleButtonInteraction(interaction);

    expect(service.withdraw).not.toHaveBeenCalled();
    expect(content(editReply)).toBe(LFG_BLOCKED_REPLY);
  });

  it('words an unexpected failure generically and never throws', async () => {
    const service = makeService(jest.fn().mockRejectedValue(new Error('db')));
    const listener = build([LINKED, GAME], service);
    const { interaction, editReply } = makeButton('lfg:leave:42');

    await expect(
      listener.handleButtonInteraction(interaction),
    ).resolves.toBeUndefined();
    expect(content(editReply)).toBe('Something went wrong. Please try again.');
  });

  it.each([
    `${LFG_BUTTON_IDS.WITHDRAW}:42`,
    `${LFG_BUTTON_IDS.JOIN}:42`,
    'event_roachout:42',
  ])('ignores %s entirely', async (customId) => {
    const service = makeService();
    const listener = build([], service);
    const { interaction, deferReply } = makeButton(customId);

    await listener.handleButtonInteraction(interaction);

    expect(deferReply).not.toHaveBeenCalled();
    expect(service.withdraw).not.toHaveBeenCalled();
  });

  it('attaches on CONNECTED and detaches on DISCONNECTED', () => {
    const client = { on: jest.fn(), removeListener: jest.fn() };
    const listener = build([], makeService(), client);

    listener.onBotConnected();
    expect(client.on).toHaveBeenCalledWith(
      'interactionCreate',
      expect.any(Function),
    );
    listener.onBotDisconnected();
    expect(client.removeListener).toHaveBeenCalledWith(
      'interactionCreate',
      expect.any(Function),
    );
  });
});
