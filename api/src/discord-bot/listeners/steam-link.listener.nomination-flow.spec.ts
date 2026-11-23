/**
 * Nominate-button guard ordering (ROK-1092 item 1).
 *
 * "Always Auto-Nominate" both persists a preference and performs a nomination.
 * When LineupsService is unresolvable the nomination cannot happen, so the
 * preference must not be written either — otherwise the user is told
 * "Nominations are not available." while the next Steam paste silently
 * auto-nominates off a choice whose only visible outcome was a failure.
 */
import { NotFoundException } from '@nestjs/common';
import {
  STEAM_INTEREST_BUTTON_IDS,
  STEAM_NOMINATE_BUTTON_IDS,
} from '../discord-bot.constants';
import { createDrizzleMock } from '../../common/testing/drizzle-mock';
import { ACCOUNT_BLOCKED_REPLY } from '../../users/discord-account-status.helpers';
import { handleInterestButtonClick } from './steam-link.listener.interest-flow';
import {
  handleNominateButtonClick,
  translateNominateError,
  type NominateButtonDeps,
} from './steam-link.listener.nomination-flow';

const USER_ID = 7;
const GAME_ID = 42;

function makeDb(): NominateButtonDeps['db'] {
  const chain: Record<string, jest.Mock> = {};
  chain.select = jest.fn().mockReturnValue(chain);
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockResolvedValue([{ name: 'Test Game' }]);
  return chain as never;
}

function makeInteraction() {
  return {
    user: { id: 'discord-user-1' },
    update: jest.fn().mockResolvedValue(undefined),
  };
}

function makeDeps(
  overrides: Partial<NominateButtonDeps> = {},
): NominateButtonDeps {
  return {
    db: makeDb(),
    findActiveBuildingLineupId: jest.fn().mockResolvedValue(123),
    addInterest: jest.fn().mockResolvedValue(undefined),
    findLinkedUser: jest.fn().mockResolvedValue({ id: USER_ID }),
    setAutoNominatePref: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('handleNominateButtonClick — auto-nominate guard order (ROK-1092)', () => {
  it('does not persist the preference when LineupsService is unavailable', async () => {
    // makeDeps() omits lineupsService — LineupsService unavailable.
    const deps = makeDeps();
    const interaction = makeInteraction();

    await handleNominateButtonClick(
      deps,
      interaction as never,
      STEAM_NOMINATE_BUTTON_IDS.AUTO,
      GAME_ID,
    );

    expect(deps.setAutoNominatePref).not.toHaveBeenCalled();
  });

  it('tells the user nominations are unavailable rather than failing silently', async () => {
    // makeDeps() omits lineupsService — LineupsService unavailable.
    const deps = makeDeps();
    const interaction = makeInteraction();

    await handleNominateButtonClick(
      deps,
      interaction as never,
      STEAM_NOMINATE_BUTTON_IDS.AUTO,
      GAME_ID,
    );

    expect(interaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Nominations are not available.' }),
    );
  });

  it('still persists the preference on the happy path', async () => {
    const nominate = jest.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ lineupsService: { nominate } });
    const interaction = makeInteraction();

    await handleNominateButtonClick(
      deps,
      interaction as never,
      STEAM_NOMINATE_BUTTON_IDS.AUTO,
      GAME_ID,
    );

    // The guard must not have cost the feature its normal behaviour.
    expect(deps.setAutoNominatePref).toHaveBeenCalledWith(USER_ID, true);
    expect(nominate).toHaveBeenCalled();
  });

  it('leaves the preference alone for a plain Nominate click', async () => {
    const nominate = jest.fn().mockResolvedValue(undefined);
    const deps = makeDeps({ lineupsService: { nominate } });
    const interaction = makeInteraction();

    await handleNominateButtonClick(
      deps,
      interaction as never,
      STEAM_NOMINATE_BUTTON_IDS.NOMINATE,
      GAME_ID,
    );

    expect(deps.setAutoNominatePref).not.toHaveBeenCalled();
    expect(nominate).toHaveBeenCalled();
  });
});

describe('translateNominateError — moderated game (backlog 2842)', () => {
  it('says a hidden/banned game cannot be nominated, not "try again"', () => {
    const copy = translateNominateError(
      new NotFoundException('Game not found'),
      'Banned Game',
    );

    expect(copy).toBe("**Banned Game** can't be nominated on this server.");
  });

  it('keeps the retry copy for an unknown failure', () => {
    const copy = translateNominateError(new Error('boom'), 'Some Game');

    expect(copy).toBe(
      'Could not nominate **Some Game** right now. Please try again.',
    );
  });
});

describe('Steam DM buttons refuse a blocked account (ROK-2298)', () => {
  const lineupsService = { nominate: jest.fn() };
  const blockedUser = { id: USER_ID, blocked: true };

  function replyOf(interaction: { update: jest.Mock }): unknown {
    return (interaction.update.mock.calls[0]?.[0] as { content?: unknown })
      ?.content;
  }

  it.each([
    STEAM_NOMINATE_BUTTON_IDS.NOMINATE,
    STEAM_NOMINATE_BUTTON_IDS.AUTO,
    STEAM_NOMINATE_BUTTON_IDS.HEART,
  ])(
    '%s: blocked reply, no nominate / interest / pref write',
    async (action) => {
      const deps = makeDeps({
        lineupsService:
          lineupsService as unknown as NominateButtonDeps['lineupsService'] &
            object,
        findLinkedUser: jest.fn().mockResolvedValue(blockedUser),
      });
      const interaction = makeInteraction();
      await handleNominateButtonClick(
        deps,
        interaction as never,
        action,
        GAME_ID,
      );
      expect({
        reply: replyOf(interaction),
        nominate: lineupsService.nominate.mock.calls.length,
        interest: (deps.addInterest as jest.Mock).mock.calls.length,
        pref: (deps.setAutoNominatePref as jest.Mock).mock.calls.length,
      }).toEqual({
        reply: ACCOUNT_BLOCKED_REPLY,
        nominate: 0,
        interest: 0,
        pref: 0,
      });
    },
  );

  it('heart-flow button: blocked reply, no interest row', async () => {
    const db = createDrizzleMock();
    db.limit.mockResolvedValueOnce([
      {
        id: USER_ID,
        discordId: 'discord-user-1',
        bannedAt: new Date(),
        deactivatedAt: null,
      },
    ]);
    const interaction = {
      ...makeInteraction(),
      customId: `${STEAM_INTEREST_BUTTON_IDS.HEART}:${GAME_ID}`,
    };
    await handleInterestButtonClick(db as never, interaction as never);
    expect({
      reply: replyOf(interaction),
      inserts: db.insert.mock.calls.length,
    }).toEqual({ reply: ACCOUNT_BLOCKED_REPLY, inserts: 0 });
  });
});
