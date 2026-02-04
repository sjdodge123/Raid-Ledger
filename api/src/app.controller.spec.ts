import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DrizzleAsyncProvider } from './drizzle/drizzle.module';

// Mock database for testing
const mockDb = {
  execute: jest.fn().mockResolvedValue([{ '1': 1 }]),
};

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: DrizzleAsyncProvider,
          useValue: mockDb,
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('health', () => {
    it('should return healthy status when database is connected', async () => {
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      await appController.getHealth(mockRes as any);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ok',
          db: expect.objectContaining({ connected: true }),
        }),
      );
    });
  });
});
