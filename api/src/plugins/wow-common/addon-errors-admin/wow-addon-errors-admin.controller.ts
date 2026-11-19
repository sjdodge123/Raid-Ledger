import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import type { z } from 'zod';
import {
  ADDON_ERROR_SIGNATURE_RE,
  ADDON_ERRORS_EXPORT_MAX_ROWS,
  AddonErrorsExportQuerySchema,
  AddonErrorsListQuerySchema,
  type AddonErrorDetailDto,
  type AddonErrorExportJsonDto,
  type AddonErrorGroupPageDto,
} from '@raid-ledger/contract';
import { AdminGuard } from '../../../auth/admin.guard';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../plugin-host/plugin-active.guard';
import { toAddonErrorsCsv } from './wow-addon-errors-admin.csv';
import { exportTruncationHeaders } from './wow-addon-errors-admin.export';
import { WowAddonErrorsAdminService } from './wow-addon-errors-admin.service';

function parseQuery<T>(schema: z.ZodType<T>, q: unknown): T {
  const parsed = schema.safeParse(q);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.issues.map((i) => i.message));
  }
  return parsed.data;
}

/**
 * ROK-2099 (S3) — admin reads of the WoW addon errors the Companion uploads.
 * Admin-only and `blizzard`-gated like the other `admin/plugins/blizzard/*`
 * routes: a non-admin gets 403, and so does everyone while `blizzard` is
 * inactive (PluginActiveGuard). The export is the only way the records
 * leave the server (rulings 3–4).
 */
@Controller('admin/plugins/blizzard/addon-errors')
@RequirePlugin('blizzard')
@UseGuards(AuthGuard('jwt'), AdminGuard, PluginActiveGuard)
export class WowAddonErrorsAdminController {
  constructor(private readonly service: WowAddonErrorsAdminService) {}

  /** GET — groups by (addon, message), filtered, 25 per page. */
  @Get()
  list(@Query() query: unknown): Promise<AddonErrorGroupPageDto> {
    return this.service.list(parseQuery(AddonErrorsListQuerySchema, query));
  }

  /**
   * GET export?format=json|csv&… — download of the stored scrubbed rows.
   * Past the row cap it sends `X-Export-Truncated: true` + `X-Export-Row-Cap`.
   */
  @Get('export')
  async export(
    @Query() query: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AddonErrorExportJsonDto | string> {
    const { format, ...filters } = parseQuery(
      AddonErrorsExportQuerySchema,
      query,
    );
    const { rows, truncated } = await this.service.exportRows(filters);
    res.set(exportTruncationHeaders(truncated, ADDON_ERRORS_EXPORT_MAX_ROWS));
    const exportedAt = new Date().toISOString();
    const name = `addon-errors-${exportedAt.slice(0, 10)}.${format}`;
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    if (format === 'json') return { exportedAt, rows };
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return toAddonErrorsCsv(rows);
  }

  /** GET :signature — every record of one group, full stacks. */
  @Get(':signature')
  detail(@Param('signature') signature: string): Promise<AddonErrorDetailDto> {
    if (!ADDON_ERROR_SIGNATURE_RE.test(signature)) {
      throw new BadRequestException('Invalid addon error signature');
    }
    return this.service.detail(signature);
  }
}
