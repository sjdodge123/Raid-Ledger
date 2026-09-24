/**
 * ROK-1612 AC4/AC5 — routes every `lfgc:*` interaction to its composer step.
 *
 * Without this the pinned card's `Post an LFG` answers "This interaction
 * failed". It binds to the gateway the way `LfgJoinListener` does — the shared
 * `InteractionListener` routes only chat-input and autocomplete — and owns no
 * logic of its own: `lfg-composer-flow.helpers` holds every step.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MessageFlags } from 'discord.js';
import type {
  ButtonInteraction,
  Interaction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { MagicLinkService } from '../../auth/magic-link.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { LfgService } from '../../lfg/lfg.service';
import { SettingsService } from '../../settings/settings.service';
import { DISCORD_BOT_EVENTS } from '../discord-bot.constants';
import { DiscordBotClientService } from '../discord-bot-client.service';
import {
  DiscordListenerBinding,
  gatewayBinding,
} from '../listeners/discord-listener-binding';
import { LFG_COMPOSER_COPY, LFG_COMPOSER_IDS } from './lfg-composer.constants';
import {
  backToComposerCandidates,
  goComposer,
  openComposerModal,
  pickComposerGame,
  submitComposerSearch,
  type ComposerFlowDeps,
} from './lfg-composer-flow.helpers';
import type { Db } from './lfg-composer-search.db-helpers';
import { parseTermCustomId } from './lfg-composer-state.helpers';
import { viewComposerGames } from './lfg-composer-view.helpers';

/**
 * A failure as one token-safe line: message and code, never the error object.
 *
 * A `DiscordAPIError` carries `requestBody` — the components we sent, and so
 * the clicker's magic link — and Nest prints every own property of an object
 * it is handed (ROK-1685 AC4). Same idea as `lfg-composer-pin.service`'s
 * `describe`, plus the Discord code.
 */
function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return 'non-Error rejection';
  const code = (error as { code?: unknown }).code;
  const suffix =
    typeof code === 'string' || typeof code === 'number'
      ? ` (code ${code})`
      : '';
  return `${error.message}${suffix}`;
}

/** A composer interaction discord.js can dispatch. */
type ComposerInteraction =
  ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction;

/** True for any interaction the composer owns — `lfgc:` and nothing else. */
export function isComposerInteraction(
  interaction: Interaction,
): interaction is ComposerInteraction {
  const owned =
    interaction.isButton() ||
    interaction.isStringSelectMenu() ||
    interaction.isModalSubmit();
  return owned && interaction.customId.startsWith('lfgc:');
}

/**
 * Pick the step for one interaction.
 *
 * @param deps - Flow dependencies.
 * @param interaction - A composer-owned interaction.
 * @returns The running step, or null for an id no step owns.
 */
export function routeComposerInteraction(
  deps: ComposerFlowDeps,
  interaction: ComposerInteraction,
): Promise<void> | null {
  const id = interaction.customId;
  if (interaction.isModalSubmit()) {
    return id === LFG_COMPOSER_IDS.MODAL
      ? submitComposerSearch(deps, interaction)
      : null;
  }
  if (interaction.isStringSelectMenu()) {
    return id.startsWith(`${LFG_COMPOSER_IDS.PICK}:`)
      ? pickComposerGame(deps, interaction)
      : null;
  }
  return routeButton(deps, interaction);
}

function routeButton(
  deps: ComposerFlowDeps,
  interaction: ButtonInteraction,
): Promise<void> | null {
  const id = interaction.customId;
  if (id === LFG_COMPOSER_IDS.OPEN) {
    return openComposerModal(deps, interaction, '');
  }
  if (id === LFG_COMPOSER_IDS.VIEW) return viewComposerGames(deps, interaction);
  const back = parseTermCustomId(id, LFG_COMPOSER_IDS.BACK);
  if (back !== null) return openComposerModal(deps, interaction, back);
  if (id.startsWith(`${LFG_COMPOSER_IDS.BACK_TO_CANDIDATES}:`)) {
    return backToComposerCandidates(deps, interaction);
  }
  if (id.startsWith(`${LFG_COMPOSER_IDS.GO}:`)) {
    return goComposer(deps, interaction);
  }
  return null;
}

@Injectable()
export class LfgComposerListener {
  private readonly logger = new Logger(LfgComposerListener.name);
  private readonly binding = new DiscordListenerBinding(
    this.logger,
    'LFG composer interactions',
  );
  private readonly deps: ComposerFlowDeps;

  constructor(
    @Inject(DrizzleAsyncProvider) db: Db,
    private readonly clientService: DiscordBotClientService,
    lfgService: LfgService,
    settingsService: SettingsService,
    magicLinkService: MagicLinkService,
  ) {
    this.deps = { db, lfgService, settingsService, magicLinkService };
  }

  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  onBotConnected(): void {
    this.binding.attachToClient(this.clientService.getClient(), [
      gatewayBinding('interactionCreate', (interaction) => {
        if (isComposerInteraction(interaction)) void this.handle(interaction);
      }),
    ]);
  }

  /** Drop the handler so a reconnect re-attaches to the live client. */
  @OnEvent(DISCORD_BOT_EVENTS.DISCONNECTED)
  onBotDisconnected(): void {
    this.binding.detach();
  }

  /**
   * Run one composer step. Never throws back into the gateway.
   *
   * @param interaction - A composer-owned interaction.
   */
  async handle(interaction: ComposerInteraction): Promise<void> {
    try {
      const step = routeComposerInteraction(this.deps, interaction);
      await (step ?? this.stale(interaction));
    } catch (error) {
      this.logger.error(
        `LFG composer step ${interaction.customId} failed: ${describeFailure(error)}`,
      );
      await this.fail(interaction);
    }
  }

  /** An `lfgc:*` id no step owns — a card from an older build. */
  private async stale(interaction: ComposerInteraction): Promise<void> {
    await interaction.reply({
      content: LFG_COMPOSER_COPY.STALE_REPLY,
      flags: MessageFlags.Ephemeral,
    });
  }

  /** The generic apology — edited in when acknowledged, replied otherwise. */
  private async fail(interaction: ComposerInteraction): Promise<void> {
    const content = LFG_COMPOSER_COPY.FAILED_REPLY;
    const sent =
      interaction.deferred || interaction.replied
        ? interaction.editReply({ content, components: [] })
        : interaction.reply({ content, flags: MessageFlags.Ephemeral });
    await sent.catch(() => {
      this.logger.warn('Could not deliver the LFG composer failure reply.');
    });
  }
}
