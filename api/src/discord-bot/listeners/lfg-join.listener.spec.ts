/**
 * ROK-1471 D6 / AC4 — the `+1` button on an LFG board post.
 *
 * The listener's whole contract is that it is a THIN mouth on top of
 * `LfgService.createIntent`: identity comes from the interaction, eligibility is
 * re-checked here because `NotDeactivatedGuard` only covers the HTTP routes, and
 * the public post is never touched — it repaints through the event consumer.
 */
import { LFG_BUTTON_IDS } from '../discord-bot.constants';
import {
  LFG_BLOCKED_REPLY,
  LFG_UNLINKED_REPLY,
} from '../commands/lfg.command.helpers';
import { LFG_JOIN_TERMINAL_REPLY, LfgJoinListener } from './lfg-join.listener';

type Row = Record<string, unknown>;

/** Queued-result drizzle stand-in: the caller lookup, then the board row. */
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
const OPEN_ROW: Row[] = [{ id: 'row-1', state: 'open', threadId: 'thread-1' }];

function makeButton(customId: string, discordId = 'discord-1') {
  const deferReply = jest.fn().mockResolvedValue(undefined);
  const editReply = jest.fn().mockResolvedValue(undefined);
  const messageEdit = jest.fn().mockResolvedValue(undefined);
  return {
    interaction: {
      customId,
      user: { id: discordId },
      guildId: 'guild-1',
      channelId: 'thread-1',
      message: { id: 'msg-1', edit: messageEdit },
      deferReply,
      editReply,
    } as never,
    deferReply,
    editReply,
    messageEdit,
  };
}

function makeService(
  created = true,
  activeCount = 3,
): Record<string, jest.Mock> {
  return {
    createIntent: jest.fn().mockResolvedValue({
      created,
      body: {
        group: {
          gameId: 42,
          gameName: 'Deep Rock Galactic',
          gameSlug: 'deep-rock-galactic',
          activeCount,
        },
      },
    }),
  };
}

function build(
  batches: Row[][],
  lfgService: Record<string, jest.Mock>,
  client: unknown = null,
): { listener: LfgJoinListener; clientService: Record<string, jest.Mock> } {
  const clientService = {
    getClient: jest.fn().mockReturnValue(client),
    editEmbed: jest.fn(),
    sendEmbed: jest.fn(),
  };
  const settings = {
    getClientUrl: jest.fn().mockResolvedValue('https://raid.example'),
  };
  const listener = new LfgJoinListener(
    fakeDb(batches),
    clientService as never,
    lfgService as never,
    settings as never,
  );
  return { listener, clientService };
}

