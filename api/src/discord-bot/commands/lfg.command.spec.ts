import type { LfgGroupSummaryDto } from '@raid-ledger/contract';
import { LfgCommand } from './lfg.command';
import {
  LFG_BLOCKED_REPLY,
  LFG_LIST_SENTINEL,
  LFG_UNLINKED_REPLY,
} from './lfg.command.helpers';

type Row = Record<string, unknown>;

/**
 * A drizzle stand-in that hands back queued result sets in call order.
 * Each `select()` consumes exactly one queued batch, which is what lets a test
 * distinguish "the user lookup ran" from "the game lookup ran".
 */
function fakeDb(batches: Row[][]): {
  db: never;
  selects: () => number;
} {
  let calls = 0;
  const db = {
    select: () => {
      const rows = batches[calls++] ?? [];
      const terminal = {
        limit: () => Promise.resolve(rows),
        then: (fn: (r: Row[]) => unknown) => Promise.resolve(rows).then(fn),
      };
      return { from: () => ({ where: () => terminal }) };
    },
  };
  return { db: db as never, selects: () => calls };
}

function summary(over: Partial<LfgGroupSummaryDto> = {}): LfgGroupSummaryDto {
  return {
    gameId: 42,
    gameName: 'Deep Rock Galactic',
    gameSlug: 'deep-rock-galactic',
    gameCoverUrl: null,
    activeCount: 2,
    state: 'lfm',
    viabilityThreshold: null,
    isViable: false,
    hasOwnIntent: true,
    soonestExpiresAt: null,
    ...over,
  };
}

function makeInteraction(game: string | null): {
  interaction: never;
  editReply: jest.Mock;
  deferReply: jest.Mock;
} {
  const editReply = jest.fn().mockResolvedValue(undefined);
  const deferReply = jest.fn().mockResolvedValue(undefined);
  const interaction = {
    user: { id: 'discord-1' },
    options: { getString: () => game },
    deferReply,
    editReply,
  };
  return { interaction: interaction as never, editReply, deferReply };
}

function makeLfgService(
  over: Partial<Record<string, jest.Mock>> = {},
): Record<string, jest.Mock> {
  return {
    createIntent: jest.fn().mockResolvedValue({
      created: true,
      body: { group: summary() },
    }),
    getGroupDetail: jest.fn().mockResolvedValue({
      ...summary(),
      members: [
        { userId: 7, username: 'ana', displayName: 'Ana' },
        { userId: 8, username: 'bo', displayName: null },
      ],
      ownIntent: null,
    }),
    listGroups: jest.fn().mockResolvedValue([]),
    ...over,
  };
}

const settings = {
  getDiscordBotCommunityName: jest.fn().mockResolvedValue('Gamer Night'),
  getDiscordBotTimezone: jest.fn().mockResolvedValue('UTC'),
  getClientUrl: jest.fn().mockResolvedValue('https://raid.example'),
};

const LINKED = [{ id: 7, deactivatedAt: null, bannedAt: null }];

function build(
  batches: Row[][],
  lfgService: Record<string, jest.Mock>,
): LfgCommand {
  const { db } = fakeDb(batches);
  return new LfgCommand(db, lfgService as never, settings as never);
}

