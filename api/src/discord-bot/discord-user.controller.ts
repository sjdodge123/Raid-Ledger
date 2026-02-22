import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { DiscordBotClientService } from './discord-bot-client.service';
import { PugInviteService } from './services/pug-invite.service';
import type {
  ServerInviteResponseDto,
  GuildMembershipResponseDto,
} from '@raid-ledger/contract';
/**
 * Check if a discordId represents a real linked Discord account.
 */
function isDiscordLinked(discordId: string | null | undefined): boolean {
  return Boolean(
    discordId &&
    !discordId.startsWith('local:') &&
    !discordId.startsWith('unlinked:'),
  );
}

/**
 * User-facing Discord endpoints for onboarding (ROK-403).
 * Any authenticated user can access these.
 */
@Controller('discord')
@UseGuards(AuthGuard('jwt'))
export class DiscordUserController {
  constructor(
    private readonly discordBotClientService: DiscordBotClientService,
    private readonly pugInviteService: PugInviteService,
  ) {}

  /**
   * Generate a Discord server invite URL for the current user (ROK-403).
   * Used by the FTE "Join Discord" step.
   */
  @Get('server-invite')
  async getServerInvite(): Promise<ServerInviteResponseDto> {
    if (!this.discordBotClientService.isConnected()) {
      return { url: null, guildName: null };
    }

    const guildInfo = this.discordBotClientService.getGuildInfo();
    // Use eventId=0 since this is not tied to a specific event
    const url = await this.pugInviteService.generateServerInvite(0);

    return {
      url,
      guildName: guildInfo?.name ?? null,
    };
  }

  /**
   * Check if the current user is already a member of the Discord server (ROK-403).
   * Used by the FTE wizard to auto-skip the "Join Discord" step.
   */
  @Get('guild-membership')
  async checkGuildMembership(
    @Req() req: { user: { discordId: string } },
  ): Promise<GuildMembershipResponseDto> {
    const discordId = req.user?.discordId;

    if (!discordId || !isDiscordLinked(discordId)) {
      return { isMember: false };
    }

    if (!this.discordBotClientService.isConnected()) {
      return { isMember: false };
    }

    const isMember =
      await this.discordBotClientService.isGuildMember(discordId);
    return { isMember };
  }
}
