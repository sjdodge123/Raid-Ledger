import {
  Controller,
  Delete,
  Get,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminGuard } from '../auth/admin.guard';
import {
  DiscordJoinPostPublishSchema,
  type DiscordJoinPostPublishDto,
  type DiscordJoinPostResult,
  type DiscordJoinPostStatus,
} from '@raid-ledger/contract';
import { handleValidationError } from './validation.util';
import { JoinPostService } from './join-post/join-post.service';

/**
 * ROK-1740: the pinned "Join Raid Ledger" post — admin routes.
 * POST both picks the channel and posts (D2); errors are the service's
 * (400 bad channel · 422 missing permissions · 503 offline/transient).
 */
@Controller('admin/settings/discord-bot')
@UseGuards(AuthGuard('jwt'), AdminGuard)
export class JoinPostSettingsController {
  constructor(private readonly joinPost: JoinPostService) {}

  /** Where the post lives, if anywhere. */
  @Get('join-post')
  async getStatus(): Promise<DiscordJoinPostStatus> {
    return this.joinPost.status();
  }

  /**
   * Post (or re-post) the join message to a channel.
   *
   * @param body - `{ channelId }`, validated by the contract schema.
   */
  @Post('join-post')
  @HttpCode(HttpStatus.OK)
  async publish(@Body() body: unknown): Promise<DiscordJoinPostResult> {
    let dto: DiscordJoinPostPublishDto;
    try {
      dto = DiscordJoinPostPublishSchema.parse(body);
    } catch (error) {
      handleValidationError(error);
    }
    return this.joinPost.publish(dto.channelId);
  }

  /** Delete the post and forget it. */
  @Delete('join-post')
  @HttpCode(HttpStatus.OK)
  async remove(): Promise<{ removed: boolean }> {
    return this.joinPost.remove();
  }
}
