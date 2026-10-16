/**
 * DemoTestJoinPostController (ROK-1740) —
 * `POST /admin/test/join-post/delete-message`.
 *
 * Deletes the stored "Join Raid Ledger" Discord message WITHOUT clearing the
 * stored ids — what a moderator deleting the post by hand looks like to the
 * app. The companion smoke then re-posts and asserts the post is re-created
 * (Discord 10008) rather than duplicated.
 * DEMO_MODE-only, behind the JWT + admin guards like every `/admin/test/*`.
 */
import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { AdminGuard } from '../auth/admin.guard';
import { DemoModeGuard } from './demo-mode.guard';
import { SettingsService } from '../settings/settings.service';
import { getJoinPost } from '../settings/settings-join-post.helpers';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { isUnknownMessage } from '../discord-bot/discord-bot-client.messages.helpers';
import {
  findTextChannel,
  requireBotContext,
} from '../discord-bot/join-post/join-post-channel.helpers';

export interface DeleteJoinPostMessageResponse {
  /** True when Discord deleted the message on this call. */
  deleted: boolean;
  /** The stored message id, untouched; null when nothing is stored. */
  messageId: string | null;
}

@Controller('admin/test/join-post')
@SkipThrottle()
@UseGuards(AuthGuard('jwt'), AdminGuard, DemoModeGuard)
export class DemoTestJoinPostController {
  constructor(
    private readonly settings: SettingsService,
    private readonly client: DiscordBotClientService,
  ) {}

  /** Delete the Discord message only; the stored ids are left in place. */
  @Post('delete-message')
  @HttpCode(HttpStatus.OK)
  async deleteMessage(): Promise<DeleteJoinPostMessageResponse> {
    const { channelId, messageId } = await getJoinPost(this.settings);
    if (!channelId || !messageId) return { deleted: false, messageId: null };
    const ctx = requireBotContext(this.client);
    const channel = findTextChannel(ctx.guild, channelId);
    if (!channel) return { deleted: false, messageId };
    try {
      await channel.messages.delete(messageId);
      return { deleted: true, messageId };
    } catch (err) {
      if (isUnknownMessage(err)) return { deleted: false, messageId };
      throw err;
    }
  }
}
