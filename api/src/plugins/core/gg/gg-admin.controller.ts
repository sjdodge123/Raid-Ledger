/**
 * ROK-2187 — admin GG <year> tools: delivery settings, a live dry run, a
 * recompute (refused once announced unless `force`), a live preview of the
 * admin's own GG (not stored) and send-now (compute + announce, skipping only
 * the date gate; refused while paused; DMs stay on the cron's ≤25/tick wave).
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  GgAdminRecomputeDtoSchema,
  GgAdminSettingsUpdateDtoSchema,
  GgYearSchema,
  type GgAdminDryRunDto,
  type GgAdminPreviewDto,
  type GgAdminSettingsDto,
} from '@raid-ledger/contract';
import { AdminGuard } from '../../../auth/admin.guard';
import type { AuthenticatedRequest } from '../../../auth/types';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import {
  GgComputeService,
  type GgComputeAllResult,
} from './gg-compute.service';
import {
  GgDeliveryService,
  type GgDeliveryOutcome,
} from './gg-delivery.service';
import { isGgDeliveryJobPaused } from './gg-delivery.cron';
import { writeGgDeliverySettings } from './gg-delivery.settings';
import { loadGgUserFacets, tallyGgDryRun } from './gg-dry-run.helpers';
import { readGgMascot } from './mascot/gg-mascot.settings';

/** Body/query value → T, else 400 with the zod issues. */
function parseOr400<T>(
  parse: (v: unknown) => { success: true; data: T } | { success: false },
  value: unknown,
): T {
  const result = parse(value);
  if (!result.success) throw new BadRequestException('Invalid GG request');
  return result.data;
}

@Controller('admin/gg')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class GgAdminController {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settings: SettingsService,
    private readonly compute: GgComputeService,
    private readonly delivery: GgDeliveryService,
  ) {}

  /** `?year=` → a GG year, else the configured delivery year. */
  private async yearOf(raw: string | undefined): Promise<number> {
    if (raw === undefined) return this.delivery.deliveryYear();
    return parseOr400((v) => GgYearSchema.safeParse(v), Number(raw));
  }

  @Get('settings')
  async getSettings(): Promise<GgAdminSettingsDto> {
    const [delivery, mascot] = await Promise.all([
      this.delivery.readSettings(),
      readGgMascot(this.settings),
    ]);
    return { ...delivery, mascot };
  }

  @Patch('settings')
  async patchSettings(@Body() body: unknown): Promise<GgAdminSettingsDto> {
    const patch = parseOr400(
      (v) => GgAdminSettingsUpdateDtoSchema.safeParse(v),
      body,
    );
    await writeGgDeliverySettings(this.settings, patch);
    return this.getSettings();
  }

  @Get('dry-run')
  async dryRun(@Query('year') raw?: string): Promise<GgAdminDryRunDto> {
    const year = await this.yearOf(raw);
    const tz = await this.compute.communityTimeZone();
    const now = new Date();
    return tallyGgDryRun(
      await loadGgUserFacets(this.db),
      (userId) => this.compute.computeForUser(userId, year, now, tz),
      year,
      await this.delivery.announcedAt(year),
    );
  }

  @Post('recompute')
  @HttpCode(HttpStatus.OK)
  async recompute(@Body() body: unknown): Promise<GgComputeAllResult> {
    const input = parseOr400(
      (v) => GgAdminRecomputeDtoSchema.safeParse(v),
      body,
    );
    const announced = await this.delivery.announcedAt(input.year);
    if (announced && input.force !== true) {
      throw new ConflictException(
        `GG ${input.year} was already announced — pass force to recompute`,
      );
    }
    return this.compute.computeAll(input.year);
  }

  @Get('preview')
  async preview(
    @Req() req: AuthenticatedRequest,
    @Query('year') raw?: string,
  ): Promise<GgAdminPreviewDto> {
    const year = await this.yearOf(raw);
    const snapshot = await this.compute.computeForUser(req.user.id, year);
    if (!snapshot) throw new NotFoundException(`No activity in ${year}`);
    return snapshot;
  }

  /**
   * Compute + announce now (date gate skipped). Refused while the job is
   * paused on the Jobs page (AC11); the DM wave stays on the cron's pacing.
   */
  @Post('send-now')
  @HttpCode(HttpStatus.OK)
  async sendNow(): Promise<GgDeliveryOutcome> {
    if (await isGgDeliveryJobPaused(this.db)) {
      throw new ConflictException(
        'GG delivery is paused on the Jobs page — resume it to send',
      );
    }
    return this.delivery.runTick(new Date(), {
      bypassDate: true,
      announceOnly: true,
    });
  }
}
