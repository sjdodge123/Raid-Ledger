/**
 * Admin "reopen a stalled lock-in" route (ROK-2033).
 *
 * Its own small controller so it stays off `standalone-poll.controller.ts`
 * (shared with ROK-2040) and the 300-line cap. The literal tail
 * `/reopen-lock-in` does not collide with the standalone controller's
 * `:id/...` routes under the same `scheduling-polls` prefix.
 */
import {
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { ReopenLockInResponseDto } from '@raid-ledger/contract';
import { RolesGuard } from '../../auth/roles.guard';
import { NotDeactivatedGuard } from '../../auth/not-deactivated.guard';
import { Roles } from '../../auth/roles.decorator';
import { SchedulingLockInRecoveryService } from './scheduling-lockin-recovery.service';

/** The JWT guard guarantees an authenticated user on this route. */
interface AdminRequest {
  user: { id: number };
}

@Controller('scheduling-polls')
export class SchedulingLockInRecoveryController {
  constructor(private readonly recovery: SchedulingLockInRecoveryService) {}

  /**
   * POST /scheduling-polls/:matchId/reopen-lock-in — admin only. Releases an
   * unlinked lock-in claim back to `scheduling` and deletes its orphaned
   * events. 409 when there is nothing to reopen.
   */
  @Post(':matchId/reopen-lock-in')
  @UseGuards(AuthGuard('jwt'), NotDeactivatedGuard, RolesGuard)
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  async reopenLockIn(
    @Param('matchId', ParseIntPipe) matchId: number,
    @Req() req: AdminRequest,
  ): Promise<ReopenLockInResponseDto> {
    return this.recovery.reopenByAdmin(matchId, req.user.id);
  }
}
