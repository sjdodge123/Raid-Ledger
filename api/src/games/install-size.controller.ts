/**
 * ROK-1374 (C1) — `PUT /games/:id/install-size`.
 *
 * Any authenticated, non-deactivated user may contribute a size (O2). The
 * value is community-shared and low-risk, and gating it to roster members
 * would kill the contribution rate that makes the readiness card useful.
 */
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SetInstallSizeSchema } from '@raid-ledger/contract';
import { NotDeactivatedGuard } from '../auth/not-deactivated.guard';
import type { AuthenticatedRequest } from '../auth/types';
import {
  InstallSizeService,
  type InstallSizeResult,
} from './install-size.service';

@Controller('games')
@UseGuards(AuthGuard('jwt'))
export class InstallSizeController {
  constructor(private readonly service: InstallSizeService) {}

  /**
   * Record a hand-entered install/download footprint.
   *
   * The schema rejects "both null" and a download larger than the install
   * (E14) — an unbounded numeric field is the one place a typo turns into a
   * number the card then presents with total confidence.
   */
  @Put(':id/install-size')
  @UseGuards(NotDeactivatedGuard)
  @HttpCode(HttpStatus.OK)
  async setInstallSize(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<InstallSizeResult> {
    const parsed = SetInstallSizeSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues);
    }
    return this.service.setSize(id, parsed.data, req.user.id);
  }
}
