import type { EmbedBuilder } from 'discord.js';
import type { SignupInteractionDeps } from './signup-interaction.types';

type ReplyEmbedDeps = Pick<
  SignupInteractionDeps,
  'eventsService' | 'embedFactory' | 'settingsService' | 'logger'
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
    const { embed } = deps.embedFactory.buildEventEmbed(eventData, context);
    return embed;
  } catch {
    return undefined;
  }
}
