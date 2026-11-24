/**
 * ROK-2298: a blocked (banned/deactivated) account clicking Tentative on a
 * signup it ALREADY has is refused (no status write); Decline still works.
 */
import { handleDecline, handleTentative } from './signup-status.handlers';
import { findActiveLinkedUser } from './signup-interaction.helpers';
import { offerSeriesDeclineChoice } from './series-signup-decline.handlers';
import type { SignupInteractionDeps } from './signup-interaction.types';
import {
  createMockDeps,
  createMockButtonInteraction,
} from './signup-handlers.spec-helpers';

jest.mock('./signup-interaction.helpers', () => ({
  ...jest.requireActual('./signup-interaction.helpers'),
  findActiveLinkedUser: jest.fn(),
}));
jest.mock('./series-signup-decline.handlers', () => ({
  offerSeriesDeclineChoice: jest.fn(),
}));

const mockedFindActive = findActiveLinkedUser as jest.Mock;
const mockedOffer = offerSeriesDeclineChoice as jest.Mock;

const LIVE_ROW = {
  id: 7,
  status: 'signed_up',
  discordUserId: null,
  user: { id: 42 },
};

function makeDeps(): SignupInteractionDeps {
  const deps = createMockDeps();
  Object.assign(deps.signupsService, {
    findByDiscordUser: jest.fn().mockResolvedValue(LIVE_ROW),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    cancelByDiscordUser: jest.fn().mockResolvedValue(undefined),
  });
  return deps;
}

function makeInteraction(): ReturnType<typeof createMockButtonInteraction> {
  return Object.assign(createMockButtonInteraction(), {
    user: { id: 'discord-1' },
  });
}

describe('blocked account with an existing live signup (ROK-2298)', () => {
  beforeEach(() => {
    mockedFindActive.mockReset().mockResolvedValue(false);
    mockedOffer.mockReset().mockResolvedValue(false);
  });

  it('refuses Tentative: no status write, no embed sync', async () => {
    const deps = makeDeps();
    const interaction = makeInteraction();

    await handleTentative(interaction, 10, deps);

    expect(mockedFindActive).toHaveBeenCalledWith(interaction, deps);
    expect(deps.signupsService.updateStatus).not.toHaveBeenCalled();
    expect(deps.updateEmbedSignupCount).not.toHaveBeenCalled();
  });

  it('still lets the blocked account decline its existing row (AC 4)', async () => {
    const deps = makeDeps();
    const interaction = makeInteraction();

    await handleDecline(interaction, 10, deps);

    expect(deps.signupsService.cancelByDiscordUser).toHaveBeenCalledWith(
      10,
      'discord-1',
    );
    expect(deps.updateEmbedSignupCount).toHaveBeenCalledWith(10);
  });

  it('an active linked user on a live row still goes tentative', async () => {
    mockedFindActive.mockResolvedValue({ id: 42 });
    const deps = makeDeps();
    const interaction = makeInteraction();

    await handleTentative(interaction, 10, deps);

    expect(deps.signupsService.updateStatus).toHaveBeenCalledWith(
      10,
      { userId: 42 },
      { status: 'tentative' },
    );
  });
});
