import type { EmbedBuilder } from 'discord.js';
import type { SignupInteractionDeps } from './signup-interaction.types';
import { withEventHubLink } from '../channel-lifecycle/embed-event-context.helpers';

type ReplyEmbedDeps = Pick<
  SignupInteractionDeps,
  'db' | 'eventsService' | 'embedFactory' | 'settingsService' | 'logger'
>;

/**
 * Build the event embed for inclusion in ephemeral selection replies.
 * Returns undefined on failure so the selection flow can proceed without it.
 */
export async function buildReplyEmbed(
  eventId: number,
  deps: ReplyEmbedDeps,
): Promise<EmbedBuilder | undefined> {
  try {
    const eventData = await deps.eventsService.buildEmbedEventData(eventId);
    const [branding, timezone] = await Promise.all([
      deps.settingsService.getBranding(),
      deps.settingsService.getDefaultTimezone(),
    ]);
    const context = {
      communityName: branding.communityName,
      clientUrl: process.env.CLIENT_URL ?? null,
      timezone,
    };
    // ROK-1895: the reply reuses the card, so it names the tagged hub too.
    const hubCtx = await withEventHubLink(
      deps.db,
      context,
      eventId,
      deps.logger,
    );
    const { embed } = deps.embedFactory.buildEventEmbed(eventData, hubCtx);
    return embed;
  } catch (error) {
    deps.logger.warn(
      `Failed to build reply embed for event ${eventId}: ${error instanceof Error ? error.message : 'Unknown'}`,
    );
    return undefined;
  }
}
