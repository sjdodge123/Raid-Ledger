import { NotFoundException } from '@nestjs/common';
import { LFG_BUTTON_IDS } from '../discord-bot.constants';
import {
  LFG_BLOCKED_REPLY,
  LFG_UNLINKED_REPLY,
} from '../commands/lfg.command.helpers';
import { LfgWithdrawListener } from './lfg-withdraw.listener';

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
  const deferUpdate = jest.fn().mockResolvedValue(undefined);
  const editReply = jest.fn().mockResolvedValue(undefined);
  const followUp = jest.fn().mockResolvedValue(undefined);
  return {
    interaction: {
      customId,
      user: { id: discordId },
      deferUpdate,
      editReply,
      followUp,
    } as never,
    deferUpdate,
    editReply,
    followUp,
  };
}

const settings = {
  getDiscordBotCommunityName: jest.fn().mockResolvedValue('Gamer Night'),
  getDiscordBotTimezone: jest.fn().mockResolvedValue('UTC'),
  getClientUrl: jest.fn().mockResolvedValue('https://raid.example'),
};

const GAME = [{ id: 42, name: 'Deep Rock Galactic' }];

function build(
  batches: Row[][],
  lfgService: Record<string, jest.Mock>,
  client: unknown = null,
): LfgWithdrawListener {
  const clientService = {
    getClient: jest.fn().mockReturnValue(client),
  };
  return new LfgWithdrawListener(
    fakeDb(batches),
    clientService as never,
    lfgService as never,
    settings as never,
  );
}

function makeService(
  withdraw: jest.Mock = jest.fn().mockResolvedValue(undefined),
): Record<string, jest.Mock> {
  return { withdraw, listGroups: jest.fn().mockResolvedValue([]) };
}

describe('LfgWithdrawListener (ROK-1454 D11 / AC7)', () => {
  it('withdraws the intent of the user who CLICKED, not an id from the button', async () => {
    const service = makeService();
    const listener = build(
      [[{ id: 7, deactivatedAt: null, bannedAt: null }], GAME],
      service,
    );
    const { interaction } = makeButton('lfg:withdraw:42', 'discord-1');

    await listener.handleButtonInteraction(interaction);

    expect(service.withdraw).toHaveBeenCalledTimes(1);
    expect(service.withdraw).toHaveBeenCalledWith(7, 42);
  });

  it('cannot be replayed against another member — a different clicker withdraws THEIR own row', async () => {
    const service = makeService();
    const listener = build(
      [[{ id: 9, deactivatedAt: null, bannedAt: null }], GAME],
      service,
    );
    // The SAME custom id another player's list rendered.
    const { interaction } = makeButton('lfg:withdraw:42', 'discord-2');

    await listener.handleButtonInteraction(interaction);

    expect(service.withdraw).toHaveBeenCalledWith(9, 42);
    expect(service.withdraw).not.toHaveBeenCalledWith(7, 42);
  });

  it('confirms the withdrawal by name and re-renders the caller’s list', async () => {
    const service = makeService();
    service.listGroups = jest.fn().mockResolvedValue([]);
    const listener = build(
      [[{ id: 7, deactivatedAt: null, bannedAt: null }], GAME],
      service,
    );
    const { interaction, deferUpdate, editReply, followUp } =
      makeButton('lfg:withdraw:42');

    await listener.handleButtonInteraction(interaction);

    expect(deferUpdate).toHaveBeenCalled();
    expect(service.listGroups).toHaveBeenCalledWith(7);
    const rendered = editReply.mock.calls[0][0] as {
      embeds: Array<{ toJSON: () => { author?: { name: string } } }>;
    };
    expect(rendered.embeds[0].toJSON().author?.name).toBe('📋 YOUR GROUPS · 0');
    expect(followUp.mock.calls[0][0]).toMatchObject({
      content: 'Withdrawn from **Deep Rock Galactic**.',
      flags: 64,
    });
  });

  it('renders "already withdrawn" when the service says there was nothing to clear', async () => {
    const service = makeService(
      jest.fn().mockRejectedValue(new NotFoundException('nope')),
    );
    const listener = build(
      [[{ id: 7, deactivatedAt: null, bannedAt: null }], GAME],
      service,
    );
    const { interaction, editReply, followUp } = makeButton('lfg:withdraw:42');

    await listener.handleButtonInteraction(interaction);

    expect(followUp.mock.calls[0][0]).toMatchObject({
      content: "You're not in **Deep Rock Galactic** — already withdrawn.",
    });
    expect(editReply).toHaveBeenCalled();
  });

  it('tells an unlinked account to link, and withdraws nothing', async () => {
    const service = makeService();
    const listener = build([[]], service);
    const { interaction, followUp } = makeButton('lfg:withdraw:42');

    await listener.handleButtonInteraction(interaction);

    expect(service.withdraw).not.toHaveBeenCalled();
    expect(followUp.mock.calls[0][0]).toMatchObject({
      content: LFG_UNLINKED_REPLY,
    });
  });

  it('refuses a deactivated account — the button enforces the guard the command does', async () => {
    const service = makeService();
    const listener = build(
      [[{ id: 7, deactivatedAt: new Date(), bannedAt: null }], GAME],
      service,
    );
    const { interaction, followUp } = makeButton('lfg:withdraw:42');

    await listener.handleButtonInteraction(interaction);

    expect(service.withdraw).not.toHaveBeenCalled();
    expect(followUp.mock.calls[0][0]).toMatchObject({
      content: LFG_BLOCKED_REPLY,
    });
  });

  it('IGNORES the reserved join prefix — ROK-1471 owns that button', async () => {
    const service = makeService();
    const listener = build([], service);
    const { interaction, deferUpdate } = makeButton(
      `${LFG_BUTTON_IDS.JOIN}:42`,
    );

    await listener.handleButtonInteraction(interaction);

    expect(deferUpdate).not.toHaveBeenCalled();
    expect(service.withdraw).not.toHaveBeenCalled();
  });

  it('ignores a foreign button entirely', async () => {
    const service = makeService();
    const listener = build([], service);
    const { interaction, deferUpdate } = makeButton('event_roachout:42');

    await listener.handleButtonInteraction(interaction);

    expect(deferUpdate).not.toHaveBeenCalled();
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
