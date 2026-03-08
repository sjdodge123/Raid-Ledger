/**
 * Unit tests for ROK-626: PUG signup bench fallback.
 */
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

describe('PUG signup — anonymous path', () => {
  it('should create signup and assign roster for anonymous PUG', async () => {
    const deps = createMockDeps();
    // findLinkedUser returns no user → anonymous path
    (deps.db.select as jest.Mock)
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      })
      // resolveEffectiveRole: fetch event
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 1, maxAttendees: 25 }]),
          }),
        }),
      })
      // checkAutoBench: count roster assignments (not full)
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([{ count: 0 }]),
          }),
        }),
      })
      // assignAnonymousRoster: find positions
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      });
    // Second insert call: roster assignment
    (deps.db.insert as jest.Mock)
      .mockReturnValueOnce({
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
      })
      .mockReturnValueOnce({
        values: jest.fn().mockResolvedValue(undefined),
      });
    await createPugSignup(
      deps,
      mockSlot as Parameters<typeof createPugSignup>[1],
      'dps',
    );
    expect(deps.db.insert).toHaveBeenCalledTimes(2);
    expect(deps.logger.log).toHaveBeenCalled();
  });

  it('should delegate to signupsService.signup for linked PUG', async () => {
    const deps = createMockDeps();
    // findLinkedUser returns a user
    (deps.db.select as jest.Mock).mockReturnValueOnce({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([{ id: 1 }]),
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
