import { Test, TestingModule } from '@nestjs/testing';
import { SystemController } from './system.controller';
import { UsersService } from '../users/users.service';

describe('SystemController', () => {
    let controller: SystemController;
    let mockUsersService: Partial<UsersService>;

    beforeEach(async () => {
        mockUsersService = {
            count: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            controllers: [SystemController],
            providers: [{ provide: UsersService, useValue: mockUsersService }],
        }).compile();

        controller = module.get<SystemController>(SystemController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('getStatus', () => {
        it('should return isFirstRun: true when no users exist (AC-4)', async () => {
            (mockUsersService.count as jest.Mock).mockResolvedValue(0);

            const result = await controller.getStatus();

            expect(result.isFirstRun).toBe(true);
            expect(mockUsersService.count).toHaveBeenCalled();
        });

        it('should return isFirstRun: false when users exist (AC-4)', async () => {
            (mockUsersService.count as jest.Mock).mockResolvedValue(5);

            const result = await controller.getStatus();

            expect(result.isFirstRun).toBe(false);
            expect(mockUsersService.count).toHaveBeenCalled();
        });

        it('should return discordConfigured based on env vars (AC-4)', async () => {
            (mockUsersService.count as jest.Mock).mockResolvedValue(0);

            // Save original env
            const originalClientId = process.env.DISCORD_CLIENT_ID;
            const originalClientSecret = process.env.DISCORD_CLIENT_SECRET;

            // Test when Discord is configured
            process.env.DISCORD_CLIENT_ID = 'test-client-id';
            process.env.DISCORD_CLIENT_SECRET = 'test-client-secret';
            let result = await controller.getStatus();
            expect(result.discordConfigured).toBe(true);

            // Test when Discord is not configured
            delete process.env.DISCORD_CLIENT_ID;
            delete process.env.DISCORD_CLIENT_SECRET;
            result = await controller.getStatus();
            expect(result.discordConfigured).toBe(false);

            // Restore original env
            if (originalClientId) process.env.DISCORD_CLIENT_ID = originalClientId;
            else delete process.env.DISCORD_CLIENT_ID;
            if (originalClientSecret)
                process.env.DISCORD_CLIENT_SECRET = originalClientSecret;
            else delete process.env.DISCORD_CLIENT_SECRET;
        });
    });
});