describe('LfgCommand (ROK-1454 D10 / AC6)', () => {
  it('registers as /lfg with ONE optional autocompleted game option', () => {
    const definition = build([], makeLfgService()).getDefinition();
    expect(definition.name).toBe('lfg');
    expect(definition.options).toHaveLength(1);
    expect(definition.options?.[0]).toMatchObject({
      name: 'game',
      required: false,
      autocomplete: true,
    });
  });

  it('offers My groups as the FIRST autocomplete choice, always', async () => {
    const command = build([[{ id: 42, name: 'Deep Rock Galactic' }]], makeLfgService());
    const respond = jest.fn().mockResolvedValue(undefined);
    await command.handleAutocomplete({
      options: { getFocused: () => ({ name: 'game', value: 'de' }) },
      respond,
    } as never);
    const choices = respond.mock.calls[0][0] as Array<{ value: string }>;
    expect(choices[0].value).toBe(LFG_LIST_SENTINEL);
    expect(choices[1]).toEqual({ name: 'Deep Rock Galactic', value: '42' });
  });

  describe('an unlinked Discord account', () => {
    it('gets the shared link-your-account reply and creates NO intent', async () => {
      const lfgService = makeLfgService();
      const command = build([[]], lfgService);
      const { interaction, editReply } = makeInteraction('42');

      await command.handleInteraction(interaction);

      expect(editReply).toHaveBeenCalledWith(LFG_UNLINKED_REPLY);
      expect(lfgService.createIntent).not.toHaveBeenCalled();
      expect(lfgService.listGroups).not.toHaveBeenCalled();
    });
  });

  it('refuses a deactivated account itself — NotDeactivatedGuard does not cover this path', async () => {
    const lfgService = makeLfgService();
    const command = build(
      [[{ id: 7, deactivatedAt: new Date(), bannedAt: null }]],
      lfgService,
    );
    const { interaction, editReply } = makeInteraction('42');

    await command.handleInteraction(interaction);

    expect(editReply).toHaveBeenCalledWith(LFG_BLOCKED_REPLY);
    expect(lfgService.createIntent).not.toHaveBeenCalled();
  });

  it('refuses a banned account', async () => {
    const lfgService = makeLfgService();
    const command = build(
      [[{ id: 7, deactivatedAt: null, bannedAt: new Date() }]],
      lfgService,
    );
    const { interaction, editReply } = makeInteraction('42');

    await command.handleInteraction(interaction);

    expect(editReply).toHaveBeenCalledWith(LFG_BLOCKED_REPLY);
    expect(lfgService.createIntent).not.toHaveBeenCalled();
  });

  it('raises a hand through the SAME service method POST /lfg uses', async () => {
    const lfgService = makeLfgService();
    const command = build([LINKED, [{ id: 42, name: 'Deep Rock Galactic' }]], lfgService);
    const { interaction, editReply, deferReply } = makeInteraction('42');

    await command.handleInteraction(interaction);

    expect(deferReply).toHaveBeenCalledWith({ flags: 64 });
    expect(lfgService.createIntent).toHaveBeenCalledTimes(1);
    expect(lfgService.createIntent).toHaveBeenCalledWith(7, 42);
    const payload = editReply.mock.calls[0][0] as {
      embeds: Array<{ toJSON: () => { description?: string } }>;
    };
    expect(payload.embeds[0].toJSON().description).toContain("That's 2 now");
  });

  it('is IDEMPOTENT: a repeat /lfg makes exactly one write call and says already in', async () => {
    const lfgService = makeLfgService({
      createIntent: jest.fn().mockResolvedValue({
        created: false,
        body: { group: summary({ activeCount: 2 }) },
      }),
    });
    const command = build([LINKED, [{ id: 42, name: 'Deep Rock Galactic' }]], lfgService);
    const { interaction, editReply } = makeInteraction('42');

    await command.handleInteraction(interaction);

    expect(lfgService.createIntent).toHaveBeenCalledTimes(1);
    const payload = editReply.mock.calls[0][0] as {
      embeds: Array<{ toJSON: () => { description?: string } }>;
    };
    expect(payload.embeds[0].toJSON().description).toContain(
      "You're already in — 2 looking",
    );
  });

  it('resolves a free-typed exact game NAME to its id before writing', async () => {
    const lfgService = makeLfgService();
    const command = build([LINKED, [{ id: 99, name: 'Valheim' }]], lfgService);
    const { interaction } = makeInteraction('Valheim');

    await command.handleInteraction(interaction);

    expect(lfgService.createIntent).toHaveBeenCalledWith(7, 99);
  });

  it('tells the user when nothing matched, and writes nothing', async () => {
    const lfgService = makeLfgService();
    const command = build([LINKED, []], lfgService);
    const { interaction, editReply } = makeInteraction('drg 2');

    await command.handleInteraction(interaction);

    expect(lfgService.createIntent).not.toHaveBeenCalled();
    const payload = editReply.mock.calls[0][0] as {
      embeds: Array<{ toJSON: () => { description?: string } }>;
    };
    expect(payload.embeds[0].toJSON().description).toContain("I don't know");
  });

  it.each([
    ['bare /lfg', null],
    ['/lfg list', LFG_LIST_SENTINEL],
  ])('%s lists the caller groups instead of writing', async (_label, game) => {
    const lfgService = makeLfgService({
      listGroups: jest
        .fn()
        .mockResolvedValue([summary({ hasOwnIntent: true, gameName: 'Mine' })]),
    });
    const command = build([LINKED], lfgService);
    const { interaction, editReply } = makeInteraction(game);

    await command.handleInteraction(interaction);

    expect(lfgService.createIntent).not.toHaveBeenCalled();
    expect(lfgService.listGroups).toHaveBeenCalledWith(7);
    const payload = editReply.mock.calls[0][0] as {
      embeds: Array<{ toJSON: () => { author?: { name: string } } }>;
      components: unknown[];
    };
    expect(payload.embeds[0].toJSON().author?.name).toBe('📋 YOUR GROUPS · 1');
    expect(payload.components).toHaveLength(1);
  });

  it('skips the roster read entirely while the caller is the only one looking', async () => {
    const lfgService = makeLfgService({
      createIntent: jest.fn().mockResolvedValue({
        created: true,
        body: { group: summary({ activeCount: 1, state: 'lfg' }) },
      }),
    });
    const command = build([LINKED, [{ id: 42, name: 'Deep Rock Galactic' }]], lfgService);
    const { interaction } = makeInteraction('42');

    await command.handleInteraction(interaction);

    expect(lfgService.getGroupDetail).not.toHaveBeenCalled();
  });
});
