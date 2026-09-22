/**
 * ROK-1612 AC2–AC5, AC8, AC9 — every composer step, driven with fake
 * interactions. Bots cannot press another bot's buttons, so this tier is where
 * the handlers are proven; the companion smoke only asserts the pinned card.
 */
import { MessageFlags } from 'discord.js';
import {
  LFG_BLOCKED_REPLY,
  LFG_UNLINKED_REPLY,
} from '../commands/lfg.command.helpers';
import { resolveLfgCaller } from '../commands/lfg.command';
import { LFG_COMPOSER_COPY } from './lfg-composer.constants';
import {
  findComposerGame,
  searchComposerGames,
  searchComposerGamesFuzzy,
} from './lfg-composer-search.db-helpers';
import {
  goComposer,
  openComposerModal,
  pickComposerGame,
  backToComposerCandidates,
  submitComposerSearch,
  type ComposerFlowDeps,
} from './lfg-composer-flow.helpers';

jest.mock('../commands/lfg.command', () => ({ resolveLfgCaller: jest.fn() }));
jest.mock('./lfg-composer-search.db-helpers', () => ({
  findComposerGame: jest.fn(),
  searchComposerGames: jest.fn(),
  searchComposerGamesFuzzy: jest.fn(),
}));

const caller = jest.mocked(resolveLfgCaller);
const search = jest.mocked(searchComposerGames);
const fuzzy = jest.mocked(searchComposerGamesFuzzy);
const findGame = jest.mocked(findComposerGame);

const DRG = { id: 7, name: 'Deep Rock Galactic' };
const VALHEIM = { id: 8, name: 'Valheim' };
const LINKED = { id: 42, deactivatedAt: null, bannedAt: null };
const RESULT = { created: true, body: { group: { gameName: 'DRG' } } };

function deps(): ComposerFlowDeps & { createIntent: jest.Mock } {
  const createIntent = jest.fn().mockResolvedValue(RESULT);
  return {
    db: {} as never,
    lfgService: { createIntent },
    settingsService: {
      getClientUrl: jest.fn().mockResolvedValue('https://rl.test'),
      getDiscordBotTimezone: jest.fn().mockResolvedValue('UTC'),
    },
    createIntent,
  } as never;
}

/** A fake interaction carrying every method a step may call. */
function fake(customId: string, extra: Record<string, unknown> = {}) {
  return {
    customId,
    user: { id: 'discord-1' },
    reply: jest.fn().mockResolvedValue(undefined),
    showModal: jest.fn().mockResolvedValue(undefined),
    deferUpdate: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    ...extra,
  };
}

/** The ids of every button/select in an edited reply. */
function ids(body: { components: { toJSON(): unknown }[] }): string[] {
  return body.components.flatMap((row) =>
    (row.toJSON() as { components: { custom_id?: string }[] }).components
      .map((c) => c.custom_id)
      .filter((id): id is string => Boolean(id)),
  );
}

function edited(i: { editReply: jest.Mock }) {
  return i.editReply.mock.calls[0][0];
}

beforeEach(() => {
  jest.clearAllMocks();
  caller.mockResolvedValue(LINKED);
});

describe('openComposerModal (AC5 before the modal)', () => {
  it.each([
    ['unlinked', null, LFG_UNLINKED_REPLY],
    ['banned', { ...LINKED, bannedAt: new Date() }, LFG_BLOCKED_REPLY],
  ])('refuses a %s caller without opening the modal', async (_, who, text) => {
    caller.mockResolvedValue(who as never);
    const i = fake('lfgc:open');
    await openComposerModal(deps(), i as never, '');
    expect(i.showModal).not.toHaveBeenCalled();
    expect(i.reply).toHaveBeenCalledWith({
      content: text,
      flags: MessageFlags.Ephemeral,
    });
  });

  it('reopens the modal prefilled with what was typed (AC8/AC9)', async () => {
    const i = fake('lfgc:back:deep rok');
    await openComposerModal(deps(), i as never, 'deep rok');
    const modal = i.showModal.mock.calls[0][0].toJSON();
    expect(modal.components[0].components[0].value).toBe('deep rok');
  });
});

function submit(term: string, ephemeralParent = false) {
  return fake('lfgc:modal', {
    fields: { getTextInputValue: () => term },
    isFromMessage: () => ephemeralParent,
    message: { flags: { has: () => ephemeralParent } },
  });
}

