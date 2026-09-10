/**
 * Nominate-button guard ordering (ROK-1092 item 1).
 *
 * "Always Auto-Nominate" both persists a preference and performs a nomination.
 * When LineupsService is unresolvable the nomination cannot happen, so the
 * preference must not be written either — otherwise the user is told
 * "Nominations are not available." while the next Steam paste silently
 * auto-nominates off a choice whose only visible outcome was a failure.
 */
import { STEAM_NOMINATE_BUTTON_IDS } from '../discord-bot.constants';
import {
  handleNominateButtonClick,
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
    const deps = makeDeps({ lineupsService: undefined });
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
    const deps = makeDeps({ lineupsService: undefined });
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
