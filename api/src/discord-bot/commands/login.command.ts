import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { UsersService } from '../../users/users.service';
import { SettingsService } from '../../settings/settings.service';
import { MagicLinkService } from '../../auth/magic-link.service';
import { DiscordSigninLinkService } from '../../auth/discord-signin-link.service';
import {
  COMMAND_LINK_SRC,
  SIGNIN_LINK_PATH,
} from '../../auth/discord-signin-link.helpers';
import { DiscordBotClientService } from '../discord-bot-client.service';
import type { SlashCommandHandler } from './register-commands';
import type { CommandInteractionHandler } from '../listeners/interaction.listener';
import {
  LINK_REPLY_COPY,
  LOGIN_FAILED_COPY,
  buildLoginLinkRow,
  checkLoginRateLimit,
  decideLogin,
  rateLimitedCopy,
  refusalCopy,
  type LoginDecision,
  type LoginRateLimitRedis,
} from './login.helpers';

/** The minted link plus the id the Q6 log line names. */
interface MintedLink {
  url: string;
  logId: string;
}

/**
 * ROK-2283 `/login` — hands the CALLER a one-time sign-in link, privately.
 * Identity comes only from `interaction.user.id` (Discord-signed); the command
 * has no options, so nobody can mint a link for someone else. Works in guild
 * channels and DMs with the bot (Q2), guild members only.
 */
@Injectable()
export class LoginCommand
  implements SlashCommandHandler, CommandInteractionHandler
{
  readonly commandName = 'login';
  private readonly logger = new Logger(LoginCommand.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: LoginRateLimitRedis,
    private readonly usersService: UsersService,
    private readonly settingsService: SettingsService,
    private readonly magicLinkService: MagicLinkService,
    private readonly discordSigninLinkService: DiscordSigninLinkService,
    private readonly clientService: DiscordBotClientService,
  ) {}

  getDefinition(): RESTPostAPIChatInputApplicationCommandsJSONBody {
    return new SlashCommandBuilder()
      .setName('login')
      .setDescription('Get a private one-time link that signs you in')
      .setDMPermission(true)
      .toJSON();
  }

  async handleInteraction(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await this.respond(interaction);
    } catch (error) {
      // MINOR-2: never the error object — a failed editReply's DiscordAPIError
      // carries the request body, which holds the link.
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(`Failed to mint a /login sign-in link: ${reason}`);
      await interaction.editReply({ content: LOGIN_FAILED_COPY });
    }
  }

  private async respond(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const discordId = interaction.user.id;
    const limit = await checkLoginRateLimit(this.redis, discordId);
    if (!limit.allowed) {
      await interaction.editReply({
        content: rateLimitedCopy(limit.retryMinutes),
      });
      return;
    }
    const [decision, communityName] = await this.decide(discordId);
    if (decision.kind !== 'existing' && decision.kind !== 'first-time') {
      await interaction.editReply({
        content: refusalCopy(decision, communityName),
      });
      return;
    }
    const minted = await this.mint(decision, interaction);
    if (!minted) {
      await interaction.editReply({ content: LOGIN_FAILED_COPY });
      return;
    }
    // Q6: never log the URL or token.
    this.logger.log(`signin-link minted for user ${minted.logId}`);
    await interaction.editReply({
      content: LINK_REPLY_COPY,
      components: [buildLoginLinkRow(minted.url)],
    });
  }

  private async decide(
    discordId: string,
  ): Promise<[LoginDecision, string | null]> {
    const [clientUrl, communityName, caller, isGuildMember] = await Promise.all(
      [
        this.settingsService.getTrustedClientUrl(),
        this.settingsService.getDiscordBotCommunityName(),
        this.usersService.findByDiscordIdIncludingUnlinked(discordId),
        this.clientService.isGuildMember(discordId),
      ],
    );
    const decision = decideLogin({ clientUrl, caller, isGuildMember });
    return [decision, communityName];
  }

  private async mint(
    decision: Extract<LoginDecision, { kind: 'existing' | 'first-time' }>,
    interaction: ChatInputCommandInteraction,
  ): Promise<MintedLink | null> {
    const { clientUrl } = decision;
    if (decision.kind === 'existing') {
      const url = await this.magicLinkService.generateLink(
        decision.userId,
        SIGNIN_LINK_PATH,
        clientUrl,
        { src: COMMAND_LINK_SRC },
      );
      return url ? { url, logId: String(decision.userId) } : null;
    }
    const { id, username, avatar } = interaction.user;
    const url = this.discordSigninLinkService.mint(
      {
        discordId: id,
        username,
        avatar: avatar ?? null,
        src: COMMAND_LINK_SRC,
        ...(decision.rebind ? { rebind: decision.rebind } : {}),
      },
      clientUrl,
    );
    return { url, logId: `discord:${id}` };
  }
}
