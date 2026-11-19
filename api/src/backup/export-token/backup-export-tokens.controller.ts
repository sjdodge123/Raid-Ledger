import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type {
  BackupExportTokenListResponse,
  MintBackupExportTokenResponse,
} from '@raid-ledger/contract';
import { AdminGuard } from '../../auth/admin.guard';
import type { AuthenticatedExpressRequest } from '../../auth/types';
import { RateLimit } from '../../throttler/rate-limit.decorator';
import { BackupExportTokensService } from './backup-export-tokens.service';

/**
 * ROK-2263 D7: manage backup-export tokens. Session JWT + admin ONLY — an
 * `rlbx_` bearer is not a JWT, so `AuthGuard('jwt')` 401s it: a token can
 * never mint, list or revoke tokens.
 */
@Controller('admin/backup-export-tokens')
@UseGuards(AuthGuard('jwt'), AdminGuard)
@RateLimit('admin')
export class BackupExportTokensController {
  constructor(private readonly tokens: BackupExportTokensService) {}

  @Get()
  list(): Promise<BackupExportTokenListResponse> {
    return this.tokens.list();
  }

  /** 201 with the plaintext token — the only time it is ever returned. */
  @Post()
  @Header('Cache-Control', 'no-store')
  mint(
    @Body() body: unknown,
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<MintBackupExportTokenResponse> {
    return this.tokens.mint(req.user.id, body);
  }

  /** 204; revoking an already-revoked token is a no-op, unknown id 404. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<void> {
    return this.tokens.revoke(req.user.id, id);
  }
}
