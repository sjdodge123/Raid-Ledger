/**
 * ROK-1660 — `/lfg-leave`: definition, own-hands autocomplete, and every
 * execute path (one game / not in / all / empty / unlinked / blocked).
 * The write itself is `LfgService.withdraw`, pinned against Postgres by the
 * integration tier; here it is a mock whose calls are the evidence.
 */
import { NotFoundException } from '@nestjs/common';
import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
} from 'discord.js';
import type { LfgGroupSummaryDto } from '@raid-ledger/contract';
import { LfgLeaveCommand } from './lfg-leave.command';
import { LFG_BLOCKED_REPLY, LFG_UNLINKED_REPLY } from './lfg.command.helpers';
import { resolveLfgCaller, type LfgCaller } from './lfg.command';
import type { LfgService } from '../../lfg/lfg.service';
import type { SettingsService } from '../../settings/settings.service';

jest.mock('./lfg.command', () => ({
  resolveLfgCaller: jest.fn(),
  loadLfgReplyContext: jest.fn().mockResolvedValue({
    communityName: null,
    clientUrl: null,
    timezone: null,
  }),
  loadLfgPostLinks: jest.fn().mockResolvedValue(new Map()),
}));
jest.mock('../lfg-board/lfg-board.db-helpers', () => ({
  listLfmThreadsForGames: jest.fn().mockResolvedValue([]),
}));
const resolveCaller = resolveLfgCaller as jest.MockedFunction<
  typeof resolveLfgCaller
>;

function group(id: number, name: string, own: boolean, count = 2) {
  return {
    gameId: id,
    gameName: name,
    gameSlug: name.toLowerCase(),
    gameCoverUrl: null,
    activeCount: count,
    nowCount: 0,
    state: 'lfg',
    viabilityThreshold: null,
    isViable: false,
    hasOwnIntent: own,
    soonestExpiresAt: null,
    soonestNowExpiresAt: null,
    playingNow: null,
  } satisfies LfgGroupSummaryDto;
}

const caller: LfgCaller = { id: 7, deactivatedAt: null, bannedAt: null };

/** A drizzle stand-in: each `select()` consumes one queued row batch. */
function fakeDb(batches: GameRow[][]) {
  let calls = 0;
  const limit = () => Promise.resolve(batches[calls++] ?? []);
  return { select: () => ({ from: () => ({ where: () => ({ limit }) }) }) };
}

type GameRow = { id: number; name: string };

function setup(lists: LfgGroupSummaryDto[][], games: GameRow[][] = []) {
  const listGroups = jest.fn();
  for (const list of lists) listGroups.mockResolvedValueOnce(list);
  listGroups.mockResolvedValue(lists.at(-1) ?? []);
  const withdraw = jest.fn().mockResolvedValue(undefined);
  const service = { listGroups, withdraw } as unknown as LfgService;
  const command = new LfgLeaveCommand(
    fakeDb(games) as never,
    service,
    {} as SettingsService,
  );
  return { command, listGroups, withdraw };
}

function slash(game: string | null) {
  const editReply = jest.fn().mockResolvedValue(undefined);
  const interaction = {
    user: { id: 'discord-7' },
    options: { getString: () => game },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply,
  } as unknown as ChatInputCommandInteraction;
  return { interaction, editReply };
}

/** The description of the first embed in an editReply payload. */
function embedText(payload: unknown): string {
  const embeds = (payload as { embeds?: Array<{ data: object }> }).embeds;
  return JSON.stringify(embeds?.[0]?.data ?? {});
}

beforeEach(() => resolveCaller.mockReset().mockResolvedValue(caller));

describe('LfgLeaveCommand — definition (ROK-1660)', () => {
  it('registers /lfg-leave with an optional autocompleted game option', () => {
    const json = setup([]).command.getDefinition();
    expect(json.name).toBe('lfg-leave');
    expect(json.description).toBe("Leave an LFG you're in");
    expect(json.options).toEqual([
      expect.objectContaining({
        name: 'game',
        description: 'Which LFG to leave — leave empty to see your list',
        autocomplete: true,
        required: false,
        max_length: 100,
      }),
    ]);
  });
});

describe('LfgLeaveCommand — autocomplete (ROK-1660)', () => {
  function auto(value: string) {
    const respond = jest.fn().mockResolvedValue(undefined);
    const interaction = {
      user: { id: 'discord-7' },
      options: { getFocused: () => ({ name: 'game', value }) },
      respond,
    } as unknown as AutocompleteInteraction;
    return { interaction, respond };
  }

  it('offers All my LFGs then only the caller’s own games', async () => {
    const { command, listGroups } = setup([
      [group(1, 'Valheim', true), group(2, 'DRG', false)],
    ]);
    const { interaction, respond } = auto('');
    await command.handleAutocomplete(interaction);
    expect(listGroups).toHaveBeenCalledWith(7);
    expect(respond).toHaveBeenCalledWith([
      { name: 'All my LFGs', value: 'all' },
      { name: 'Valheim', value: '1' },
    ]);
  });

  it('gives an unlinked caller the none choice without reading groups', async () => {
    resolveCaller.mockResolvedValue(null);
    const { command, listGroups } = setup([[group(1, 'Valheim', true)]]);
    const { interaction, respond } = auto('');
    await command.handleAutocomplete(interaction);
    expect(listGroups).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith([
      { name: "You're not in any LFG", value: 'none' },
    ]);
  });
});

