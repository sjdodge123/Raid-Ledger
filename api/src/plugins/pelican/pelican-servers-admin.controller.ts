import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  PelicanServerListResponseSchema,
  PelicanServerRowSchema,
  PelicanServerUpdateSchema,
} from '@raid-ledger/contract';
import type {
  PelicanServerListResponse,
  PelicanServerRowDto,
} from '@raid-ledger/contract';
import { AdminGuard } from '../../auth/admin.guard';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../plugin-host/plugin-active.guard';
import { PELICAN_PLUGIN_ID } from './pelican.constants';
import { PelicanServersAdminRepository } from './pelican-servers-admin.repository';
import { toAdminServerRowDto } from './pelican-servers-admin.helpers';
import { PelicanTzCheckService } from './pelican-tz-check.service';

/**
 * Pelican admin servers table (ROK-1094). Same guards as
 * `PelicanAdminController`. Responses are parsed with the strict contract
 * schema, so a leaked panel uuid or identifier fails loudly (§8).
 */
@Controller('admin/plugins/pelican')
@UseGuards(AuthGuard('jwt'), AdminGuard, PluginActiveGuard)
@RequirePlugin(PELICAN_PLUGIN_ID)
export class PelicanServersAdminController {
  constructor(
    private readonly servers: PelicanServersAdminRepository,
    private readonly tzCheck: PelicanTzCheckService,
  ) {}

  /** GET /admin/plugins/pelican/servers — every row, missing included. */
  @Get('servers')
  async listServers(): Promise<PelicanServerListResponse> {
    const rows = await this.servers.listForAdmin();
    const mismatched = await this.tzCheck.mismatchedServerIds(rows);
    const now = new Date();
    return PelicanServerListResponseSchema.parse({
      data: rows.map((row) =>
        toAdminServerRowDto(row, now, mismatched.has(row.id)),
      ),
    });
  }

  /** PATCH /admin/plugins/pelican/servers/:id — game, calendar, timezone. */
  @Patch('servers/:id')
  async updateServer(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<PelicanServerRowDto> {
    const parsed = PelicanServerUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message));
    }
    const result = await this.servers.updateMapping(id, parsed.data);
    if (result.kind === 'not_found') {
      throw new NotFoundException('Server not found');
    }
    if (result.kind === 'unknown_game') {
      throw new BadRequestException('Unknown game');
    }
    const mismatched = await this.tzCheck.mismatchedServerIds([result.row]);
    return PelicanServerRowSchema.parse(
      toAdminServerRowDto(result.row, new Date(), mismatched.has(id)),
    );
  }
}
