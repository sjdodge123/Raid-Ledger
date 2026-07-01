import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DrizzleAsyncProvider } from './drizzle/drizzle.module';
import { REDIS_CLIENT } from './redis/redis.module';

// Mock database for testing
const mockDb = {
  execute: jest.fn().mockResolvedValue([{ '1': 1 }]),
};

// Mock Redis client for testing
const mockRedis = {
  ping: jest.fn().mockResolvedValue('PONG'),
};

function describeAppController() {
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
        {
          provide: REDIS_CLIENT,
          useValue: mockRedis,
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

  function describeHealth() {
    it('should return healthy status when database and redis are connected', async () => {
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      await appController.getHealth(
        mockRes as unknown as import('express').Response,
      );

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ok',
          db: expect.objectContaining({ connected: true }) as unknown,
          redis: expect.objectContaining({ connected: true }) as unknown,
        }),
      );
    });

    it('should return 503 when Redis is down but DB is up', async () => {
      mockRedis.ping.mockRejectedValueOnce(
        new Error('Redis connection refused'),
      );

      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      await appController.getHealth(
        mockRes as unknown as import('express').Response,
      );

      expect(mockRes.status).toHaveBeenCalledWith(503);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'unhealthy',
          db: expect.objectContaining({ connected: true }) as unknown,
          redis: expect.objectContaining({ connected: false }) as unknown,
        }),
      );
    });

    it('should return 503 when DB is down but Redis is up', async () => {
      mockDb.execute.mockRejectedValueOnce(new Error('DB connection refused'));

      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      await appController.getHealth(
        mockRes as unknown as import('express').Response,
      );

      expect(mockRes.status).toHaveBeenCalledWith(503);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'unhealthy',
          db: expect.objectContaining({ connected: false }) as unknown,
          redis: expect.objectContaining({ connected: true }) as unknown,
        }),
      );
    });

    it('should return 503 when both DB and Redis are down', async () => {
      mockDb.execute.mockRejectedValueOnce(new Error('DB connection refused'));
      mockRedis.ping.mockRejectedValueOnce(
        new Error('Redis connection refused'),
      );

      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      await appController.getHealth(
        mockRes as unknown as import('express').Response,
      );

      expect(mockRes.status).toHaveBeenCalledWith(503);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'unhealthy',
          db: expect.objectContaining({ connected: false }) as unknown,
          redis: expect.objectContaining({ connected: false }) as unknown,
        }),
      );
    });

    it('should include redis latencyMs in the response', async () => {
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      await appController.getHealth(
        mockRes as unknown as import('express').Response,
      );

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          redis: expect.objectContaining({
            latencyMs: expect.any(Number) as number,
          }) as unknown,
        }),
      );
    });

    it('should include db latencyMs in the response', async () => {
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      await appController.getHealth(
        mockRes as unknown as import('express').Response,
      );

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          db: expect.objectContaining({
            latencyMs: expect.any(Number) as number,
          }) as unknown,
        }),
      );
    });

    it('should include a timestamp in the response', async () => {
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      await appController.getHealth(
        mockRes as unknown as import('express').Response,
      );

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(String) as string,
        }),
      );
    });
  }
  describe('health', () => describeHealth());

  function describeLive() {
    it('returns { status: "ok" } synchronously', () => {
      expect(appController.getLive()).toEqual({ status: 'ok' });
    });

    it('touches neither the database nor Redis', () => {
      mockDb.execute.mockClear();
      mockRedis.ping.mockClear();

      appController.getLive();

      expect(mockDb.execute).not.toHaveBeenCalled();
      expect(mockRedis.ping).not.toHaveBeenCalled();
    });
  }
  describe('health/live', () => describeLive());

  function describeReady() {
    it('returns 200 + ok when DB and Redis are connected', async () => {
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      await appController.getReady(
        mockRes as unknown as import('express').Response,
      );

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ok',
          db: expect.objectContaining({ connected: true }) as unknown,
          redis: expect.objectContaining({ connected: true }) as unknown,
        }),
      );
    });

    it('returns 503 when a dependency is down (readiness semantics)', async () => {
      mockRedis.ping.mockRejectedValueOnce(new Error('Redis down'));
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };

      await appController.getReady(
        mockRes as unknown as import('express').Response,
      );

      expect(mockRes.status).toHaveBeenCalledWith(503);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'unhealthy',
          redis: expect.objectContaining({ connected: false }) as unknown,
        }),
      );
    });
  }
  describe('health/ready', () => describeReady());
}
describe('AppController', () => describeAppController());