describe('LfgLeaveCommand — leave one game (ROK-1660)', () => {
  it('leaves one own game and says how many are still looking', async () => {
    const { command, withdraw } = setup([
      [group(1, 'Valheim', true, 4)],
      [group(1, 'Valheim', false, 3)],
    ]);
    const { interaction, editReply } = slash('1');
    await command.handleInteraction(interaction);
    expect(withdraw).toHaveBeenCalledWith(7, 1);
    expect(editReply).toHaveBeenCalledWith(
      "You're out — **Valheim**. 3 still looking.",
    );
  });

  it('a game the caller is not in → the not-in reply', async () => {
    const { command, withdraw } = setup([[]], [[{ id: 5, name: 'Valheim' }]]);
    withdraw.mockRejectedValue(new NotFoundException());
    const { interaction, editReply } = slash('Valheim');
    await command.handleInteraction(interaction);
    expect(withdraw).toHaveBeenCalledWith(7, 5);
    expect(editReply).toHaveBeenCalledWith(
      "You're not in the **Valheim** group.",
    );
  });

  it('free text matching no game → unknown-game embed, no write', async () => {
    const { command, withdraw } = setup([[]], [[], []]);
    const { interaction, editReply } = slash('Nonsense');
    await command.handleInteraction(interaction);
    expect(withdraw).not.toHaveBeenCalled();
    expect(embedText(editReply.mock.calls[0]?.[0])).toContain(
      "I don't know **Nonsense**",
    );
  });
});

describe('LfgLeaveCommand — All my LFGs (ROK-1660)', () => {
  it('All my LFGs withdraws every own hand and nobody else’s', async () => {
    const { command, withdraw } = setup([
      [group(1, 'A', true), group(2, 'X', false), group(3, 'B', true)],
    ]);
    const { interaction, editReply } = slash('all');
    await command.handleInteraction(interaction);
    expect(withdraw.mock.calls).toEqual([
      [7, 1],
      [7, 3],
    ]);
    expect(editReply).toHaveBeenCalledWith(
      "You're out of all 2 — **A**, **B**.",
    );
  });

  it('All my LFGs with one hand → the one-game reply', async () => {
    const { command } = setup([[group(1, 'A', true, 1)], []]);
    const { interaction, editReply } = slash('all');
    await command.handleInteraction(interaction);
    expect(editReply).toHaveBeenCalledWith("You're out — **A**.");
  });

  it('All my LFGs with no hands → the empty-list copy, no write', async () => {
    const { command, withdraw } = setup([[group(2, 'X', false)]]);
    const { interaction, editReply } = slash('all');
    await command.handleInteraction(interaction);
    expect(withdraw).not.toHaveBeenCalled();
    expect(embedText(editReply.mock.calls[0]?.[0])).toContain(
      "You're not looking for anything right now",
    );
  });
});

describe('LfgLeaveCommand — bare list and guards (ROK-1660)', () => {
  it('bare /lfg-leave shows the list with a leave button per own group', async () => {
    const { command, withdraw } = setup([[group(1, 'Valheim', true)]]);
    const { interaction, editReply } = slash(null);
    await command.handleInteraction(interaction);
    expect(withdraw).not.toHaveBeenCalled();
    const payload = editReply.mock.calls[0]?.[0] as { components: unknown[] };
    expect(JSON.stringify(payload.components)).toContain('lfg:withdraw:1');
  });

  it('unlinked caller → LFG_UNLINKED_REPLY, no reads or writes', async () => {
    resolveCaller.mockResolvedValue(null);
    const { command, listGroups, withdraw } = setup([]);
    const { interaction, editReply } = slash('all');
    await command.handleInteraction(interaction);
    expect(editReply).toHaveBeenCalledWith(LFG_UNLINKED_REPLY);
    expect(listGroups).not.toHaveBeenCalled();
    expect(withdraw).not.toHaveBeenCalled();
  });

  it('blocked caller → LFG_BLOCKED_REPLY, no writes', async () => {
    resolveCaller.mockResolvedValue({ ...caller, bannedAt: new Date() });
    const { command, withdraw } = setup([[group(1, 'Valheim', true)]]);
    const { interaction, editReply } = slash('1');
    await command.handleInteraction(interaction);
    expect(editReply).toHaveBeenCalledWith(LFG_BLOCKED_REPLY);
    expect(withdraw).not.toHaveBeenCalled();
  });
});
