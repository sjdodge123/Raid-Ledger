import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { z } from 'zod';
import type {
  ValheimLinkTokenIssued,
  ValheimLinkTokenListResponse,
  ValheimLinkTokenStatus,
} from '@raid-ledger/contract';
import { AdminGuard } from '../../../auth/admin.guard';
import { RateLimit } from '../../../throttler/rate-limit.decorator';
import {
  PluginActiveGuard,
  RequirePlugin,
} from '../../plugin-host/plugin-active.guard';
import { VALHEIM_PLUGIN_ID } from '../valheim.constants';
import { ValheimLinkTokensService } from './valheim-link-tokens.service';

const IssueBodySchema = z.object({ rotate: z.boolean().optional() }).strict();

interface AdminRequest {
  user?: { id: number };
}

/**
 * ROK-1833 site-admin token endpoints. Only `POST` responses carry the
 * plaintext token (`ValheimLinkTokenIssuedSchema`), exactly once.
 */
@Controller('admin/plugins/valheim/link-tokens')
@UseGuards(AuthGuard('jwt'), AdminGuard, PluginActiveGuard)
@RequirePlugin(VALHEIM_PLUGIN_ID)
@RateLimit('admin')
export class ValheimLinkTokensAdminController {
  constructor(private readonly tokens: ValheimLinkTokensService) {}

  /** GET — every Valheim-mapped server's token status. */
  @Get()
  list(): Promise<ValheimLinkTokenListResponse> {
    return this.tokens.list();
  }

  /** GET /:id — none / active / revoked, hint + timestamps; never the secret. */
  @Get(':id')
  status(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ValheimLinkTokenStatus> {
    return this.tokens.status(id);
  }

  /** POST /:id `{ rotate? }` — issue; 409 when live unless `rotate`. */
  @Post(':id')
  issue(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() req: AdminRequest,
  ): Promise<ValheimLinkTokenIssued> {
    const parsed = IssueBodySchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException('Invalid body');
    return this.tokens.issue(
      id,
      req.user?.id ?? null,
      parsed.data.rotate ?? false,
    );
  }

  /** POST /:id/rotate — new token; the old one dies in the same statement. */
  @Post(':id/rotate')
  rotate(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AdminRequest,
  ): Promise<ValheimLinkTokenIssued> {
    return this.tokens.issue(id, req.user?.id ?? null, true);
  }

  /** DELETE /:id — revoke; 404 when there is no live token. */
  @Delete(':id')
  @HttpCode(200)
  revoke(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ValheimLinkTokenStatus> {
    return this.tokens.revoke(id);
  }
}
