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
    const dbHealth = await this.appService.checkDatabaseHealth();

    const health = {
      status: dbHealth.connected ? 'ok' : 'unhealthy',
      timestamp: new Date().toISOString(),
      db: {
        connected: dbHealth.connected,
        latencyMs: dbHealth.latencyMs,
      },
    };

    res.status(dbHealth.connected ? 200 : 503).json(health);
  }
}
