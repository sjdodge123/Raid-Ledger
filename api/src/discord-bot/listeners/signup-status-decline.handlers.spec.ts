/**
 * ROK-1728: `handleDecline` hands a series member to the series decline
 * choice (Skip this night / Leave series) before the per-night decline runs.
 */
import { NotFoundException } from '@nestjs/common';
import {
  handleDecline,
  DECLINE_NOT_FOUND_REPLY,
} from './signup-status.handlers';
import { offerSeriesDeclineChoice } from './series-signup-decline.handlers';
import type { SignupInteractionDeps } from './signup-interaction.types';
import {
  createMockDeps,
  createMockButtonInteraction,
} from './signup-handlers.spec-helpers';

jest.mock('./series-signup-decline.handlers', () => ({
  offerSeriesDeclineChoice: jest.fn(),
}));

const mockedOffer = offerSeriesDeclineChoice as jest.Mock;

function makeDeps(): SignupInteractionDeps {
  const deps = createMockDeps();
  Object.assign(deps.signupsService, {
    findByDiscordUser: jest.fn().mockResolvedValue({ id: 7 }),
    cancelByDiscordUser: jest.fn().mockResolvedValue(undefined),
  });
  return deps;
}

function makeInteraction(): ReturnType<typeof createMockButtonInteraction> {
  return Object.assign(createMockButtonInteraction(), {
    user: { id: 'discord-1' },
  });
}

describe('handleDecline — series hook (ROK-1728)', () => {
  beforeEach(() => mockedOffer.mockReset());

  it('stops after the series choice when the decliner is a series member', async () => {
    mockedOffer.mockResolvedValue(true);
    const deps = makeDeps();
    const interaction = makeInteraction();

    await handleDecline(interaction, 10, deps);

    expect(mockedOffer).toHaveBeenCalledWith(interaction, 10, deps);
    expect(deps.signupsService.cancelByDiscordUser).not.toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(deps.updateEmbedSignupCount).not.toHaveBeenCalled();
  });

  it('runs the per-night decline when the user is not a series member', async () => {
    mockedOffer.mockResolvedValue(false);
    const deps = makeDeps();
    const interaction = makeInteraction();

    await handleDecline(interaction, 10, deps);

    expect(mockedOffer).toHaveBeenCalledWith(interaction, 10, deps);
    expect(deps.signupsService.cancelByDiscordUser).toHaveBeenCalledWith(
      10,
      'discord-1',
    );
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: "You've **declined** this event.",
      embeds: [],
    });
    expect(deps.updateEmbedSignupCount).toHaveBeenCalledWith(10);
  });
});

describe('handleDecline — signup the Discord id does not own (ROK-2097)', () => {
  beforeEach(() => mockedOffer.mockReset().mockResolvedValue(false));

  it('replies not-found instead of a generic error and leaves the embed alone', async () => {
    const deps = makeDeps();
    (deps.signupsService.cancelByDiscordUser as jest.Mock).mockRejectedValue(
      new NotFoundException('Signup not found for Discord user discord-1'),
    );
    const interaction = makeInteraction();

    await handleDecline(interaction, 10, deps);

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: "You're not signed up for this event.",
      embeds: [],
    });
    expect(DECLINE_NOT_FOUND_REPLY).toBe(
      "You're not signed up for this event.",
    );
    expect(deps.updateEmbedSignupCount).not.toHaveBeenCalled();
  });

  it('still rethrows a non-not-found failure', async () => {
    const deps = makeDeps();
    (deps.signupsService.cancelByDiscordUser as jest.Mock).mockRejectedValue(
      new Error('db down'),
    );
    await expect(handleDecline(makeInteraction(), 10, deps)).rejects.toThrow(
      'db down',
    );
  });
});
