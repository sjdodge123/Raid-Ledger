import { Controller, Get, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @SkipThrottle()
  @Get('health')
  async getHealth(@Res() res: Response): Promise<void> {
    const [dbHealth, redisHealth] = await Promise.all([
      this.appService.checkDatabaseHealth(),
      this.appService.checkRedisHealth(),
    ]);

    const allHealthy = dbHealth.connected && redisHealth.connected;

    const health = {
      status: allHealthy ? 'ok' : 'unhealthy',
      timestamp: new Date().toISOString(),
      db: {
        connected: dbHealth.connected,
        latencyMs: dbHealth.latencyMs,
      },
      redis: {
        connected: redisHealth.connected,
        latencyMs: redisHealth.latencyMs,
      },
    };

    res.status(allHealthy ? 200 : 503).json(health);
  }
}
