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
  };
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
    deleteReply: jest.fn().mockResolvedValue(undefined),
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

/** The option values of the (first) select in an edited reply. */
function selectValues(body: { components: { toJSON(): unknown }[] }): string[] {
  const rows = body.components.map(
    (row) =>
      row.toJSON() as { components: { options?: { value: string }[] }[] },
  );
  const select = rows
    .flatMap((row) => row.components)
    .find((c) => Array.isArray(c.options));
  return (select?.options ?? []).map((o) => o.value);
}

interface EditedBody {
  content?: string;
  components: { toJSON(): unknown }[];
}

function edited(i: { editReply: jest.Mock }): EditedBody {
  return (i.editReply.mock.calls as EditedBody[][])[0][0];
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
    caller.mockResolvedValue(who);
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
    const [[built]] = i.showModal.mock.calls as [[{ toJSON(): unknown }]];
    const modal = built.toJSON() as {
      components: { components: { value?: string }[] }[];
    };
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
  it('one confident match still shows the list — a one-option select (ROK-1658)', async () => {
    search.mockResolvedValue([DRG]);
    const i = submit('deep rock galactic');
    await submitComposerSearch(deps(), i as never);
    expect(i.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
    const body = edited(i);
    expect(body.content).not.toBe(
      'When do you want to play Deep Rock Galactic?',
    );
    expect(body.content).toBe('1 game matches “deep rock galactic”');
    expect(ids(body)).toEqual(
      expect.arrayContaining([
        'lfgc:pick:deep rock galactic',
        'lfgc:back:deep rock galactic',
      ]),
    );
    expect(selectValues(body)).toEqual(['7']);
    expect(fuzzy).not.toHaveBeenCalled();
  });

  it('several candidates render a select and never auto-select', async () => {
    search.mockResolvedValue([DRG, VALHEIM]);
    const i = submit('a');
    await submitComposerSearch(deps(), i as never);
    expect(edited(i).content).toBe('2 games match “a”');
    expect(ids(edited(i))).toContain('lfgc:pick:a');
  });

  it('zero exact hits fall back to "Did you mean" — even for one row', async () => {
    search.mockResolvedValue([]);
    fuzzy.mockResolvedValue([VALHEIM]);
    const i = submit('valhiem');
    await submitComposerSearch(deps(), i as never);
    expect(edited(i).content).toBe(
      'No exact match for “valhiem”. Did you mean:',
    );
    expect(ids(edited(i))).toContain('lfgc:pick:valhiem');
  });

  it('nothing at all says so and offers only Back, which reopens the modal', async () => {
    search.mockResolvedValue([]);
    fuzzy.mockResolvedValue([]);
    const i = submit('bg3');
    await submitComposerSearch(deps(), i as never);
    expect(edited(i).content).toBe('No games match “bg3”');
    expect(ids(edited(i))).toEqual(['lfgc:back:bg3']);
    expect(selectValues(edited(i))).toEqual([]);
  });

  it('replaces an ephemeral step in place rather than stacking', async () => {
    search.mockResolvedValue([DRG]);
    const i = submit('deep rock galactic', true);
    await submitComposerSearch(deps(), i as never);
    expect(i.deferUpdate).toHaveBeenCalled();
    expect(i.deferReply).not.toHaveBeenCalled();
  });
});

describe('submitComposerSearch (ROK-1658 — the list is always shown)', () => {
  // Step 3 table: "one confident match" is a search that returned ONE game.
  // An exact title among several matches is the "several candidates" row.
  const SURVIVOR = { id: 9, name: 'Deep Rock Galactic: Survivor' };

  it('an exact title among several word matches lists every match, the exact title first', async () => {
    search.mockResolvedValue([SURVIVOR, DRG]);
    const i = submit('deep rock galactic');
    await submitComposerSearch(deps(), i as never);
    expect(edited(i).content).toBe('2 games match “deep rock galactic”');
    expect(selectValues(edited(i))).toEqual(['7', '9']);
  });

  it('Back from urgency re-renders that same full list, the exact title first', async () => {
    search.mockResolvedValue([SURVIVOR, DRG]);
    const i = fake('lfgc:backc:deep rock galactic');
    await backToComposerCandidates(deps(), i as never);
    expect(edited(i).content).toBe('2 games match “deep rock galactic”');
    expect(selectValues(edited(i))).toEqual(['7', '9']);
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

  it('a candidate gone since the search offers Back to the modal', async () => {
    findGame.mockResolvedValue(null);
    const i = fake('lfgc:pick:deep', { values: ['7'] });
    await pickComposerGame(deps(), i as never);
    expect(ids(edited(i))).toEqual(['lfgc:back:deep']);
  });

  it('Back from urgency after a single-match pick returns to the one-option select', async () => {
    search.mockResolvedValue([DRG]);
    const i = fake('lfgc:backc:deep rock galactic');
    await backToComposerCandidates(deps(), i as never);
    expect(edited(i).content).toBe('1 game matches “deep rock galactic”');
    expect(ids(edited(i))).toContain('lfgc:pick:deep rock galactic');
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
    expect(i.editReply).not.toHaveBeenCalled();
    expect(i.deleteReply).toHaveBeenCalledTimes(1);
  });

  it('closes the ephemeral once the group posts (prototype step 5)', async () => {
    const i = fake('lfgc:go:week:7:c:deep');
    await goComposer(deps(), i as never);
    expect(i.deferUpdate).toHaveBeenCalled();
    expect(i.deleteReply).toHaveBeenCalledTimes(1);
    expect(i.editReply).not.toHaveBeenCalled();
  });

  it('a repeat press posts nothing new, so it says so instead of closing', async () => {
    const d = deps();
    d.createIntent.mockResolvedValue({ ...RESULT, created: false });
    const i = fake('lfgc:go:week:7:c:deep');
    await goComposer(d, i as never);
    expect(i.deleteReply).not.toHaveBeenCalled();
    expect(edited(i).content).toMatch(/^You're already in/);
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

  it('answers a malformed go id with the stale reply instead of silence', async () => {
    const d = deps();
    const reply = jest.fn().mockResolvedValue(undefined);
    const i = fake('lfgc:go:garbage', { reply });
    await goComposer(d, i as never);
    expect(d.createIntent).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith({
      content: LFG_COMPOSER_COPY.STALE_REPLY,
      flags: MessageFlags.Ephemeral,
    });
  });
});
