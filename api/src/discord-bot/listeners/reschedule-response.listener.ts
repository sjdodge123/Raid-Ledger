import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { eq, and } from 'drizzle-orm';
import {
  MessageFlags,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type Interaction,
} from 'discord.js';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { SignupsService } from '../../events/signups.service';
import { CharactersService } from '../../characters/characters.service';
import {
  DISCORD_BOT_EVENTS,
  RESCHEDULE_BUTTON_IDS,
} from '../discord-bot.constants';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { EmbedSyncQueueService } from '../queues/embed-sync.queue';
import { DiscordEmojiService } from '../services/discord-emoji.service';
import type { EventRow, RescheduleDeps } from './reschedule-response.helpers';
import {
  isRescheduleAction,
  isSelectAction,
  parseRoleSelectParts,
  editDmEmbed,
  editDmEmbedFromSelect,
  safeEditReply,
} from './reschedule-response.helpers';
import {
  handleLinkedConfirm,
  handleUnlinkedConfirm,
  handleLinkedTentative,
  handleUnlinkedTentative,
} from './reschedule-confirm.handlers';
import {
  handleCharacterSelect as doCharSelect,
  handleRoleSelect as doRoleSelect,
  type SelectCtx,
} from './reschedule-roster.handlers';

/**
 * Handles Confirm / Decline button interactions on reschedule DMs (ROK-537).
 */
