/**
 * ROK-1483 — the one read endpoint of the thread mirror (D1, D3).
 *
 * Read-only by construction: there is no write route here and never will be
 * one. Replying from the web is AC4's explicit non-goal, and the mirror has no
 * path back to Discord.
 */
import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ThreadMessagesQuerySchema,
  type ThreadMessagesResponseDto,
} from '@raid-ledger/contract';
import { NotDeactivatedGuard } from '../../auth/not-deactivated.guard';
import type { AuthenticatedRequest } from '../../auth/types';
import { ThreadMirrorService } from './thread-mirror.service';

@Controller('discord/threads')
@UseGuards(AuthGuard('jwt'), NotDeactivatedGuard)
export class DiscordThreadsController {
  constructor(private readonly mirror: ThreadMirrorService) {}

  /**
   * One page of a mirrored thread, ascending by snowflake.
   *
   * `surfaceKind` + `surfaceId` are REQUIRED: the caller declares which
   * surface it believes the thread belongs to, and a mismatch against the
   * server's own resolution is a 403 (D3). An unknown kind or an out-of-range
   * `limit` is a 400 at the boundary, never a silent clamp.
   *
   * @param threadId - The Discord thread id.
   * @param query - Unvalidated query string; parsed here.
   * @param req - Carries the authenticated user.
   * @returns The page plus `hasMore`, the Discord deep link and the surface.
   */
  @Get(':threadId/messages')
  async list(
    @Param('threadId') threadId: string,
    @Query() query: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<ThreadMessagesResponseDto> {
    const parsed = ThreadMessagesQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten().fieldErrors);
    }
    return this.mirror.getMessages(req.user.id, threadId, parsed.data);
  }
}
