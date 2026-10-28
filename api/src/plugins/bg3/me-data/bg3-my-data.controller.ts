import { Controller, Delete, HttpCode, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { AuthenticatedExpressRequest } from '../../../auth/types';
import {
  Bg3MyDataRepository,
  type Bg3MyDataDeleted,
} from './bg3-my-data.repository';

/**
 * ROK-1957 D-18 — `DELETE plugins/bg3/me/data`, the caller only. Deliberately
 * WITHOUT `PluginActiveGuard`: removing data a user withdrew runs whether or
 * not `bg3` is active (CLAUDE.md hub-plugin rule), so this cannot live on
 * `Bg3MeController`, whose class-level guard 403s when the plugin is off.
 */
@Controller('plugins/bg3/me')
@UseGuards(AuthGuard('jwt'))
export class Bg3MyDataController {
  constructor(private readonly repo: Bg3MyDataRepository) {}

  @Delete('data')
  @HttpCode(200)
  async deleteMine(
    @Req() req: AuthenticatedExpressRequest,
  ): Promise<{ deleted: Bg3MyDataDeleted }> {
    return { deleted: await this.repo.deleteAllFor(req.user.id) };
  }
}
