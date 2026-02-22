/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { DiscordUserController } from './discord-user.controller';
import { DiscordBotClientService } from './discord-bot-client.service';
import { PugInviteService } from './services/pug-invite.service';

describe('DiscordUserController', () => {
  let controller: DiscordUserController;
  let clientService: jest.Mocked<DiscordBotClientService>;
  let pugInviteService: jest.Mocked<PugInviteService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DiscordUserController],
      providers: [
        {
          provide: DiscordBotClientService,
          useValue: {
            isConnected: jest.fn().mockReturnValue(true),
            getGuildInfo: jest.fn().mockReturnValue({ name: 'Test Guild', memberCount: 42 }),
            isGuildMember: jest.fn().mockResolvedValue(false),
          },
        },
        {
          provide: PugInviteService,
          useValue: {
            generateServerInvite: jest.fn().mockResolvedValue('https://discord.gg/abc123'),
          },
        },
      ],
    }).compile();

    controller = module.get(DiscordUserController);
    clientService = module.get(DiscordBotClientService);
    pugInviteService = module.get(PugInviteService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── GET /discord/server-invite ─────────────────────────────────

  describe('getServerInvite', () => {
    it('should return invite URL and guild name when bot is connected', async () => {
      const result = await controller.getServerInvite();

      expect(result).toEqual({
        url: 'https://discord.gg/abc123',
        guildName: 'Test Guild',
      });
    });

    it('should call generateServerInvite with eventId=0', async () => {
      await controller.getServerInvite();

      expect(pugInviteService.generateServerInvite).toHaveBeenCalledWith(0);
    });

    it('should return null url and guildName when bot is not connected', async () => {
      clientService.isConnected.mockReturnValue(false);

      const result = await controller.getServerInvite();

      expect(result).toEqual({ url: null, guildName: null });
      expect(pugInviteService.generateServerInvite).not.toHaveBeenCalled();
    });

    it('should return null guildName when getGuildInfo returns null', async () => {
      clientService.getGuildInfo.mockReturnValue(null);
      pugInviteService.generateServerInvite.mockResolvedValue('https://discord.gg/abc123');

      const result = await controller.getServerInvite();

      expect(result.guildName).toBeNull();
      expect(result.url).toBe('https://discord.gg/abc123');
    });

    it('should return null url when generateServerInvite returns null', async () => {
      pugInviteService.generateServerInvite.mockResolvedValue(null);

      const result = await controller.getServerInvite();

      expect(result.url).toBeNull();
      expect(result.guildName).toBe('Test Guild');
    });

    it('should not call getGuildInfo when bot is not connected', async () => {
      clientService.isConnected.mockReturnValue(false);

      await controller.getServerInvite();

      expect(clientService.getGuildInfo).not.toHaveBeenCalled();
    });
  });

  // ── GET /discord/guild-membership ─────────────────────────────

  describe('checkGuildMembership', () => {
    const makeReq = (discordId: string) => ({ user: { discordId } });

    it('should return isMember=true when user is in the guild', async () => {
      clientService.isGuildMember.mockResolvedValue(true);

      const result = await controller.checkGuildMembership(makeReq('123456789'));

      expect(result).toEqual({ isMember: true });
      expect(clientService.isGuildMember).toHaveBeenCalledWith('123456789');
    });

    it('should return isMember=false when user is not in the guild', async () => {
      clientService.isGuildMember.mockResolvedValue(false);

      const result = await controller.checkGuildMembership(makeReq('987654321'));

      expect(result).toEqual({ isMember: false });
    });

    it('should return isMember=false when discordId is empty string', async () => {
      const result = await controller.checkGuildMembership(makeReq(''));

      expect(result).toEqual({ isMember: false });
      expect(clientService.isGuildMember).not.toHaveBeenCalled();
    });

    it('should return isMember=false when discordId starts with "local:"', async () => {
      const result = await controller.checkGuildMembership(makeReq('local:someuser'));

      expect(result).toEqual({ isMember: false });
      expect(clientService.isGuildMember).not.toHaveBeenCalled();
    });

    it('should return isMember=false when discordId starts with "unlinked:"', async () => {
      const result = await controller.checkGuildMembership(makeReq('unlinked:abc'));

      expect(result).toEqual({ isMember: false });
      expect(clientService.isGuildMember).not.toHaveBeenCalled();
    });

    it('should return isMember=false when bot is not connected', async () => {
      clientService.isConnected.mockReturnValue(false);

      const result = await controller.checkGuildMembership(makeReq('123456789'));

      expect(result).toEqual({ isMember: false });
      expect(clientService.isGuildMember).not.toHaveBeenCalled();
    });

    it('should return isMember=false when user has no discordId (undefined)', async () => {
      const result = await controller.checkGuildMembership({
        user: { discordId: undefined as unknown as string },
      });

      expect(result).toEqual({ isMember: false });
      expect(clientService.isGuildMember).not.toHaveBeenCalled();
    });

    it('should return isMember=false when user has null discordId', async () => {
      const result = await controller.checkGuildMembership({
        user: { discordId: null as unknown as string },
      });

      expect(result).toEqual({ isMember: false });
      expect(clientService.isGuildMember).not.toHaveBeenCalled();
    });

    it('should check guild membership for real (non-local) Discord IDs', async () => {
      clientService.isGuildMember.mockResolvedValue(true);

      await controller.checkGuildMembership(makeReq('543210987654321098'));

      expect(clientService.isGuildMember).toHaveBeenCalledWith('543210987654321098');
    });
  });
});
