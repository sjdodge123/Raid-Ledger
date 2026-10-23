/**
 * ROK-1933 L3 — the suggested-claim DM's `[Yes, it's mine]` / `[Not me]`
 * buttons (`vclaim:yes:<profileId>` / `vclaim:no:<profileId>`).
 *
 * Identity comes from the interaction, never from the custom id: the clicker's
 * Discord id resolves to an RL user, and that user must hold the pair key the
 * DM scan wrote (`valheim-claim-suggest:<profileId>:<userId>`) — a forged or
 * forwarded id answers ephemerally and changes nothing.
 *
 * Yes runs the manual-claim path (hidden-hub check + `claim`, same audit row).
 * Not me writes the permanent declined key and frees the per-character 24h
 * key so the scan can ask the next candidate. Both edit the DM: buttons off,
 * the outcome copy on. Registered in `ValheimModule` (its services live there).
 */
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { ButtonInteraction } from 'discord.js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import type { GuildActor } from '../../guilds/guild-access.service';
import { NotificationDedupService } from '../../notifications/notification-dedup.service';
import { ValheimArmoryClaimsService } from '../../plugins/valheim/armory/identity/valheim-armory-claims.service';
import {
  CLAIM_REPLY_COPY,
  buildClaimCharacterUrl,
  claimSuggestKeys,
  parseClaimButtonId,
} from '../../plugins/valheim/armory/identity/valheim-claim-suggest.copy';
import { ValheimArmoryReadService } from '../../plugins/valheim/armory/read/valheim-armory-read.service';
import { SettingsService } from '../../settings/settings.service';
import { getClientUrl } from '../../settings/settings-bot.helpers';
import { DISCORD_BOT_EVENTS } from '../discord-bot.constants';
import { DiscordBotClientService } from '../discord-bot-client.service';
import {
  DiscordListenerBinding,
  gatewayBinding,
} from './discord-listener-binding';
import {
  type ClaimOutcome,
  editDm as edit,
  deliverClaimOutcome,
  findAskedClicker,
  refuseClick as refuse,
} from './valheim-claim-suggest.helpers';

@Injectable()
export class ValheimClaimSuggestListener {
  private readonly logger = new Logger(ValheimClaimSuggestListener.name);
  private readonly binding = new DiscordListenerBinding(
    this.logger,
    'Valheim claim-DM interactions',
  );

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly claims: ValheimArmoryClaimsService,
    private readonly reads: ValheimArmoryReadService,
    private readonly dedup: NotificationDedupService,
    private readonly settings: SettingsService,
  ) {}

  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  onBotConnected(): void {
    this.binding.attachToClient(this.clientService.getClient(), [
      gatewayBinding('interactionCreate', (interaction) => {
        if (interaction.isButton())
          void this.handleButtonInteraction(interaction);
      }),
    ]);
  }

  /** Drop the handler so a reconnect re-attaches to the live client. */
  @OnEvent(DISCORD_BOT_EVENTS.DISCONNECTED)
  onBotDisconnected(): void {
    this.binding.detach();
  }

  /**
   * Handle one claim-DM press. Defers inside Discord's 3s window, then edits.
   * Never throws back into the gateway.
   *
   * @param interaction - The button interaction discord.js dispatched.
   */
  async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const press = parseClaimButtonId(interaction.customId);
    if (!press) return;
    try {
      await interaction.deferUpdate();
      const clicker = await findAskedClicker(
        this.db,
        this.dedup,
        interaction.user.id,
        press.profileId,
      );
      if (!clicker) {
        return await this.answer(
          interaction,
          refuse(CLAIM_REPLY_COPY.notForYou),
        );
      }
      const outcome =
        press.action === 'yes'
          ? await this.yes(press.profileId, clicker)
          : await this.no(press.profileId, clicker.id);
      await this.answer(interaction, outcome);
    } catch (error) {
      this.logger.error(
        `Claim-DM press failed (${interaction.customId})`,
        error,
      );
      await this.answer(interaction, refuse(CLAIM_REPLY_COPY.error));
    }
  }

  /** Yes: the manual-claim path, then the outcome copy. */
  private async yes(
    profileId: number,
    clicker: GuildActor,
  ): Promise<ClaimOutcome> {
    try {
      await this.reads.assertCharacterVisible(profileId, clicker);
      await this.claims.claim(profileId, clicker.id);
    } catch (error) {
      if (error instanceof ConflictException) {
        const s = await this.reads.summary(profileId);
        return edit(
          s.claimedBy?.id === clicker.id
            ? CLAIM_REPLY_COPY.alreadyYours
            : CLAIM_REPLY_COPY.takenByOther(s.name),
        );
      }
      if (error instanceof NotFoundException) {
        return edit(CLAIM_REPLY_COPY.unavailable);
      }
      throw error;
    }
    const s = await this.reads.summary(profileId);
    const url = buildClaimCharacterUrl(
      await getClientUrl(this.settings),
      profileId,
    );
    return edit(CLAIM_REPLY_COPY.claimed(s.name, url));
  }

  /** Not me: suppress this pair forever and free the character's 24h key. */
  private async no(profileId: number, userId: number): Promise<ClaimOutcome> {
    await this.dedup.checkAndMarkSent(
      claimSuggestKeys.declined(profileId, userId),
      null,
    );
    await this.dedup.releaseKey(claimSuggestKeys.profile(profileId));
    return edit(CLAIM_REPLY_COPY.declined(await this.nameOf(profileId)));
  }

  /** The character's name, or a neutral fallback when it is gone. */
  private async nameOf(profileId: number): Promise<string> {
    try {
      return (await this.reads.summary(profileId)).name;
    } catch (error) {
      if (error instanceof NotFoundException)
        return CLAIM_REPLY_COPY.fallbackName;
      throw error;
    }
  }

  /** Deliver an outcome; best-effort. */
  private answer(
    interaction: ButtonInteraction,
    outcome: ClaimOutcome,
  ): Promise<void> {
    return deliverClaimOutcome(interaction, outcome, this.logger);
  }
}
