/**
 * Unit tests for PUG-invite signups: linked PUGs use the web path, anonymous
 * PUGs use signupDiscord so both share the ROK-2203 auto-bench/displacement rule.
 */
import { ConflictException } from '@nestjs/common';
import { createPugSignup } from './pug-invite-signup.helpers';
import type { PugInviteDeps } from './pug-invite.helpers';

function createMockDeps(): PugInviteDeps {
  const selectChainNoAssignments = {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue([]),
    }),
  };
  return {
    db: {
      select: jest.fn().mockReturnValue(selectChainNoAssignments),
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([
              {
                id: 100,
                eventId: 1,
                userId: null,
                discordUserId: 'discord-pug-1',
                discordUsername: 'PugPlayer',
              },
            ]),
          }),
        }),
      }),
    },
    signupsService: {
      signup: jest.fn().mockResolvedValue({ id: 100, assignedSlot: null }),
      signupDiscord: jest
        .fn()
        .mockResolvedValue({ id: 100, assignedSlot: 'bench' }),
    },
    charactersService: {},
    pugsService: {},
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
  } as unknown as PugInviteDeps;
}

const mockSlot = {
  id: 'slot-1',
  eventId: 1,
  discordUserId: 'discord-pug-1',
  discordUsername: 'PugPlayer',
  discordAvatarHash: null,
  role: 'dps',
  status: 'accepted',
};

/** findLinkedUser returns no user → anonymous path. */
function mockNoLinkedUser(deps: PugInviteDeps): void {
  (deps.db.select as jest.Mock).mockReturnValueOnce({
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue([]),
      }),
    }),
  });
}

describe('PUG signup — anonymous path', () => {
  it('routes an unlinked PUG through signupDiscord (shared displacement rule, ROK-2203)', async () => {
    const deps = createMockDeps();
    mockNoLinkedUser(deps);
    await createPugSignup(
      deps,
      { ...mockSlot, discordAvatarHash: 'abc' } as Parameters<
        typeof createPugSignup
      >[1],
      'dps',
    );
    expect(deps.signupsService.signupDiscord).toHaveBeenCalledWith(1, {
      discordUserId: 'discord-pug-1',
      discordUsername: 'PugPlayer',
      discordAvatarHash: 'abc',
      role: 'dps',
    });
    // No hand-rolled signup/roster insert that would skip displacement.
    expect(deps.db.insert).not.toHaveBeenCalled();
    expect(deps.logger.log).toHaveBeenCalledWith(
      'Created anonymous signup 100 for PUG PugPlayer on event 1 (bench)',
    );
  });

  it('forwards a generic "player" role unchanged', async () => {
    const deps = createMockDeps();
    mockNoLinkedUser(deps);
    await createPugSignup(
      deps,
      { ...mockSlot, role: 'player' } as Parameters<typeof createPugSignup>[1],
      'player',
    );
    expect(deps.signupsService.signupDiscord).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ role: 'player' }),
    );
  });

  it('returns null when the signup was created', async () => {
    const deps = createMockDeps();
    mockNoLinkedUser(deps);
    await expect(
      createPugSignup(
        deps,
        mockSlot as Parameters<typeof createPugSignup>[1],
        'dps',
      ),
    ).resolves.toBeNull();
  });

  it('returns the closed-signups reason instead of "Accepted" (ROK-2203)', async () => {
    const reason =
      'This event is being rescheduled via a scheduling poll and is no longer accepting signups.';
    const deps = createMockDeps();
    mockNoLinkedUser(deps);
    (deps.signupsService.signupDiscord as jest.Mock).mockRejectedValueOnce(
      new ConflictException(reason),
    );
    await expect(
      createPugSignup(
        deps,
        mockSlot as Parameters<typeof createPugSignup>[1],
        'dps',
      ),
    ).resolves.toBe(reason);
    expect(deps.logger.warn).toHaveBeenCalledWith(
      `Failed to create anonymous signup for PUG PugPlayer: ${reason}`,
    );
  });

  it('returns the generic button-path copy for an unexpected failure', async () => {
    const deps = createMockDeps();
    mockNoLinkedUser(deps);
    (deps.signupsService.signupDiscord as jest.Mock).mockRejectedValueOnce(
      new Error('db down'),
    );
    await expect(
      createPugSignup(
        deps,
        mockSlot as Parameters<typeof createPugSignup>[1],
        'dps',
      ),
    ).resolves.toBe('Something went wrong. Please try again.');
  });
});

describe('PUG signup — linked path', () => {
  it('should delegate to signupsService.signup for linked PUG', async () => {
    const deps = createMockDeps();
    // findLinkedUser returns a user
    (deps.db.select as jest.Mock).mockReturnValueOnce({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest
            .fn()
            .mockResolvedValue([{ id: 1, discordId: 'discord-pug-1' }]),
        }),
      }),
    });
    // delete orphaned signup
    (deps.db as unknown as Record<string, jest.Mock>).delete = jest
      .fn()
      .mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      });
    await createPugSignup(
      deps,
      mockSlot as Parameters<typeof createPugSignup>[1],
      'dps',
    );
    // Linked path delegates to signupsService.signup which handles bench
    expect(deps.signupsService.signup).toHaveBeenCalledWith(1, 1, {
      slotRole: 'dps',
    });
  });
});
