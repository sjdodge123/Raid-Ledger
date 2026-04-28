import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { SlowQueryDigestDto } from '@raid-ledger/contract';
import { AdminGuard } from '../auth/admin.guard';
import { SlowQueriesService } from './slow-queries.service';

const DEFAULT_DIGEST_LIMIT = 10;
const MAX_DIGEST_LIMIT = 100;

/**
 * Admin endpoints for the slow-query digest (ROK-1156).
 *
 * `GET /admin/slow-queries/digest` — returns the latest snapshot diffed
 *   against the most recent cron snapshot.
 * `POST /admin/slow-queries/snapshot` — captures a manual snapshot and
 *   returns the freshly diffed digest.
 */
@Controller('admin/slow-queries')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class SlowQueriesController {
  constructor(private readonly slowQueries: SlowQueriesService) {}

  @Get('digest')
  async getDigest(
    @Query('limit') limitParam?: string,
  ): Promise<
    SlowQueryDigestDto | { snapshot: null; baseline: null; entries: [] }
  > {
    const limit = this.parseLimit(limitParam);
    const digest = await this.slowQueries.getLatestDigest(limit);
    return digest ?? { snapshot: null, baseline: null, entries: [] };
  }

  @Post('snapshot')
  @HttpCode(HttpStatus.OK)
  async captureSnapshot(
    @Query('limit') limitParam?: string,
  ): Promise<SlowQueryDigestDto> {
    const limit = this.parseLimit(limitParam);
    await this.slowQueries.captureSnapshot('manual');
    const digest = await this.slowQueries.getLatestDigest(limit);
    if (!digest) {
      throw new BadRequestException('Failed to read snapshot after capture');
    }
    return digest;
  }

  private parseLimit(raw?: string): number {
    if (!raw) return DEFAULT_DIGEST_LIMIT;
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DIGEST_LIMIT;
    return Math.min(parsed, MAX_DIGEST_LIMIT);
  }
}
