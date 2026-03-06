import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { ButtonInteraction } from 'discord.js';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { NotificationService } from '../../notifications/notification.service';
import { SignupsService } from '../../events/signups.service';
import {
  DISCORD_BOT_EVENTS,
  DEPARTURE_PROMOTE_BUTTON_IDS,
} from '../discord-bot.constants';
import { DiscordBotClientService } from '../discord-bot-client.service';
import {
  editDMResult,
  findFirstBenchPlayer,
  notifyPromotedPlayer,
  emitPromoteEvent,
  buildPromoteResultText,
  type DeparturePromoteDeps,
} from './departure-promote.handlers';

/**
 * Handles "Promote from Bench" / "Leave Empty" button interactions
 * on the departure DMs sent to event creators (ROK-596).
 */
@Injectable()
export class DeparturePromoteListener {
  private readonly logger = new Logger(DeparturePromoteListener.name);
  private boundHandler:
    | ((interaction: import('discord.js').Interaction) => void)
    | null = null;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly notificationService: NotificationService,
    private readonly signupsService: SignupsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private get deps(): DeparturePromoteDeps {
    return {
      db: this.db,
      notificationService: this.notificationService,
      signupsService: this.signupsService,
      eventEmitter: this.eventEmitter,
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
    this.boundHandler = (interaction: import('discord.js').Interaction) => {
      if (interaction.isButton()) {
        void this.handleButtonInteraction(interaction);
      }
    };
    client.on('interactionCreate', this.boundHandler);
    this.logger.log('Registered departure promote interaction handler');
  }

  /** Route button interactions to promote or dismiss. */
  async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const parsed = parseDepartureButton(interaction.customId);
    if (!parsed) return;
    try {
      await interaction.deferUpdate();
    } catch (error) {
      this.logger.warn('Failed to defer departure promote: %s', error);
      return;
    }
    await this.routeDepartureAction(interaction, parsed);
  }

  private async routeDepartureAction(
    interaction: ButtonInteraction,
    parsed: DepartureButtonParsed,
  ): Promise<void> {
    try {
      if (parsed.action === DEPARTURE_PROMOTE_BUTTON_IDS.PROMOTE) {
        await this.handlePromote(interaction, parsed.eventId);
      } else {
        await this.handleDismiss(
          interaction,
          parsed.eventId,
          parsed.role,
          parsed.position,
        );
      }
    } catch (error) {
      this.logger.error(
        'Error handling departure promote for event %d:',
        parsed.eventId,
        error,
      );
      await editDMResult(
        interaction,
        'Something went wrong.',
        undefined,
        this.logger,
      );
    }
  }

  /** Promote a bench player using the role calculation engine. */
  async handlePromote(
    interaction: ButtonInteraction,
    eventId: number,
  ): Promise<void> {
    const benchPlayer = await findFirstBenchPlayer(this.deps, eventId);
    if (!benchPlayer) {
      await editDMResult(
        interaction,
        'No bench players available.',
        undefined,
        this.logger,
      );
      return;
    }
    const result = await this.signupsService.promoteFromBench(
      eventId,
      benchPlayer.signupId,
    );
    if (!result || result.role === 'bench') {
      const msg =
        result?.warning ??
        'Could not find a suitable roster slot for the bench player.';
      await editDMResult(interaction, msg, undefined, this.logger);
      return;
    }
    await this.finalizePromotion(interaction, eventId, benchPlayer, result);
  }

  private async finalizePromotion(
    interaction: ButtonInteraction,
    eventId: number,
    benchPlayer: { signupId: number; userId: number | null },
    result: {
      username: string;
      role: string;
      position: number;
      warning?: string;
    },
  ): Promise<void> {
    this.logger.log(
      `Creator promoted ${result.username} (signup ${benchPlayer.signupId}) to ${result.role}:${result.position} for event ${eventId}`,
    );
    await notifyPromotedPlayer(this.deps, eventId, benchPlayer, result);
    emitPromoteEvent(this.deps, eventId, benchPlayer);
    await editDMResult(
      interaction,
      buildPromoteResultText(result),
      eventId,
      this.logger,
    );
  }

  /** Dismiss -- leave the slot empty, edit DM to confirm. */
  async handleDismiss(
    interaction: ButtonInteraction,
    eventId: number,
    vacatedRole: string,
    vacatedPosition: number,
  ): Promise<void> {
    await editDMResult(
      interaction,
      `Slot left empty (**${vacatedRole}** position ${vacatedPosition}).`,
      eventId,
      this.logger,
    );
  }
}

interface DepartureButtonParsed {
  action: string;
  eventId: number;
  role: string;
  position: number;
}

/** Parse a departure promote/dismiss button custom ID. */
function parseDepartureButton(customId: string): DepartureButtonParsed | null {
  const parts = customId.split(':');
  if (parts.length !== 4) return null;
  const [action, eventIdStr, role, positionStr] = parts;
  const eventId = parseInt(eventIdStr, 10);
  const position = parseInt(positionStr, 10);
  if (isNaN(eventId) || isNaN(position)) return null;
  const isDeparture =
    action === DEPARTURE_PROMOTE_BUTTON_IDS.PROMOTE ||
    action === DEPARTURE_PROMOTE_BUTTON_IDS.DISMISS;
  if (!isDeparture) return null;
  return { action, eventId, role, position };
}
