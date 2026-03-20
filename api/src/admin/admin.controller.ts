import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/admin.guard';
import { RateLimit } from '../throttler/rate-limit.decorator';
import {
  QueueHealthService,
  QueueHealthStatus,
} from '../queue/queue-health.service';
import type { AuthenticatedExpressRequest } from '../auth/types';

@RateLimit('admin')
@Controller('admin')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class AdminController {
  constructor(private readonly queueHealth: QueueHealthService) {}

  @Get('check')
  checkAccess(@Req() req: AuthenticatedExpressRequest) {
    return {
      message: 'Admin access granted',
      user: req.user,
    };
  }

  @Get('queues/health')
  async getQueueHealth(): Promise<{ queues: QueueHealthStatus[] }> {
    const queues = await this.queueHealth.getHealthStatus();
    return { queues };
  }
}
