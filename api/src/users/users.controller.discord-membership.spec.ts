import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { AvatarService } from './avatar.service';
import { PreferencesService } from './preferences.service';
import { GameTimeService } from './game-time.service';
import { CharactersService } from '../characters/characters.service';
import { EventsService } from '../events/events.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { ChannelResolverService } from '../discord-bot/services/channel-resolver.service';
import { DiscordMembershipResponseSchema } from '@raid-ledger/contract';

describe('UsersController — getDiscordMembership (ROK-425)', () => {
  let controller: UsersController;
  let usersService: UsersService;
  let discordBotClientService: DiscordBotClientService;
  let channelResolver: ChannelResolverService;

  const mockUser = {
    id: 1,
    username: 'testuser',
    avatar: null,
    discordId: '123456789',
    displayName: null,
    customAvatarUrl: null,
    role: 'member',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockGuildInfo = {
    name: 'Test Guild',
    memberCount: 100,
  };

  // A minimal mock guild member object returned by guild.members.fetch
  const mockMember = { id: '123456789' };

  // Mock guild with members.fetch
  const makeMockGuild = (fetchResult: 'found' | 'notFound' = 'found') => ({
    id: 'guild-id',
    name: 'Test Guild',
    systemChannelId: 'sys-channel-id',
    channels: {
      cache: {
        find: jest.fn(),
        first: jest.fn(),
      },
      fetch: jest.fn(),
    },
    members: {
      fetch: jest.fn().mockImplementation(() => {
        if (fetchResult === 'found') return Promise.resolve(mockMember);
        return Promise.reject(new Error('Unknown Member'));
      }),
    },
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        {
          provide: UsersService,
          useValue: {
            findById: jest.fn(),
            findRecent: jest.fn(),
            findAll: jest.fn(),
            getHeartedGames: jest.fn(),
            unlinkDiscord: jest.fn(),
            setCustomAvatar: jest.fn(),
            findAllWithRoles: jest.fn(),
            setRole: jest.fn(),
            checkDisplayNameAvailability: jest.fn(),
            setDisplayName: jest.fn(),
            completeOnboarding: jest.fn(),
            resetOnboarding: jest.fn(),
            findAdmin: jest.fn(),
            deleteUser: jest.fn(),
          },
        },
        {
          provide: AvatarService,
          useValue: {
            checkRateLimit: jest.fn(),
            validateAndProcess: jest.fn(),
            save: jest.fn(),
            delete: jest.fn(),
          },
        },
        {
          provide: PreferencesService,
          useValue: {
            getUserPreferences: jest.fn(),
            setUserPreference: jest.fn(),
          },
        },
        {
          provide: GameTimeService,
          useValue: {
            getCompositeView: jest.fn(),
            saveTemplate: jest.fn(),
            saveOverrides: jest.fn(),
            createAbsence: jest.fn(),
            deleteAbsence: jest.fn(),
            getAbsences: jest.fn(),
          },
        },
        {
          provide: CharactersService,
          useValue: {
            findAllForUser: jest.fn(),
          },
        },
        {
          provide: EventsService,
          useValue: {
            findUpcomingByUser: jest.fn(),
          },
        },
        {
          provide: DiscordBotClientService,
          useValue: {
            isConnected: jest.fn(),
            getGuildInfo: jest.fn(),
            getClient: jest.fn(),
          },
        },
        {
          provide: ChannelResolverService,
          useValue: {
            resolveChannelForEvent: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<UsersController>(UsersController);
    usersService = module.get<UsersService>(UsersService);
    discordBotClientService = module.get<DiscordBotClientService>(
      DiscordBotClientService,
    );
    channelResolver = module.get<ChannelResolverService>(ChannelResolverService);
  });

  const mockRequest = { user: { id: 1, role: 'member' } };

  describe('when bot is offline / not connected', () => {
    it('returns botConnected: false when isConnected() is false', async () => {
      (discordBotClientService.isConnected as jest.Mock).mockReturnValue(false);

      const result = await controller.getDiscordMembership(mockRequest as never);

      expect(result).toEqual({ botConnected: false });
    });

    it('returns botConnected: false when guild info is null (bot up but no guild)', async () => {
      (discordBotClientService.isConnected as jest.Mock).mockReturnValue(true);
      (discordBotClientService.getGuildInfo as jest.Mock).mockReturnValue(null);

      const result = await controller.getDiscordMembership(mockRequest as never);

      expect(result).toEqual({ botConnected: false });
    });

    it('returns botConnected: false when getClient() returns null', async () => {
      (discordBotClientService.isConnected as jest.Mock).mockReturnValue(true);
      (discordBotClientService.getGuildInfo as jest.Mock).mockReturnValue(
        mockGuildInfo,
      );
      (usersService.findById as jest.Mock).mockResolvedValue(mockUser);
      (discordBotClientService.getClient as jest.Mock).mockReturnValue(null);

      const result = await controller.getDiscordMembership(mockRequest as never);

      expect(result).toEqual({ botConnected: false });
    });

    it('returns botConnected: false when client has no guilds in cache', async () => {
      (discordBotClientService.isConnected as jest.Mock).mockReturnValue(true);
      (discordBotClientService.getGuildInfo as jest.Mock).mockReturnValue(
        mockGuildInfo,
      );
      (usersService.findById as jest.Mock).mockResolvedValue(mockUser);
      (discordBotClientService.getClient as jest.Mock).mockReturnValue({
        guilds: { cache: { first: jest.fn().mockReturnValue(null) } },
      });

      const result = await controller.getDiscordMembership(mockRequest as never);

      expect(result).toEqual({ botConnected: false });
    });
  });

  describe('when user has no linked Discord account', () => {
    beforeEach(() => {
      (discordBotClientService.isConnected as jest.Mock).mockReturnValue(true);
      (discordBotClientService.getGuildInfo as jest.Mock).mockReturnValue(
        mockGuildInfo,
      );
    });

    it('returns isMember: false for user without discordId', async () => {
      const userWithoutDiscord = { ...mockUser, discordId: null };
      (usersService.findById as jest.Mock).mockResolvedValue(userWithoutDiscord);

      const result = await controller.getDiscordMembership(mockRequest as never);

      expect(result).toEqual({
        botConnected: true,
        guildName: 'Test Guild',
        isMember: false,
      });
    });

    it('returns isMember: false for local-only user (discordId starts with "local:")', async () => {
      const localUser = { ...mockUser, discordId: 'local:testuser' };
      (usersService.findById as jest.Mock).mockResolvedValue(localUser);

      const result = await controller.getDiscordMembership(mockRequest as never);

      expect(result).toEqual({
        botConnected: true,
        guildName: 'Test Guild',
        isMember: false,
      });
    });

    it('returns isMember: false for unlinked user (discordId starts with "unlinked:")', async () => {
      const unlinkedUser = { ...mockUser, discordId: 'unlinked:12345' };
      (usersService.findById as jest.Mock).mockResolvedValue(unlinkedUser);

      const result = await controller.getDiscordMembership(mockRequest as never);

      expect(result).toEqual({
        botConnected: true,
        guildName: 'Test Guild',
        isMember: false,
      });
    });

    it('does not attempt guild member lookup for non-Discord users', async () => {
      const localUser = { ...mockUser, discordId: 'local:x' };
      (usersService.findById as jest.Mock).mockResolvedValue(localUser);
      const getClientSpy = jest.spyOn(discordBotClientService, 'getClient');

      await controller.getDiscordMembership(mockRequest as never);

      expect(getClientSpy).not.toHaveBeenCalled();
    });
  });

  describe('when user IS a member of the guild', () => {
    it('returns isMember: true when guild.members.fetch succeeds', async () => {
      const guild = makeMockGuild('found');
      (discordBotClientService.isConnected as jest.Mock).mockReturnValue(true);
      (discordBotClientService.getGuildInfo as jest.Mock).mockReturnValue(
        mockGuildInfo,
      );
      (usersService.findById as jest.Mock).mockResolvedValue(mockUser);
      (discordBotClientService.getClient as jest.Mock).mockReturnValue({
        guilds: { cache: { first: jest.fn().mockReturnValue(guild) } },
      });

      const result = await controller.getDiscordMembership(mockRequest as never);

      expect(result).toEqual({
        botConnected: true,
        guildName: 'Test Guild',
        isMember: true,
      });
      expect(guild.members.fetch).toHaveBeenCalledWith('123456789');
    });

    it('does not include inviteUrl when user is already a member', async () => {
      const guild = makeMockGuild('found');
      (discordBotClientService.isConnected as jest.Mock).mockReturnValue(true);
      (discordBotClientService.getGuildInfo as jest.Mock).mockReturnValue(
        mockGuildInfo,
      );
      (usersService.findById as jest.Mock).mockResolvedValue(mockUser);
      (discordBotClientService.getClient as jest.Mock).mockReturnValue({
        guilds: { cache: { first: jest.fn().mockReturnValue(guild) } },
      });

      const result = await controller.getDiscordMembership(mockRequest as never);

      expect(result.inviteUrl).toBeUndefined();
    });
  });

  describe('when user is NOT a member of the guild', () => {
    let guild: ReturnType<typeof makeMockGuild>;

    beforeEach(() => {
      guild = makeMockGuild('notFound');
      (discordBotClientService.isConnected as jest.Mock).mockReturnValue(true);
      (discordBotClientService.getGuildInfo as jest.Mock).mockReturnValue(
        mockGuildInfo,
      );
      (usersService.findById as jest.Mock).mockResolvedValue(mockUser);
      (discordBotClientService.getClient as jest.Mock).mockReturnValue({
        guilds: { cache: { first: jest.fn().mockReturnValue(guild) } },
      });
    });

    it('returns isMember: false when guild.members.fetch throws (user not found)', async () => {
      // channelResolver returns null → no invite generated
      (channelResolver.resolveChannelForEvent as jest.Mock).mockResolvedValue(
        null,
      );
      guild.systemChannelId = null as unknown as string;
      guild.channels.cache.find = jest.fn().mockReturnValue(undefined);

      const result = await controller.getDiscordMembership(mockRequest as never);

      expect(result.isMember).toBe(false);
      expect(result.botConnected).toBe(true);
      expect(result.guildName).toBe('Test Guild');
    });

    it('includes inviteUrl when a channel can be resolved', async () => {
      const mockChannel = {
        id: 'channel-id',
        isTextBased: () => true,
        isThread: () => false,
        isDMBased: () => false,
        createInvite: jest
          .fn()
          .mockResolvedValue({ url: 'https://discord.gg/invite123' }),
      };

      (channelResolver.resolveChannelForEvent as jest.Mock).mockResolvedValue(
        'channel-id',
      );
      guild.channels.fetch = jest.fn().mockResolvedValue(mockChannel);

      const result = await controller.getDiscordMembership(mockRequest as never);

      expect(result.inviteUrl).toBe('https://discord.gg/invite123');
    });

    it('returns inviteUrl: undefined when no channel is found for invite', async () => {
      (channelResolver.resolveChannelForEvent as jest.Mock).mockResolvedValue(
        null,
      );
      // No system channel and no text channels
      guild.systemChannelId = null as unknown as string;
      guild.channels.cache.find = jest.fn().mockReturnValue(undefined);

      const result = await controller.getDiscordMembership(mockRequest as never);

      expect(result.inviteUrl).toBeUndefined();
    });

    it('falls back to systemChannelId when channelResolver returns null', async () => {
      const mockChannel = {
        id: 'sys-channel-id',
        isTextBased: () => true,
        isThread: () => false,
        isDMBased: () => false,
        createInvite: jest
          .fn()
          .mockResolvedValue({ url: 'https://discord.gg/sys-invite' }),
      };

      (channelResolver.resolveChannelForEvent as jest.Mock).mockResolvedValue(
        null,
      );
      guild.systemChannelId = 'sys-channel-id';
      guild.channels.fetch = jest.fn().mockResolvedValue(mockChannel);

      const result = await controller.getDiscordMembership(mockRequest as never);

      expect(result.inviteUrl).toBe('https://discord.gg/sys-invite');
    });

    it('falls back to first text channel when resolver and systemChannel are both null', async () => {
      const mockChannel = {
        id: 'first-text-id',
        isTextBased: () => true,
        isThread: () => false,
        isDMBased: () => false,
        createInvite: jest
          .fn()
          .mockResolvedValue({ url: 'https://discord.gg/first-text' }),
      };

      (channelResolver.resolveChannelForEvent as jest.Mock).mockResolvedValue(
        null,
      );
      guild.systemChannelId = null as unknown as string;
      guild.channels.cache.find = jest
        .fn()
        .mockReturnValue({ id: 'first-text-id' });
      guild.channels.fetch = jest.fn().mockResolvedValue(mockChannel);

      const result = await controller.getDiscordMembership(mockRequest as never);

      expect(result.inviteUrl).toBe('https://discord.gg/first-text');
    });

    it('returns inviteUrl: undefined when channel.createInvite is not available', async () => {
      const mockChannelNoInvite = {
        id: 'channel-id',
        // no createInvite
      };

      (channelResolver.resolveChannelForEvent as jest.Mock).mockResolvedValue(
        'channel-id',
      );
      guild.channels.fetch = jest
        .fn()
        .mockResolvedValue(mockChannelNoInvite);

      const result = await controller.getDiscordMembership(mockRequest as never);

      expect(result.inviteUrl).toBeUndefined();
    });

    it('handles createInvite throwing and returns inviteUrl: undefined gracefully', async () => {
      const mockChannel = {
        id: 'channel-id',
        isTextBased: () => true,
        isThread: () => false,
        isDMBased: () => false,
        createInvite: jest.fn().mockRejectedValue(new Error('Missing Permissions')),
      };

      (channelResolver.resolveChannelForEvent as jest.Mock).mockResolvedValue(
        'channel-id',
      );
      guild.channels.fetch = jest.fn().mockResolvedValue(mockChannel);

      const result = await controller.getDiscordMembership(mockRequest as never);

      expect(result.inviteUrl).toBeUndefined();
    });
  });

  describe('response schema validation', () => {
    it('validates botConnected: false response against schema', async () => {
      (discordBotClientService.isConnected as jest.Mock).mockReturnValue(false);

      const result = await controller.getDiscordMembership(mockRequest as never);

      const parseResult = DiscordMembershipResponseSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('validates member response against schema', async () => {
      const guild = makeMockGuild('found');
      (discordBotClientService.isConnected as jest.Mock).mockReturnValue(true);
      (discordBotClientService.getGuildInfo as jest.Mock).mockReturnValue(
        mockGuildInfo,
      );
      (usersService.findById as jest.Mock).mockResolvedValue(mockUser);
      (discordBotClientService.getClient as jest.Mock).mockReturnValue({
        guilds: { cache: { first: jest.fn().mockReturnValue(guild) } },
      });

      const result = await controller.getDiscordMembership(mockRequest as never);

      const parseResult = DiscordMembershipResponseSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it('validates non-member response with inviteUrl against schema', async () => {
      const guild = makeMockGuild('notFound');
      const mockChannel = {
        id: 'channel-id',
        isTextBased: () => true,
        isThread: () => false,
        isDMBased: () => false,
        createInvite: jest
          .fn()
          .mockResolvedValue({ url: 'https://discord.gg/invite123' }),
      };

      (discordBotClientService.isConnected as jest.Mock).mockReturnValue(true);
      (discordBotClientService.getGuildInfo as jest.Mock).mockReturnValue(
        mockGuildInfo,
      );
      (usersService.findById as jest.Mock).mockResolvedValue(mockUser);
      (discordBotClientService.getClient as jest.Mock).mockReturnValue({
        guilds: { cache: { first: jest.fn().mockReturnValue(guild) } },
      });
      (channelResolver.resolveChannelForEvent as jest.Mock).mockResolvedValue(
        'channel-id',
      );
      guild.channels.fetch = jest.fn().mockResolvedValue(mockChannel);

      const result = await controller.getDiscordMembership(mockRequest as never);

      const parseResult = DiscordMembershipResponseSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });
  });
});