describe('submitComposerSearch (the four AC2 outcomes)', () => {
  it('one confident match goes straight to the urgency step', async () => {
    search.mockResolvedValue([DRG]);
    const i = submit('deep rock galactic');
    await submitComposerSearch(deps(), i as never);
    expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(edited(i).content).toBe('When do you want to play Deep Rock Galactic?');
    expect(ids(edited(i))).toContain('lfgc:back:deep rock galactic');
    expect(fuzzy).not.toHaveBeenCalled();
  });

  it('several candidates render a select and never auto-select', async () => {
    search.mockResolvedValue([DRG, VALHEIM]);
    const i = submit('a');
    await submitComposerSearch(deps(), i as never);
    expect(edited(i).content).toBe('2 games match `a`');
    expect(ids(edited(i))).toContain('lfgc:pick:a');
  });

  it('zero exact hits fall back to "Did you mean" — even for one row', async () => {
    search.mockResolvedValue([]);
    fuzzy.mockResolvedValue([VALHEIM]);
    const i = submit('valhiem');
    await submitComposerSearch(deps(), i as never);
    expect(edited(i).content).toBe('No exact match for `valhiem`. Did you mean:');
    expect(ids(edited(i))).toContain('lfgc:pick:valhiem');
  });

  it('nothing at all ends in Try again, never a dead end', async () => {
    search.mockResolvedValue([]);
    fuzzy.mockResolvedValue([]);
    const i = submit('bg3');
    await submitComposerSearch(deps(), i as never);
    expect(ids(edited(i))).toEqual(['lfgc:back:bg3']);
  });

  it('replaces an ephemeral step in place rather than stacking', async () => {
    search.mockResolvedValue([DRG]);
    const i = submit('deep rock galactic', true);
    await submitComposerSearch(deps(), i as never);
    expect(i.deferUpdate).toHaveBeenCalled();
    expect(i.deferReply).not.toHaveBeenCalled();
  });
});

describe('pick + back (AC9)', () => {
  it('a picked candidate reaches urgency, whose Back returns to the select', async () => {
    findGame.mockResolvedValue(DRG);
    const i = fake('lfgc:pick:deep', { values: ['7'] });
    await pickComposerGame(deps(), i as never);
    expect(findGame).toHaveBeenCalledWith({}, 7);
    expect(ids(edited(i))).toContain('lfgc:backc:deep');
  });

  it('a candidate gone since the search offers Try again', async () => {
    findGame.mockResolvedValue(null);
    const i = fake('lfgc:pick:deep', { values: ['7'] });
    await pickComposerGame(deps(), i as never);
    expect(ids(edited(i))).toEqual(['lfgc:back:deep']);
  });

  it('Back to candidates re-renders the select with the term intact', async () => {
    search.mockResolvedValue([DRG, VALHEIM]);
    const i = fake('lfgc:backc:deep');
    await backToComposerCandidates(deps(), i as never);
    expect(search).toHaveBeenCalledWith({}, 'deep');
    expect(ids(edited(i))).toContain('lfgc:pick:deep');
  });
});

describe('goComposer (AC4 — the one write path)', () => {
  it('writes through createIntent with the parsed urgency', async () => {
    const d = deps();
    const i = fake('lfgc:go:now-30:7:c:deep');
    await goComposer(d, i as never);
    expect(d.createIntent).toHaveBeenCalledWith(42, 7, {
      urgency: 'now',
      ttlMinutes: 30,
      timezone: 'UTC',
    });
    expect(edited(i).content).toMatch(/^You're in/);
  });

  it('re-checks AC5 at press time and writes nothing for a blocked caller', async () => {
    caller.mockResolvedValue({ ...LINKED, deactivatedAt: new Date() });
    const d = deps();
    const i = fake('lfgc:go:week:7:s:deep');
    await goComposer(d, i as never);
    expect(d.createIntent).not.toHaveBeenCalled();
    expect(edited(i)).toEqual({ content: LFG_BLOCKED_REPLY, components: [] });
  });

  it('refuses an urgency the vocabulary no longer has', async () => {
    const d = deps();
    const i = fake('lfgc:go:soon:7:s:deep');
    await goComposer(d, i as never);
    expect(d.createIntent).not.toHaveBeenCalled();
    expect(edited(i).content).toBe(LFG_COMPOSER_COPY.STALE_REPLY);
  });
});
