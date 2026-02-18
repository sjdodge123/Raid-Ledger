/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { MagicLinkService } from './magic-link.service';
import { UsersService } from '../users/users.service';

describe('MagicLinkService', () => {
  let service: MagicLinkService;
  let jwtService: JwtService;
  let usersService: UsersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MagicLinkService,
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('mock-jwt-token'),
          },
        },
        {
          provide: UsersService,
          useValue: {
            findById: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<MagicLinkService>(MagicLinkService);
    jwtService = module.get<JwtService>(JwtService);
    usersService = module.get<UsersService>(UsersService);
  });

  describe('generateLink', () => {
    it('should generate a magic link for a valid user', async () => {
      const mockUser = {
        id: 1,
        username: 'testuser',
        role: 'member' as const,
      };
      (usersService.findById as jest.Mock).mockResolvedValue(mockUser);

      const result = await service.generateLink(
        1,
        '/events/42/edit',
        'http://localhost:5173',
      );

      expect(result).toBe(
        'http://localhost:5173/events/42/edit?token=mock-jwt-token',
      );
      expect(jwtService.sign).toHaveBeenCalledWith(
        {
          sub: 1,
          username: 'testuser',
          role: 'member',
          magicLink: true,
        },
        { expiresIn: '15m' },
      );
    });

    it('should return null if user not found', async () => {
      (usersService.findById as jest.Mock).mockResolvedValue(null);

      const result = await service.generateLink(
        999,
        '/events/42/edit',
        'http://localhost:5173',
      );

      expect(result).toBeNull();
      expect(jwtService.sign).not.toHaveBeenCalled();
    });

    it('should handle paths with leading slashes correctly', async () => {
      const mockUser = {
        id: 2,
        username: 'admin',
        role: 'admin' as const,
      };
      (usersService.findById as jest.Mock).mockResolvedValue(mockUser);

      const result = await service.generateLink(
        2,
        '/events/100/edit',
        'https://raidledger.com',
      );

      expect(result).toBe(
        'https://raidledger.com/events/100/edit?token=mock-jwt-token',
      );
    });
  });
});
