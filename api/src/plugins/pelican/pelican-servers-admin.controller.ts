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
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuthGuard } from '@nestjs/passport';
import {
  PelicanServerListResponseSchema,
  PelicanServerRowSchema,
  PelicanServerUpdateSchema,
} from '@raid-ledger/contract';
import type {
  PelicanPresencePluginRef,
  PelicanServerListResponse,
  PelicanServerRowDto,
} from '@raid-ledger/contract';
import { AdminGuard } from '../../auth/admin.guard';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../plugin-host/plugin-active.guard';
import { EXTENSION_POINTS } from '../plugin-host/extension-points';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import {
  PELICAN_PLUGIN_ID,
  PELICAN_PRESENCE_CONFIG_CHANGED,
} from './pelican.constants';
import {
  PelicanServersAdminRepository,
  type PelicanAdminServerRow,
} from './pelican-servers-admin.repository';
import { toAdminServerRowDto } from './pelican-servers-admin.helpers';

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
    private readonly registry: PluginRegistryService,
    private readonly events: EventEmitter2,
  ) {}

  /** GET /admin/plugins/pelican/servers — every row, missing included. */
  @Get('servers')
  async listServers(): Promise<PelicanServerListResponse> {
    const rows = await this.servers.listForAdmin();
    const now = new Date();
    return PelicanServerListResponseSchema.parse({
      data: rows.map((row) => this.toDto(row, now)),
    });
  }

  /** PATCH /admin/plugins/pelican/servers/:id — game, calendar visibility, Quick Play detection. */
  @Patch('servers/:id')
  async updateServer(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ): Promise<PelicanServerRowDto> {
    const parsed = PelicanServerUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message));
    }
    const patch = parsed.data;
    const result = await this.servers.updateMapping(id, patch, (slug) =>
      this.presenceSupported(slug),
    );
    if (result.kind === 'not_found') {
      throw new NotFoundException('Server not found');
    }
    if (result.kind === 'unknown_game') {
      throw new BadRequestException('Unknown game');
    }
    if (result.kind === 'presence_unsupported') {
      throw new BadRequestException(
        "Quick Play detection isn't supported for this server's game",
      );
    }
    if (patch.presenceTracking !== undefined || patch.gameId !== undefined) {
      this.events.emit(PELICAN_PRESENCE_CONFIG_CHANGED, { serverId: id });
    }
    return PelicanServerRowSchema.parse(this.toDto(result.row, new Date()));
  }

  /**
   * Quick Play detection (ROK-1800) is supported when the mapped game's slug
   * has an active `game-log-parser` adapter — today only Valheim. A suspended
   * (inactive-plugin) adapter is not returned, so it reads as unsupported;
   * `presencePluginInactive` names that plugin for the admin hint (ROK-1819).
   */
  private toDto(row: PelicanAdminServerRow, now: Date): PelicanServerRowDto {
    return toAdminServerRowDto(
      row,
      now,
      this.presenceSupported(row.gameSlug),
      this.presencePluginInactive(row.gameSlug),
    );
  }

  private presenceSupported(gameSlug: string | null): boolean {
    return (
      gameSlug !== null &&
      this.registry.getAdapter(EXTENSION_POINTS.GAME_LOG_PARSER, gameSlug) !==
        undefined
    );
  }

  private presencePluginInactive(
    gameSlug: string | null,
  ): PelicanPresencePluginRef | undefined {
    if (gameSlug === null) return undefined;
    return this.registry.getSuspendedAdapterOwner(
      EXTENSION_POINTS.GAME_LOG_PARSER,
      gameSlug,
    );
  }
}
