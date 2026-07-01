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

  /**
   * Liveness probe (ROK-1165). Touches NO external dependencies and returns
   * immediately. Docker/nginx liveness polling (~every 30s) targets this so it
   * no longer runs `SELECT 1` + Redis PING on every check.
   */
  @SkipThrottle()
  @Get('health/live')
  getLive(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /**
   * Readiness probe (ROK-1165). Retains the DB + Redis dependency check —
   * same semantics the legacy `/health` endpoint has always had.
   */
  @SkipThrottle()
  @Get('health/ready')
  async getReady(@Res() res: Response): Promise<void> {
    await this.respondWithHealth(res);
  }

  /**
   * @deprecated Use `/health/live` for liveness and `/health/ready` for
   * readiness (ROK-1165). Retained unchanged for backward compatibility; still
   * performs the full DB + Redis probe on every request.
   */
  @SkipThrottle()
  @Get('health')
  async getHealth(@Res() res: Response): Promise<void> {
    await this.respondWithHealth(res);
  }

  private async respondWithHealth(res: Response): Promise<void> {
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
