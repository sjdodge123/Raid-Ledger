/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { PugInviteListener } from './pug-invite.listener';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { PugInviteService } from '../services/pug-invite.service';
import { CharactersService } from '../../characters/characters.service';
import { SignupsService } from '../../events/signups.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import type { PugSlotCreatedPayload } from '../../events/pugs.service';
import type { DiscordLoginPayload } from '../../auth/auth.service';
import { Events } from 'discord.js';

describe('PugInviteListener', () => {
  let module: TestingModule;
  let listener: PugInviteListener;
  let clientService: jest.Mocked<DiscordBotClientService>;
  let pugInviteService: jest.Mocked<PugInviteService>;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        PugInviteListener,
        {
          provide: DrizzleAsyncProvider,
          useValue: {
            select: jest.fn().mockReturnThis(),
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockResolvedValue([]),
            update: jest.fn().mockReturnThis(),
            set: jest.fn().mockReturnThis(),
            delete: jest.fn().mockReturnThis(),
          },
        },
        {
          provide: DiscordBotClientService,
          useValue: {
            getClient: jest.fn().mockReturnValue(null),
          },
        },
        {
          provide: PugInviteService,
          useValue: {
            processPugSlotCreated: jest.fn().mockResolvedValue(undefined),
            handleNewGuildMember: jest.fn().mockResolvedValue(undefined),
            claimPugSlots: jest.fn().mockResolvedValue(0),
            sendMemberInviteDm: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: CharactersService,
          useValue: {
            findAllForUser: jest.fn().mockResolvedValue({ data: [] }),
            findOne: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: SignupsService,
          useValue: {
            signup: jest.fn().mockResolvedValue({ id: 1 }),
            confirmSignup: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    listener = module.get(PugInviteListener);
    clientService = module.get(DiscordBotClientService);
    pugInviteService = module.get(PugInviteService);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await module.close();
  });

  describe('handlePugSlotCreated', () => {
    it('should call processPugSlotCreated with correct payload', async () => {
      const payload: PugSlotCreatedPayload = {
        pugSlotId: 'slot-uuid',
        eventId: 42,
        discordUsername: 'testplayer',
        creatorUserId: 1,
      };

      await listener.handlePugSlotCreated(payload);

      expect(pugInviteService.processPugSlotCreated).toHaveBeenCalledWith(
        'slot-uuid',
        42,
        'testplayer',
        1,
      );
    });
  });

  describe('handleDiscordLogin', () => {
    it('should call claimPugSlots with discord ID and user ID', async () => {
      const payload: DiscordLoginPayload = {
        userId: 10,
        discordId: 'disc-user-456',
      };

      await listener.handleDiscordLogin(payload);

      expect(pugInviteService.claimPugSlots).toHaveBeenCalledWith(
        'disc-user-456',
        10,
      );
    });

    it('should handle claim errors gracefully', async () => {
      pugInviteService.claimPugSlots.mockRejectedValue(
        new Error('DB error'),
      );

      const payload: DiscordLoginPayload = {
        userId: 10,
        discordId: 'disc-user-456',
      };

      await expect(
        listener.handleDiscordLogin(payload),
      ).resolves.not.toThrow();
    });
  });

  describe('handleBotConnected', () => {
    it('should register guildMemberAdd and interactionCreate listeners on the client', () => {
      const mockOn = jest.fn();
      const mockRemoveListener = jest.fn();
      const mockClient = { on: mockOn, removeListener: mockRemoveListener };
      clientService.getClient.mockReturnValue(mockClient as never);

      listener.handleBotConnected();

      expect(mockOn).toHaveBeenCalledWith(
        Events.GuildMemberAdd,
        expect.any(Function),
      );
      expect(mockOn).toHaveBeenCalledWith(
        'interactionCreate',
        expect.any(Function),
      );
    });

    it('should not register guildMemberAdd twice on repeated connect events', () => {
      const mockOn = jest.fn();
      const mockRemoveListener = jest.fn();
      const mockClient = { on: mockOn, removeListener: mockRemoveListener };
      clientService.getClient.mockReturnValue(mockClient as never);

      listener.handleBotConnected();
      listener.handleBotConnected();

      // guildMemberAdd registered once, interactionCreate re-registered each time
      const guildMemberCalls = mockOn.mock.calls.filter(
        ([event]: [string]) => event === Events.GuildMemberAdd,
      );
      expect(guildMemberCalls).toHaveLength(1);
    });

    it('should skip when client is null', () => {
      clientService.getClient.mockReturnValue(null);

      listener.handleBotConnected();

      // No error thrown, no listener registered
      expect(clientService.getClient).toHaveBeenCalled();
    });

    it('should call handleNewGuildMember when guildMemberAdd fires', async () => {
      const mockOn = jest.fn();
      const mockRemoveListener = jest.fn();
      const mockClient = { on: mockOn, removeListener: mockRemoveListener };
      clientService.getClient.mockReturnValue(mockClient as never);

      listener.handleBotConnected();

      // Get the callback registered on guildMemberAdd
      const guildMemberCall = mockOn.mock.calls.find(
        ([event]: [string]) => event === Events.GuildMemberAdd,
      );
      const [, callback] = guildMemberCall as [string, (member: unknown) => Promise<void>];
      const mockMember = {
        user: {
          id: 'new-user-id',
          username: 'newplayer',
          avatar: 'avatar-hash-xyz',
        },
      };

      await callback(mockMember);

      expect(pugInviteService.handleNewGuildMember).toHaveBeenCalledWith(
        'new-user-id',
        'newplayer',
        'avatar-hash-xyz',
      );
    });
  });

  describe('handleBotDisconnected', () => {
    it('should allow guildMemberAdd re-registration after disconnect', () => {
      const mockOn = jest.fn();
      const mockRemoveListener = jest.fn();
      const mockClient = { on: mockOn, removeListener: mockRemoveListener };
      clientService.getClient.mockReturnValue(mockClient as never);

      listener.handleBotConnected();
      listener.handleBotDisconnected();
      listener.handleBotConnected();

      // guildMemberAdd should be registered twice (once per connect after disconnect reset)
      const guildMemberCalls = mockOn.mock.calls.filter(
        ([event]: [string]) => event === Events.GuildMemberAdd,
      );
      expect(guildMemberCalls).toHaveLength(2);
    });

    it('should clear boundInteractionHandler reference on disconnect', () => {
      const mockOn = jest.fn();
      const mockRemoveListener = jest.fn();
      const mockClient = { on: mockOn, removeListener: mockRemoveListener };
      clientService.getClient.mockReturnValue(mockClient as never);

      listener.handleBotConnected();
      // After connect, boundInteractionHandler is set — simulate disconnect
      listener.handleBotDisconnected();

      // On next connect, should NOT try to remove a stale handler from the new client
      listener.handleBotConnected();

      // removeListener should NOT be called because boundInteractionHandler was cleared
      expect(mockRemoveListener).not.toHaveBeenCalled();
    });
  });

  describe('handleMemberInviteCreated', () => {
    it('should delegate to pugInviteService.sendMemberInviteDm', async () => {
      const payload = {
        eventId: 42,
        targetDiscordId: 'discord-user-789',
        notificationId: 'notif-uuid',
        gameId: null,
      };

      await listener.handleMemberInviteCreated(payload);

      expect(pugInviteService.sendMemberInviteDm).toHaveBeenCalledWith(
        42,
        'discord-user-789',
        'notif-uuid',
        null,
      );
    });
  });
});
