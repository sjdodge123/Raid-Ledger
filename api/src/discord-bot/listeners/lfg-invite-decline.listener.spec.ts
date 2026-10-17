/**
 * ROK-1455 D12 / AC8 — the `Not interested` button on a player-invite DM.
 *
 * The listener is a THIN mouth on `LfgInviteService.decline`: identity comes
 * from the interaction (never the custom id), the reply is ephemeral, and a
 * repeat press is the idempotent "nothing to decline", not an error.
 */
import { LFG_BUTTON_IDS } from '../discord-bot.constants';
import { LFG_UNLINKED_REPLY } from '../commands/lfg.command.helpers';
import {
  LFG_INVITE_DECLINED_REPLY,
  LFG_INVITE_NOTHING_TO_DECLINE_REPLY,
  LfgInviteDeclineListener,
  parseInviteDeclineCustomId,
} from './lfg-invite-decline.listener';

type Row = Record<string, unknown>;

/** Queued-result drizzle stand-in: the caller lookup. */
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

const LINKED: Row[] = [{ id: 7, deactivatedAt: null, bannedAt: null }];

function makeButton(customId: string, discordId = 'discord-1') {
  const deferReply = jest.fn().mockResolvedValue(undefined);
  const editReply = jest.fn().mockResolvedValue(undefined);
  return {
    interaction: {
      customId,
      user: { id: discordId },
      deferReply,
      editReply,
    } as never,
    deferReply,
    editReply,
  };
}

function makeService(declined = true): Record<string, jest.Mock> {
  return { decline: jest.fn().mockResolvedValue(declined) };
}

function build(
  batches: Row[][],
  service: Record<string, jest.Mock>,
  client: unknown = null,
): LfgInviteDeclineListener {
  const clientService = { getClient: jest.fn().mockReturnValue(client) };
  return new LfgInviteDeclineListener(
    fakeDb(batches),
    clientService as never,
    service as never,
  );
}

const DECLINE_42 = `${LFG_BUTTON_IDS.INVITE_DECLINE}:42`;

describe('LfgInviteDeclineListener (ROK-1455 D12 / AC8)', () => {
  it('declines for the user who CLICKED — identity from the interaction, game from the id', async () => {
    const service = makeService();
    const listener = build([LINKED], service);
    const { interaction, deferReply, editReply } = makeButton(DECLINE_42);

    await listener.handleButtonInteraction(interaction);

    expect(service.decline).toHaveBeenCalledTimes(1);
    expect(service.decline).toHaveBeenCalledWith(7, 42);
    expect(deferReply).toHaveBeenCalledWith({ flags: 64 });
    expect(editReply.mock.calls[0][0]).toMatchObject({
      content: LFG_INVITE_DECLINED_REPLY,
    });
  });

  it('ignores a forged id that smuggles a user segment — the tail must be digits only', async () => {
    const service = makeService();
    const listener = build([LINKED], service);
    const { interaction, deferReply } = makeButton(`${DECLINE_42}:999`);

    await listener.handleButtonInteraction(interaction);

    expect(service.decline).not.toHaveBeenCalled();
    expect(deferReply).not.toHaveBeenCalled();
  });

  it('tells an UNLINKED account to link, and writes nothing', async () => {
    const service = makeService();
    const listener = build([[]], service);
    const { interaction, editReply } = makeButton(DECLINE_42);

    await listener.handleButtonInteraction(interaction);

    expect(service.decline).not.toHaveBeenCalled();
    expect(editReply.mock.calls[0][0]).toMatchObject({
      content: LFG_UNLINKED_REPLY,
    });
  });

  it('says "nothing to decline" on a repeat press — idempotent, not an error', async () => {
    const service = makeService(false);
    const listener = build([LINKED], service);
    const { interaction, editReply } = makeButton(DECLINE_42);

    await listener.handleButtonInteraction(interaction);

    expect(service.decline).toHaveBeenCalledWith(7, 42);
    expect(editReply.mock.calls[0][0]).toMatchObject({
      content: LFG_INVITE_NOTHING_TO_DECLINE_REPLY,
    });
  });

  it('answers "try again" when the service throws, and never throws into the gateway', async () => {
    const service = { decline: jest.fn().mockRejectedValue(new Error('db')) };
    const listener = build([LINKED], service);
    const { interaction, editReply } = makeButton(DECLINE_42);

    await expect(
      listener.handleButtonInteraction(interaction),
    ).resolves.toBeUndefined();
    expect(editReply.mock.calls[0][0]).toMatchObject({
      content: 'Something went wrong. Please try again.',
    });
  });

  it('matches its own prefix and nobody else’s', () => {
    const listener = build([], makeService());

    expect(listener.matches(DECLINE_42)).toBe(true);
    expect(listener.matches(`${LFG_BUTTON_IDS.JOIN}:42`)).toBe(false);
    expect(listener.matches(`${LFG_BUTTON_IDS.WITHDRAW}:42`)).toBe(false);
    expect(listener.matches(`${LFG_BUTTON_IDS.INVITE_DECLINE}:abc`)).toBe(
      false,
    );
    expect(parseInviteDeclineCustomId(DECLINE_42)).toBe(42);
  });

  it('ignores a join button entirely — that prefix has its own listener', async () => {
    const service = makeService();
    const listener = build([], service);
    const { interaction, deferReply } = makeButton(`${LFG_BUTTON_IDS.JOIN}:42`);

    await listener.handleButtonInteraction(interaction);

    expect(deferReply).not.toHaveBeenCalled();
    expect(service.decline).not.toHaveBeenCalled();
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
