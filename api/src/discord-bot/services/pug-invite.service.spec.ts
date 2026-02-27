/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { PugInviteService } from './pug-invite.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { ChannelResolverService } from './channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';

/** Create a Collection-like object that has a .find() method (mimics discord.js Collection). */
function createMockCollection(
  entries: Array<{
    user: { id: string; username: string; avatar: string | null };
  }>,
) {
  return {
    find: (predicate: (m: (typeof entries)[0]) => boolean) =>
      entries.find(predicate) ?? undefined,
    size: entries.length,
  };
}

describe('PugInviteService', () => {
  let module: TestingModule;
  let service: PugInviteService;
  let clientService: jest.Mocked<DiscordBotClientService>;
  let channelResolver: jest.Mocked<ChannelResolverService>;
  let mockDb: {
    insert: jest.Mock;
    select: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  const originalClientUrl = process.env.CLIENT_URL;

  /**
   * Chain-able mock for Drizzle query builder.
   * `select().from().where().limit()` — .limit() is the terminal for single-row lookups.
   * `select().from().where()` — .where() is the terminal for multi-row fetches (handleNewGuildMember).
   * `update().set().where().returning()` — .returning() is the terminal for updates.
   */
  const createSelectChain = (resolvedValue: unknown[] = []) => {
    const chain: Record<string, jest.Mock> = {};
    chain.from = jest.fn().mockReturnValue(chain);
    chain.where = jest.fn().mockReturnValue(chain);
    chain.limit = jest.fn().mockResolvedValue(resolvedValue);
    chain.orderBy = jest.fn().mockReturnValue(chain);
    return chain;
  };

  const createUpdateChain = (resolvedValue: unknown[] = []) => {
    const chain: Record<string, jest.Mock> = {};
    chain.set = jest.fn().mockReturnValue(chain);
    chain.where = jest.fn().mockReturnValue(chain);
    chain.returning = jest.fn().mockResolvedValue(resolvedValue);
    return chain;
  };

  /** Mock event row */
  const mockEvent = {
    id: 42,
    title: 'Weekly Raid',
    cancelledAt: null,
    duration: [
      new Date('2026-02-20T20:00:00Z'),
      new Date('2026-02-20T23:00:00Z'),
    ],
    gameId: 1,
  };

  /** Mock PUG slot row */
  const mockPugSlot = {
    id: 'pug-slot-uuid',
    eventId: 42,
    discordUsername: 'testplayer',
    discordUserId: null,
    discordAvatarHash: null,
    role: 'dps',
    class: null,
    spec: null,
    notes: null,
    status: 'pending',
    serverInviteUrl: null,
    claimedByUserId: null,
    createdBy: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  /** Reusable mock guild with matching member */
  const createMockGuild = (
    members: Array<{
      user: { id: string; username: string; avatar: string | null };
    }> = [],
  ) => ({
    members: {
      fetch: jest.fn().mockResolvedValue(createMockCollection(members)),
    },
    systemChannelId: 'system-channel',
    channels: {
      cache: {
        find: jest.fn().mockReturnValue({ id: 'text-ch-1' }),
      },
      fetch: jest.fn().mockResolvedValue({
        createInvite: jest.fn().mockResolvedValue({
          url: 'https://discord.gg/test123',
        }),
      }),
    },
  });

  const defaultMember = {
    user: {
      id: 'discord-user-123',
      username: 'testplayer',
      avatar: 'avatar-hash-abc',
    },
  };

  beforeEach(async () => {
    process.env.CLIENT_URL = 'http://localhost:5173';

    mockDb = {
      insert: jest.fn(),
      select: jest.fn().mockReturnValue(createSelectChain()),
      update: jest.fn().mockReturnValue(createUpdateChain()),
      delete: jest.fn(),
    };

    module = await Test.createTestingModule({
      providers: [
        PugInviteService,
        {
          provide: DrizzleAsyncProvider,
          useValue: mockDb,
        },
        {
          provide: DiscordBotClientService,
          useValue: {
            isConnected: jest.fn().mockReturnValue(true),
            getClient: jest.fn().mockReturnValue({
              isReady: () => true,
              guilds: {
                cache: {
                  first: () => createMockGuild([defaultMember]),
                },
              },
            }),
            sendEmbedDM: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ChannelResolverService,
          useValue: {
            resolveChannelForEvent: jest.fn().mockResolvedValue('channel-789'),
            resolveVoiceChannelForEvent: jest
              .fn()
              .mockResolvedValue('channel-789'),
          },
        },
        {
          provide: SettingsService,
          useValue: {
            getBranding: jest.fn().mockResolvedValue({
              communityName: 'Test Guild',
              communityLogoPath: null,
              communityAccentColor: null,
            }),
            getClientUrl: jest.fn().mockResolvedValue('http://localhost:5173'),
            getDefaultTimezone: jest
              .fn()
              .mockResolvedValue('America/New_York'),
          },
        },
      ],
    }).compile();

    service = module.get(PugInviteService);
    clientService = module.get(DiscordBotClientService);
    channelResolver = module.get(ChannelResolverService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();

    if (originalClientUrl !== undefined) {
      process.env.CLIENT_URL = originalClientUrl;
    } else {
      delete process.env.CLIENT_URL;
    }
  });

  describe('processPugSlotCreated', () => {
    it('should skip when bot is not connected', async () => {
      clientService.isConnected.mockReturnValue(false);

      await service.processPugSlotCreated('pug-slot-uuid', 42, 'testplayer');

      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it('should skip when event is cancelled', async () => {
      const cancelledEvent = { ...mockEvent, cancelledAt: new Date() };
      mockDb.select.mockReturnValue(createSelectChain([cancelledEvent]));

      await service.processPugSlotCreated('pug-slot-uuid', 42, 'testplayer');

      expect(clientService.getClient).not.toHaveBeenCalled();
    });

    it('should skip when event is not found', async () => {
      mockDb.select.mockReturnValue(createSelectChain([]));

      await service.processPugSlotCreated('pug-slot-uuid', 42, 'testplayer');

      expect(clientService.getClient).not.toHaveBeenCalled();
    });

    it('should skip when PUG slot no longer exists', async () => {
      // First select returns event, second select returns empty (slot deleted)
      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return createSelectChain([mockEvent]);
        }
        return createSelectChain([]);
      });

      await service.processPugSlotCreated('pug-slot-uuid', 42, 'testplayer');

      expect(clientService.sendEmbedDM).not.toHaveBeenCalled();
    });

    it('should skip when PUG slot is already invited (guard against duplicate DMs)', async () => {
      const alreadyInvitedSlot = { ...mockPugSlot, status: 'invited' };
      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return createSelectChain([mockEvent]);
        }
        return createSelectChain([alreadyInvitedSlot]);
      });

      await service.processPugSlotCreated('pug-slot-uuid', 42, 'testplayer');

      expect(clientService.sendEmbedDM).not.toHaveBeenCalled();
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('should skip when PUG slot is already accepted', async () => {
      const acceptedSlot = { ...mockPugSlot, status: 'accepted' };
      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return createSelectChain([mockEvent]);
        }
        return createSelectChain([acceptedSlot]);
      });

      await service.processPugSlotCreated('pug-slot-uuid', 42, 'testplayer');

      expect(clientService.sendEmbedDM).not.toHaveBeenCalled();
    });

    it('should update slot and send DM when member is found in server', async () => {
      // select calls: 1=event, 2=pugSlot(exists check), 3=pugSlot(get role after update)
      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return createSelectChain([mockEvent]);
        }
        return createSelectChain([mockPugSlot]);
      });

      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);

      await service.processPugSlotCreated('pug-slot-uuid', 42, 'testplayer');

      // Should have called update to set status to 'invited'
      expect(mockDb.update).toHaveBeenCalled();
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({
          discordUserId: 'discord-user-123',
          discordAvatarHash: 'avatar-hash-abc',
          status: 'invited',
        }),
      );

      // Should have sent DM with embed and action row (Accept/Decline buttons)
      expect(clientService.sendEmbedDM).toHaveBeenCalledWith(
        'discord-user-123',
        expect.anything(),
        expect.anything(),
      );
    });

    it('should generate server invite URL when member is not in server', async () => {
      // Client returns guild with no matching members
      clientService.getClient.mockReturnValue({
        isReady: () => true,
        guilds: {
          cache: {
            first: () => createMockGuild([]), // empty members
          },
        },
      } as never);

      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return createSelectChain([mockEvent]);
        }
        return createSelectChain([mockPugSlot]);
      });

      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);

      await service.processPugSlotCreated('pug-slot-uuid', 42, 'testplayer');

      // Should have set server invite URL
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({
          serverInviteUrl: 'https://discord.gg/test123',
        }),
      );

      // Should NOT have sent DM
      expect(clientService.sendEmbedDM).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully without throwing', async () => {
      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return createSelectChain([mockEvent]);
        }
        return createSelectChain([mockPugSlot]);
      });

      clientService.getClient.mockImplementation(() => {
        throw new Error('Bot crashed');
      });

      await expect(
        service.processPugSlotCreated('pug-slot-uuid', 42, 'testplayer'),
      ).resolves.not.toThrow();
    });
  });

  describe('handleNewGuildMember', () => {
    it('should do nothing when no pending slots match', async () => {
      // Atomic UPDATE returns empty array — no pending slots matched
      const updateChain = createUpdateChain([]);
      mockDb.update.mockReturnValue(updateChain);

      await service.handleNewGuildMember('user-id', 'newplayer', 'avatar-hash');

      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({
          discordUserId: 'user-id',
          status: 'invited',
        }),
      );
      // No DMs sent since no slots were claimed
      expect(clientService.sendEmbedDM).not.toHaveBeenCalled();
    });

    it('should atomically claim matching pending slots and send DM', async () => {
      const claimedSlot = {
        ...mockPugSlot,
        discordUsername: 'newplayer',
        discordUserId: 'new-user-id',
        discordAvatarHash: 'new-avatar',
        status: 'invited',
      };

      // Atomic UPDATE returns claimed slots
      const updateChain = createUpdateChain([claimedSlot]);
      mockDb.update.mockReturnValue(updateChain);

      // Event verification query
      mockDb.select.mockReturnValue(createSelectChain([mockEvent]));

      await service.handleNewGuildMember(
        'new-user-id',
        'newplayer',
        'new-avatar',
      );

      expect(mockDb.update).toHaveBeenCalled();
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({
          discordUserId: 'new-user-id',
          discordAvatarHash: 'new-avatar',
          status: 'invited',
          serverInviteUrl: null,
        }),
      );

      // Should have sent DM for the claimed slot
      expect(clientService.sendEmbedDM).toHaveBeenCalledWith(
        'new-user-id',
        expect.anything(),
        expect.anything(),
      );
    });

    it('should not send DM for already invited/accepted/claimed slots (atomic guard)', async () => {
      // Atomic UPDATE only matches status = 'pending', so already-processed
      // slots are never returned. Simulate a rejoin where all previous slots
      // have already been processed — UPDATE returns empty.
      const updateChain = createUpdateChain([]);
      mockDb.update.mockReturnValue(updateChain);

      await service.handleNewGuildMember(
        'user-id',
        'returning-player',
        'avatar',
      );

      expect(clientService.sendEmbedDM).not.toHaveBeenCalled();
    });

    it('should skip cancelled events for claimed slots', async () => {
      const claimedSlot = {
        ...mockPugSlot,
        discordUsername: 'newplayer',
        status: 'invited',
      };

      // Atomic UPDATE returns one claimed slot
      const updateChain = createUpdateChain([claimedSlot]);
      mockDb.update.mockReturnValue(updateChain);

      // Event is cancelled
      mockDb.select.mockReturnValue(
        createSelectChain([{ ...mockEvent, cancelledAt: new Date() }]),
      );

      await service.handleNewGuildMember('user-id', 'newplayer', 'avatar');

      // Slot was claimed but DM should not be sent for cancelled event
      expect(clientService.sendEmbedDM).not.toHaveBeenCalled();
    });

    it('should handle DM errors gracefully per slot', async () => {
      const claimedSlot = {
        ...mockPugSlot,
        discordUsername: 'newplayer',
        status: 'invited',
      };

      const updateChain = createUpdateChain([claimedSlot]);
      mockDb.update.mockReturnValue(updateChain);
      mockDb.select.mockReturnValue(createSelectChain([mockEvent]));

      clientService.sendEmbedDM.mockRejectedValue(
        new Error('Cannot send DM to user'),
      );

      await expect(
        service.handleNewGuildMember('user-id', 'newplayer', 'avatar'),
      ).resolves.not.toThrow();
    });

    it('should only send DMs for new pending slots on rejoin, not previously processed ones', async () => {
      // Simulate rejoin scenario: player had 3 slots total
      // - 1 still pending (new event added while they were away)
      // - 2 already invited/accepted (from before they left)
      // The atomic UPDATE only matches pending, so only the new slot is returned
      const newPendingSlot = {
        ...mockPugSlot,
        id: 'new-pending-slot',
        discordUsername: 'returning-player',
        eventId: 99,
        status: 'invited', // status after atomic claim
      };

      const updateChain = createUpdateChain([newPendingSlot]);
      mockDb.update.mockReturnValue(updateChain);

      const newEvent = { ...mockEvent, id: 99, title: 'New Raid' };
      mockDb.select.mockReturnValue(createSelectChain([newEvent]));

      await service.handleNewGuildMember(
        'user-id',
        'returning-player',
        'avatar',
      );

      // Only 1 DM for the new pending slot, not the 2 already processed
      expect(clientService.sendEmbedDM).toHaveBeenCalledTimes(1);
    });
  });

  describe('claimPugSlots', () => {
    it('should update matching unclaimed slots and return count', async () => {
      const claimedSlots = [
        {
          ...mockPugSlot,
          discordUserId: 'disc-123',
          claimedByUserId: 10,
          status: 'claimed',
        },
      ];
      const updateChain = createUpdateChain(claimedSlots);
      mockDb.update.mockReturnValue(updateChain);

      const count = await service.claimPugSlots('disc-123', 10);

      expect(count).toBe(1);
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({
          claimedByUserId: 10,
          status: 'claimed',
        }),
      );
    });

    it('should return 0 when no slots match', async () => {
      const updateChain = createUpdateChain([]);
      mockDb.update.mockReturnValue(updateChain);

      const count = await service.claimPugSlots('disc-no-match', 10);

      expect(count).toBe(0);
    });
  });

  describe('DM embed content', () => {
    /** Helper to set up mocks for the member-found (DM) path.
     *  select call order: 1) event lookup, 2) pug slot verification,
     *  3) re-read slot after update (handleMemberFound) */
    function setupMemberFoundPath() {
      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return createSelectChain([mockEvent]);
        }
        return createSelectChain([mockPugSlot]);
      });

      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);
    }

    it('should include event title, role, and community name in embed', async () => {
      setupMemberFoundPath();

      await service.processPugSlotCreated('pug-slot-uuid', 42, 'testplayer');

      expect(clientService.sendEmbedDM).toHaveBeenCalled();
      const [, embed] = clientService.sendEmbedDM.mock.calls[0];
      const embedData = embed.toJSON();

      expect(embedData.description).toContain('Weekly Raid');
      expect(embedData.footer?.text).toBe('Test Guild');
    });

    it('should include event link when CLIENT_URL is set', async () => {
      setupMemberFoundPath();

      await service.processPugSlotCreated('pug-slot-uuid', 42, 'testplayer');

      const [, embed] = clientService.sendEmbedDM.mock.calls[0];
      const embedData = embed.toJSON();

      expect(embedData.description).toContain(
        'http://localhost:5173/events/42',
      );
    });

    it('should include voice channel link when resolved', async () => {
      setupMemberFoundPath();

      await service.processPugSlotCreated('pug-slot-uuid', 42, 'testplayer');

      const [, embed] = clientService.sendEmbedDM.mock.calls[0];
      const embedData = embed.toJSON();

      const voiceField = embedData.fields?.find(
        (f) => f.name === 'Voice Channel',
      );
      expect(voiceField).toBeDefined();
      expect(voiceField?.value).toBe('<#channel-789>');
    });

    it('should skip voice channel field when no channel resolved', async () => {
      channelResolver.resolveVoiceChannelForEvent.mockResolvedValue(null);
      setupMemberFoundPath();

      await service.processPugSlotCreated('pug-slot-uuid', 42, 'testplayer');

      const [, embed] = clientService.sendEmbedDM.mock.calls[0];
      const embedData = embed.toJSON();

      const voiceField = embedData.fields?.find(
        (f) => f.name === 'Voice Channel',
      );
      expect(voiceField).toBeUndefined();
    });
  });

  describe('server invite generation', () => {
    it('should not update when client is not ready', async () => {
      const mockClientNoReady = {
        isReady: () => false,
        guilds: { cache: { first: () => null } },
      };
      clientService.getClient.mockReturnValue(mockClientNoReady as never);

      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return createSelectChain([mockEvent]);
        }
        return createSelectChain([mockPugSlot]);
      });

      await service.processPugSlotCreated('pug-slot-uuid', 42, 'testplayer');

      expect(clientService.sendEmbedDM).not.toHaveBeenCalled();
      // update should not have been called for invite URL since both paths returned null
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('should fall back to system channel when no default channel', async () => {
      channelResolver.resolveChannelForEvent.mockResolvedValue(null);

      const mockGuild = createMockGuild([]); // empty members -> not in server path
      clientService.getClient.mockReturnValue({
        isReady: () => true,
        guilds: { cache: { first: () => mockGuild } },
      } as never);

      let selectCallCount = 0;
      mockDb.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return createSelectChain([mockEvent]);
        }
        return createSelectChain([mockPugSlot]);
      });

      const updateChain = createUpdateChain();
      mockDb.update.mockReturnValue(updateChain);

      await service.processPugSlotCreated('pug-slot-uuid', 42, 'testplayer');

      // Should have used system channel for the invite
      expect(mockGuild.channels.fetch).toHaveBeenCalledWith('system-channel');
    });
  });
});
