/**
 * ROK-2097 review r1: a Discord button that resolves a signup the clicker may
 * see but not manage gets the not-signed-up reply, never a generic error, and
 * nothing is refreshed.
 */
import { NotFoundException } from '@nestjs/common';
import type { ButtonInteraction } from 'discord.js';
import {
  NOT_SIGNED_UP_REPLY,
  runOrReplyNotSignedUp,
} from './signup-not-found.helpers';
import { handleTentative } from './signup-status.handlers';
import { createMockDeps } from './signup-handlers.spec-helpers';

const DISCORD_ID = 'discord-unlinked-1';

function makeInteraction(): ButtonInteraction {
  return {
    editReply: jest.fn().mockResolvedValue(undefined),
    user: { id: DISCORD_ID },
  } as unknown as ButtonInteraction;
}

describe('runOrReplyNotSignedUp', () => {
  it('returns the action value when it resolves', async () => {
    const interaction = makeInteraction();
    const result = await runOrReplyNotSignedUp(interaction, () =>
      Promise.resolve('slot-1'),
    );
    expect(result).toEqual({ ok: true, value: 'slot-1' });
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it('replies not-signed-up on NotFoundException', async () => {
    const interaction = makeInteraction();
    const result = await runOrReplyNotSignedUp(interaction, () =>
      Promise.reject(new NotFoundException('Signup not found')),
    );
    expect(result).toEqual({ ok: false });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: "You're not signed up for this event.",
      embeds: [],
    });
  });

  it('rethrows any other error', async () => {
    const interaction = makeInteraction();
    await expect(
      runOrReplyNotSignedUp(interaction, () =>
        Promise.reject(new Error('db down')),
      ),
    ).rejects.toThrow('db down');
    expect(interaction.editReply).not.toHaveBeenCalled();
  });
});

describe('handleTentative — row the Discord id may not manage', () => {
  it('replies not-signed-up instead of marking tentative', async () => {
    const deps = createMockDeps();
    Object.assign(deps.signupsService, {
      findByDiscordUser: jest.fn().mockResolvedValue({
        id: 7,
        status: 'signed_up',
        discordUserId: DISCORD_ID,
        user: { id: 0 },
      }),
      updateStatus: jest
        .fn()
        .mockRejectedValue(new NotFoundException('Signup not found')),
    });
    const interaction = makeInteraction();

    await handleTentative(interaction, 10, deps);

    expect(deps.signupsService.updateStatus).toHaveBeenCalledWith(
      10,
      { discordUserId: DISCORD_ID },
      { status: 'tentative' },
    );
    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: NOT_SIGNED_UP_REPLY,
      embeds: [],
    });
    expect(deps.updateEmbedSignupCount).not.toHaveBeenCalled();
  });
});