@Injectable()
export class RescheduleResponseListener {
  private readonly logger = new Logger(RescheduleResponseListener.name);
  private boundHandler: ((interaction: Interaction) => void) | null = null;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly signupsService: SignupsService,
    private readonly charactersService: CharactersService,
    private readonly embedSyncQueue: EmbedSyncQueueService,
    private readonly emojiService: DiscordEmojiService,
  ) {}

  private get deps(): RescheduleDeps {
    return {
      db: this.db,
      signupsService: this.signupsService,
      charactersService: this.charactersService,
      embedSyncQueue: this.embedSyncQueue,
      emojiService: this.emojiService,
      logger: this.logger,
    };
  }

  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  onBotConnected(): void {
    const client = this.clientService.getClient();
    if (!client) return;
    if (this.boundHandler) {
      client.removeListener('interactionCreate', this.boundHandler);
    }
    this.boundHandler = (interaction: Interaction) => {
      if (interaction.isButton())
        void this.handleButtonInteraction(interaction);
      else if (interaction.isStringSelectMenu())
        void this.handleSelectMenuInteraction(interaction);
    };
    client.on('interactionCreate', this.boundHandler);
    this.logger.log('Registered reschedule response interaction handler');
  }

  private async handleButtonInteraction(i: ButtonInteraction): Promise<void> {
    const parts = i.customId.split(':');
    if (parts.length !== 2) return;
    const [action, idStr] = parts;
    const eventId = parseInt(idStr, 10);
    if (isNaN(eventId) || !isRescheduleAction(action)) return;
    try {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
    } catch {
      return;
    }
    try {
      await this.routeButton(action, i, eventId);
    } catch (error) {
      this.logger.error('Reschedule error event %d:', eventId, error);
      await safeEditReply(i, {
        content: 'Something went wrong. Please try again.',
      });
    }
  }

  private async routeButton(
    action: string,
    interaction: ButtonInteraction,
    eventId: number,
  ): Promise<void> {
    if (action === RESCHEDULE_BUTTON_IDS.CONFIRM) {
      await this.handleConfirm(interaction, eventId);
    } else if (action === RESCHEDULE_BUTTON_IDS.TENTATIVE) {
      await this.handleTentative(interaction, eventId);
    } else {
      await this.handleDecline(interaction, eventId);
    }
  }

  private async handleConfirm(
    i: ButtonInteraction,
    eventId: number,
  ): Promise<void> {
    const v = await this.validateSignup(i, eventId);
    if (!v) return;
    const linkedUser = await this.findLinkedUser(i.user.id);
    const ctx = {
      deps: this.deps,
      interaction: i,
      event: v.event,
      editDm: this.makeDmEdit(),
    };
    if (linkedUser) await handleLinkedConfirm(ctx, linkedUser);
    else await handleUnlinkedConfirm(ctx);
  }

  private async handleTentative(
    i: ButtonInteraction,
    eventId: number,
  ): Promise<void> {
    const v = await this.validateSignup(i, eventId);
    if (!v) return;
    const linkedUser = await this.findLinkedUser(i.user.id);
    const ctx = {
      deps: this.deps,
      interaction: i,
      event: v.event,
      editDm: this.makeDmEdit(),
    };
    if (linkedUser) await handleLinkedTentative(ctx, linkedUser);
    else await handleUnlinkedTentative(ctx);
  }

  private async handleDecline(
    i: ButtonInteraction,
    eventId: number,
  ): Promise<void> {
    const v = await this.validateSignup(i, eventId);
    if (!v) return;
    await this.db
      .update(schema.eventSignups)
      .set({ status: 'declined', roachedOutAt: null })
      .where(eq(schema.eventSignups.id, v.signup.id));
    await this.db
      .delete(schema.rosterAssignments)
      .where(
        and(
          eq(schema.rosterAssignments.eventId, eventId),
          eq(schema.rosterAssignments.signupId, v.signup.id),
        ),
      );
    await i.editReply({
      content: `You've been removed from **${v.event.title}**. No worries!`,
    });
    await editDmEmbed(i, 'declined', this.logger);
    await this.embedSyncQueue.enqueue(eventId, 'reschedule-decline');
  }

  private async handleSelectMenuInteraction(
    i: StringSelectMenuInteraction,
  ): Promise<void> {
    const parts = i.customId.split(':');
    if (parts.length < 2 || parts.length > 4) return;
    const [action, idStr] = parts;
    const eventId = parseInt(idStr, 10);
    if (isNaN(eventId) || !isSelectAction(action)) return;
    try {
      await i.deferUpdate();
    } catch {
      return;
    }
    try {
      if (action === RESCHEDULE_BUTTON_IDS.CHARACTER_SELECT) {
        const status =
          parts[2] === 'tentative' ? ('tentative' as const) : undefined;
        await this.handleCharacterSelect(i, eventId, status);
      } else {
        const { characterId, signupStatus } = parseRoleSelectParts(parts);
        await this.handleRoleSelect(i, eventId, characterId, signupStatus);
      }
    } catch (error) {
      this.logger.error('Select error event %d:', eventId, error);
      await safeEditReply(i, {
        content: 'Something went wrong. Please try again.',
        components: [],
      });
    }
  }

  private makeSelectCtx(
    i: StringSelectMenuInteraction,
    eventId: number,
  ): SelectCtx {
    return {
      deps: this.deps,
      interaction: i,
      eventId,
      lookupEvent: this.lookupEvent.bind(this),
      editDm: this.makeSelectDmEdit(),
    };
  }

  private async handleCharacterSelect(
    i: StringSelectMenuInteraction,
    eventId: number,
    signupStatus?: 'tentative',
  ): Promise<void> {
    await doCharSelect(this.makeSelectCtx(i, eventId), signupStatus);
  }

  private async handleRoleSelect(
    i: StringSelectMenuInteraction,
    eventId: number,
    characterId?: string,
    signupStatus?: 'tentative',
  ): Promise<void> {
    await doRoleSelect(
      this.makeSelectCtx(i, eventId),
      characterId,
      signupStatus,
    );
  }

  private async validateSignup(
    i: ButtonInteraction,
    eventId: number,
  ): Promise<{ event: EventRow; signup: { id: number } } | null> {
    const event = await this.lookupEvent(eventId);
    if (!event) {
      await i.editReply({ content: 'Event not found.' });
      return null;
    }
    if (event.cancelledAt) {
      await i.editReply({ content: 'This event has been cancelled.' });
      return null;
    }
    const signup = await this.signupsService.findByDiscordUser(
      eventId,
      i.user.id,
    );
    if (!signup) {
      await i.editReply({ content: "You're not signed up for this event." });
      return null;
    }
    return { event, signup };
  }

  private async lookupEvent(eventId: number): Promise<EventRow | null> {
    const [event] = await this.db
      .select({
        id: schema.events.id,
        title: schema.events.title,
        cancelledAt: schema.events.cancelledAt,
        gameId: schema.events.gameId,
        slotConfig: schema.events.slotConfig,
      })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    return event ?? null;
  }

  private async findLinkedUser(
    discordId: string,
  ): Promise<{ id: number } | null> {
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.discordId, discordId))
      .limit(1);
    return user ?? null;
  }

  private makeDmEdit() {
    const logger = this.logger;
    return (i: ButtonInteraction, s: 'confirmed' | 'tentative' | 'declined') =>
      editDmEmbed(i, s, logger);
  }

  private makeSelectDmEdit() {
    const logger = this.logger;
    return (
      i: StringSelectMenuInteraction,
      s: 'confirmed' | 'tentative' | 'declined',
    ) => editDmEmbedFromSelect(i, s, logger);
  }
}
