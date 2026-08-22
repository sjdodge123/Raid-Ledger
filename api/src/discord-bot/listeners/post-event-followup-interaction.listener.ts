import { Injectable, Inject, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { OnEvent } from '@nestjs/event-emitter';
import { MessageFlags } from 'discord.js';
import type { ButtonInteraction } from 'discord.js';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { StandalonePollService } from '../../lineups/standalone-poll/standalone-poll.service';
import { NotificationService } from '../../notifications/notification.service';
import { SettingsService } from '../../settings/settings.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import {
  DISCORD_BOT_EVENTS,
  POST_EVENT_FOLLOWUP_BUTTON_IDS,
} from '../discord-bot.constants';
import {
  DiscordListenerBinding,
  gatewayBinding,
} from './discord-listener-binding';
import { findLinkedUser } from './signup-interaction.helpers';
import {
  handlePollClick,
  handleScheduleClick,
  lookupFollowupEvent,
  parsePostEventFollowupButton,
  type FollowupButtonParsed,
  type FollowupInteractionEvent,
  type PostEventFollowupDeps,
} from './post-event-followup-interaction.handlers';

const LINK_MSG =
  'Link your Raid Ledger account first — open the app and connect Discord.';

/** Terminal outcome of a follow-up button click, emitted to the log (ROK-1425). */
type FollowupOutcome =
  'not-linked' | 'event-not-found' | 'not-organizer' | 'schedule' | 'poll';

const errMsg = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

/**
 * Routes the post-event follow-up prompt buttons ([Schedule event] /
 * [Start a poll]) on organizer DMs (ROK-1371 M3). Coexists with the other
 * `interactionCreate` listeners by parsing + ignoring non-`pef_*` custom ids.
 */
@Injectable()
export class PostEventFollowupInteractionListener {
  private readonly logger = new Logger(
    PostEventFollowupInteractionListener.name,
  );
  private readonly binding = new DiscordListenerBinding(
    this.logger,
    'post-event follow-up interactions',
  );

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    // ROK-1371: resolve StandalonePollService lazily via ModuleRef instead of a
    // constructor forwardRef. Injecting it directly would force DiscordBotModule
    // to import StandalonePollModule, enlarging the existing
    // Events→Notification→DiscordBot module cycle and leaving StandalonePoll's
    // subtree imports (Notification/Events/Scheduling) undefined at ES load time.
    private readonly moduleRef: ModuleRef,
    private readonly notificationService: NotificationService,
    private readonly settingsService: SettingsService,
  ) {}

  private get deps(): PostEventFollowupDeps {
    return {
      db: this.db,
      standalonePollService: this.moduleRef.get(StandalonePollService, {
        strict: false,
      }),
      notificationService: this.notificationService,
      settingsService: this.settingsService,
      logger: this.logger,
    };
  }

  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  onBotConnected(): void {
    this.binding.attachToClient(this.clientService.getClient(), [
      gatewayBinding('interactionCreate', (interaction) => {
        if (interaction.isButton()) void this.handle(interaction);
      }),
    ]);
  }

  /** Drop the handler so a reconnect re-attaches to the live client. */
  @OnEvent(DISCORD_BOT_EVENTS.DISCONNECTED)
  onBotDisconnected(): void {
    this.binding.detach();
  }

  private async handle(interaction: ButtonInteraction): Promise<void> {
    const parsed = parsePostEventFollowupButton(interaction.customId);
    if (!parsed) return;
    // ROK-1425: this flow had zero logging, so a dropped interaction was
    // invisible in a prod log export. Only `pef_*` ids reach here, so these
    // lines are per-click — not per gateway event.
    const tag = `customId=${interaction.customId} discordUserId=${interaction.user.id}`;
    this.logger.log(`Follow-up button received (${tag})`);
    if (!(await this.defer(interaction, tag))) return;
    try {
      const outcome = await this.route(interaction, parsed);
      this.logger.log(`Follow-up button handled (${tag}) outcome=${outcome}`);
    } catch (error) {
      this.logger.error(
        `Follow-up button failed (${tag}) eventId=${parsed.endedEventId}`,
        error,
      );
      await interaction.editReply({
        content: 'Something went wrong. Please try again.',
      });
    }
  }

  /**
   * Ack the interaction. A failed defer is the exact signature of the red
   * "This interaction failed" banner, so it is logged rather than swallowed.
   */
  private async defer(
    interaction: ButtonInteraction,
    tag: string,
  ): Promise<boolean> {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      return true;
    } catch (error) {
      this.logger.warn(
        `Follow-up button defer failed (${tag}): ${errMsg(error)}`,
      );
      return false;
    }
  }

  /** Gate on linked organizer + live event, then dispatch to the handler. */
  private async route(
    interaction: ButtonInteraction,
    parsed: FollowupButtonParsed,
  ): Promise<FollowupOutcome> {
    const user = await findLinkedUser(interaction.user.id, { db: this.db });
    if (!user) {
      await interaction.editReply({ content: LINK_MSG });
      return 'not-linked';
    }
    const event = await lookupFollowupEvent(this.db, parsed.endedEventId);
    if (!event) {
      await interaction.editReply({ content: 'Event not found.' });
      return 'event-not-found';
    }
    if (user.id !== event.creatorId) {
      await interaction.editReply({
        content: 'Only the organizer can do this.',
      });
      return 'not-organizer';
    }
    await this.dispatch(interaction, parsed, event);
    return parsed.action === POST_EVENT_FOLLOWUP_BUTTON_IDS.SCHEDULE
      ? 'schedule'
      : 'poll';
  }

  private dispatch(
    interaction: ButtonInteraction,
    parsed: FollowupButtonParsed,
    event: FollowupInteractionEvent,
  ): Promise<void> {
    if (parsed.action === POST_EVENT_FOLLOWUP_BUTTON_IDS.SCHEDULE) {
      return handleScheduleClick(this.deps, interaction, event);
    }
    return handlePollClick(this.deps, interaction, event);
  }
}
