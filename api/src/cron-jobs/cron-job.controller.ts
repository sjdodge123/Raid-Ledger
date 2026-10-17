import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  ParseIntPipe,
  Body,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/admin.guard';
import { RateLimit } from '../throttler/rate-limit.decorator';
import { CronJobService } from './cron-job.service';

/**
 * Admin-only controller for cron job management (ROK-310).
 * All endpoints require JWT auth + admin role.
 */
@Controller('admin/cron-jobs')
@UseGuards(AuthGuard('jwt'), AdminGuard)
@RateLimit('admin')
export class CronJobController {
  constructor(private readonly cronJobService: CronJobService) {}

  /**
   * GET /admin/cron-jobs — List all registered cron jobs
   */
  @Get()
  async listJobs() {
    return this.cronJobService.listJobs();
  }

  /**
   * GET /admin/cron-jobs/:id/executions — Execution history for a job
   */
  @Get(':id/executions')
  async getExecutions(
    @Param('id', ParseIntPipe) id: number,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 100) : 50;
    return this.cronJobService.getExecutionHistory(id, parsedLimit);
  }

  /**
   * PATCH /admin/cron-jobs/:id/pause — Pause a cron job
   */
  @Patch(':id/pause')
  async pauseJob(@Param('id', ParseIntPipe) id: number) {
    const job = await this.cronJobService.pauseJob(id);
    if (!job) throw new NotFoundException('Cron job not found');
    return job;
  }

  /**
   * PATCH /admin/cron-jobs/:id/resume — Resume a paused cron job
   */
  @Patch(':id/resume')
  async resumeJob(@Param('id', ParseIntPipe) id: number) {
    const job = await this.cronJobService.resumeJob(id);
    if (!job) throw new NotFoundException('Cron job not found');
    return job;
  }

  /**
   * PATCH /admin/cron-jobs/:id/schedule — Update the cron schedule
   */
  @Patch(':id/schedule')
  async updateSchedule(
    @Param('id', ParseIntPipe) id: number,
    @Body('cronExpression') cronExpression: string,
  ) {
    const job = await this.cronJobService.updateSchedule(id, cronExpression);
    if (!job) throw new NotFoundException('Cron job not found');
    return job;
  }

  /**
   * POST /admin/cron-jobs/:id/run — Manually trigger a cron job
   */
  @Post(':id/run')
  async triggerJob(@Param('id', ParseIntPipe) id: number) {
    const job = await this.cronJobService.triggerJob(id);
    if (!job) throw new NotFoundException('Cron job not found');
    return job;
  }
}