describe('LfgJoinListener (ROK-1471 D6 / AC4)', () => {
  it('writes through LfgService.createIntent for the user who CLICKED, and edits no Discord message itself (T11)', async () => {
    const service = makeService();
    const { listener, clientService } = build([LINKED, OPEN_ROW], service);
    const { interaction, deferReply, editReply, messageEdit } = makeButton(
      `${LFG_BUTTON_IDS.JOIN}:42`,
    );

    await listener.handleButtonInteraction(interaction);

    expect(service.createIntent).toHaveBeenCalledTimes(1);
    expect(service.createIntent).toHaveBeenCalledWith(7, 42);
    expect(deferReply).toHaveBeenCalledWith({ flags: 64 });
    expect(editReply.mock.calls[0][0]).toMatchObject({
      content: expect.stringContaining("That's 3 now"),
    });
    // The post repaints through GROUP_CHANGED, never from this listener.
    expect(clientService.editEmbed).not.toHaveBeenCalled();
    expect(clientService.sendEmbed).not.toHaveBeenCalled();
    expect(messageEdit).not.toHaveBeenCalled();
  });

  it('links the group page in the joined reply', async () => {
    const { listener } = build([LINKED, OPEN_ROW], makeService());
    const { interaction, editReply } = makeButton(`${LFG_BUTTON_IDS.JOIN}:42`);

    await listener.handleButtonInteraction(interaction);

    expect(
      (editReply.mock.calls[0][0] as { content: string }).content,
    ).toContain('https://raid.example/lfg/deep-rock-galactic');
  });

  it('refuses a DEACTIVATED account and writes nothing — the HTTP guard never sees a gateway click (T12/E9)', async () => {
    const service = makeService();
    const { listener } = build(
      [[{ id: 7, deactivatedAt: new Date(), bannedAt: null }], OPEN_ROW],
      service,
    );
    const { interaction, editReply } = makeButton(`${LFG_BUTTON_IDS.JOIN}:42`);

    await listener.handleButtonInteraction(interaction);

    expect(service.createIntent).not.toHaveBeenCalled();
    expect(editReply.mock.calls[0][0]).toMatchObject({
      content: LFG_BLOCKED_REPLY,
    });
  });

  it('refuses a BANNED account and writes nothing (E9)', async () => {
    const service = makeService();
    const { listener } = build(
      [[{ id: 7, deactivatedAt: null, bannedAt: new Date() }], OPEN_ROW],
      service,
    );
    const { interaction, editReply } = makeButton(`${LFG_BUTTON_IDS.JOIN}:42`);

    await listener.handleButtonInteraction(interaction);

    expect(service.createIntent).not.toHaveBeenCalled();
    expect(editReply.mock.calls[0][0]).toMatchObject({
      content: LFG_BLOCKED_REPLY,
    });
  });

  it('tells an UNLINKED account to link, and writes nothing (E8)', async () => {
    const service = makeService();
    const { listener } = build([[], OPEN_ROW], service);
    const { interaction, editReply } = makeButton(`${LFG_BUTTON_IDS.JOIN}:42`);

    await listener.handleButtonInteraction(interaction);

    expect(service.createIntent).not.toHaveBeenCalled();
    expect(editReply.mock.calls[0][0]).toMatchObject({
      content: LFG_UNLINKED_REPLY,
    });
  });

  it('says "already in" on a repeat press — one idempotent call, no second row (E10)', async () => {
    const service = makeService(false, 4);
    const { listener } = build([LINKED, OPEN_ROW], service);
    const { interaction, editReply } = makeButton(`${LFG_BUTTON_IDS.JOIN}:42`);

    await listener.handleButtonInteraction(interaction);

    expect(service.createIntent).toHaveBeenCalledTimes(1);
    expect(editReply.mock.calls[0][0]).toMatchObject({
      content: "You're already in — 4 looking",
    });
  });

  it('refuses a press on a TERMINAL post from a stale client, and writes nothing (E11)', async () => {
    const service = makeService();
    const { listener } = build(
      [LINKED, [{ id: 'row-1', state: 'converted', threadId: 'thread-1' }]],
      service,
    );
    const { interaction, editReply } = makeButton(`${LFG_BUTTON_IDS.JOIN}:42`);

    await listener.handleButtonInteraction(interaction);

    expect(service.createIntent).not.toHaveBeenCalled();
    expect(editReply.mock.calls[0][0]).toMatchObject({
      content: LFG_JOIN_TERMINAL_REPLY,
    });
  });

  it('still joins when the click carries no tracked row at all — E11 refuses terminal, not unknown', async () => {
    const service = makeService();
    const { listener } = build([LINKED, []], service);
    const { interaction } = makeButton(`${LFG_BUTTON_IDS.JOIN}:42`);

    await listener.handleButtonInteraction(interaction);

    expect(service.createIntent).toHaveBeenCalledWith(7, 42);
  });

  it('matches its own prefix and nobody else’s', () => {
    const { listener } = build([], makeService());

    expect(listener.matches(`${LFG_BUTTON_IDS.JOIN}:42`)).toBe(true);
    expect(listener.matches(`${LFG_BUTTON_IDS.WITHDRAW}:42`)).toBe(false);
    expect(listener.matches(`${LFG_BUTTON_IDS.JOIN}:abc`)).toBe(false);
    expect(listener.matches('event_roachout:42')).toBe(false);
  });

  it('ignores a withdraw button entirely — 1454 still owns that prefix', async () => {
    const service = makeService();
    const { listener } = build([], service);
    const { interaction, deferReply } = makeButton(
      `${LFG_BUTTON_IDS.WITHDRAW}:42`,
    );

    await listener.handleButtonInteraction(interaction);

    expect(deferReply).not.toHaveBeenCalled();
    expect(service.createIntent).not.toHaveBeenCalled();
  });

  it('attaches on CONNECTED and detaches on DISCONNECTED', () => {
    const client = { on: jest.fn(), removeListener: jest.fn() };
    const { listener } = build([], makeService(), client);

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
