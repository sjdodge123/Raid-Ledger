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
import {
  LFG_JOIN_TERMINAL_REPLY,
  LfgJoinListener,
  parseJoinPress,
} from './lfg-join.listener';

type Row = Record<string, unknown>;

/**
 * Queued-result drizzle stand-in: the caller lookup, then the board row (board
 * press) or the group-horizon row (DM press). `innerJoin` / `orderBy` are here
 * because `readGroupHorizon` joins `users` and takes the longest-running hand.
 */
function fakeDb(batches: Row[][]): never {
  let calls = 0;
  return {
    select: () => {
      const rows = batches[calls++] ?? [];
      const chain: Record<string, unknown> = {};
      Object.assign(chain, {
        from: () => chain,
        innerJoin: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: () => Promise.resolve(rows),
      });
      return chain;
    },
  } as never;
}

const LINKED: Row[] = [{ id: 7, deactivatedAt: null, bannedAt: null }];
const OPEN_ROW: Row[] = [{ id: 'row-1', state: 'open', threadId: 'thread-1' }];

/** A press that arrived in a DM: no guild, so no board row to look up. */
function makeDmButton(customId: string, discordId = 'discord-1') {
  const made = makeButton(customId, discordId);
  (made.interaction as unknown as Record<string, unknown>).guildId = null;
  (made.interaction as unknown as Record<string, unknown>).channelId = 'dm-1';
  return made;
}

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
    // ROK-1455 REGRESSION GUARD: the board passes NO urgency argument, so
    // `createIntent` keeps defaulting to WEEK_REQUEST. The DM's Join button
    // added in ROK-1455 must never re-cut this.
    expect(service.createIntent.mock.calls[0]).toHaveLength(2);
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

describe('LfgJoinListener DM branch (ROK-1455 walk feedback 3)', () => {
  const DM_42 = `${LFG_BUTTON_IDS.INVITE_JOIN}:42`;
  const LAPSES_AT = new Date('2026-09-08T20:45:00.000Z');
  /** One live `now` hand on the group — whoever it belongs to. */
  const NOW_GROUP: Row[] = [{ expiresAt: LAPSES_AT, ttlMinutes: 60 }];

  it('parses both join buttons and keeps their namespaces disjoint', () => {
    expect(parseJoinPress(`${LFG_BUTTON_IDS.JOIN}:42`)).toEqual({
      gameId: 42,
      source: 'board',
    });
    expect(parseJoinPress(DM_42)).toEqual({ gameId: 42, source: 'dm' });
    expect(parseJoinPress(`${LFG_BUTTON_IDS.INVITE_DECLINE}:42`)).toBeNull();
    expect(parseJoinPress(`${LFG_BUTTON_IDS.INVITE_JOIN}:abc`)).toBeNull();
    expect(
      LFG_BUTTON_IDS.INVITE_JOIN.startsWith(`${LFG_BUTTON_IDS.JOIN}:`),
    ).toBe(false);
  });

  it('matches the DM Join button as well as the board +1', () => {
    const { listener } = build([], makeService());

    expect(listener.matches(DM_42)).toBe(true);
    expect(listener.matches(`${LFG_BUTTON_IDS.JOIN}:42`)).toBe(true);
    expect(listener.matches(`${LFG_BUTTON_IDS.INVITE_DECLINE}:42`)).toBe(false);
  });

  it('raises a NOW hand on the group’s own TTL bucket when the group has a live now hand', async () => {
    const service = makeService();
    const { listener } = build([LINKED, NOW_GROUP], service);
    const { interaction } = makeDmButton(DM_42);

    await listener.handleButtonInteraction(interaction);

    expect(service.createIntent).toHaveBeenCalledWith(7, 42, {
      urgency: 'now',
      ttlMinutes: 60,
    });
  });

  it('raises a WEEK hand once the group’s now hands have LAPSED — the horizon is read at press time, not baked into the id', async () => {
    const service = makeService();
    // Same DM, same custom id as the now-group case above; the group simply no
    // longer has a live `now` hand when the button is finally pressed.
    const { listener } = build([LINKED, []], service);
    const { interaction } = makeDmButton(DM_42);

    await listener.handleButtonInteraction(interaction);

    expect(service.createIntent).toHaveBeenCalledWith(7, 42, {
      urgency: 'week',
    });
  });

  it('still refuses an unlinked clicker and writes nothing', async () => {
    const service = makeService();
    const { listener } = build([[], []], service);
    const { interaction, editReply } = makeDmButton(DM_42);

    await listener.handleButtonInteraction(interaction);

    expect(service.createIntent).not.toHaveBeenCalled();
    expect(editReply).toHaveBeenCalledWith({ content: LFG_UNLINKED_REPLY });
  });
});
