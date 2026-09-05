/**
 * ROK-1454 D3 — which channel an LFM group's message belongs in.
 *
 * There is deliberately NO configurable LFM channel. The round-1
 * `DISCORD_BOT_LFM_CHANNEL` setting, its admin controller and its selector were
 * removed as superseded: the operator ruled 2026-09-03 that channel
 * configuration belongs to ROK-1471, which layers a forum binding on top of
 * this chain as a new step 0 without moving anything below it.
 *
 * The order is the same binding → default order
 * `ChannelResolverService.resolveChannelForEvent` uses, so there is no new
 * concept for an admin to learn. Structured as a free function over a `deps`
 * bag rather than a service so it is testable without a Nest module and so the
 * consumer (`LfmEmbedService`) owns the only injection site.
 */

/** The Nest services `resolveLfmChannel` reads, narrowed to what it calls. */
export interface LfmChannelDeps {
  clientService: { getGuildId(): string | null };
  channelBindings: {
    getChannelForGame(guildId: string, gameId: number): Promise<string | null>;
  };
  settingsService: { getDiscordBotDefaultChannel(): Promise<string | null> };
  logger: { warn(message: string): void };
}

/** Where an LFM message goes, and the guild the row records it under. */
export interface LfmChannelTarget {
  guildId: string;
  channelId: string;
}

/**
 * Resolve the channel an LFM group's message should be posted to.
 *
 * Two steps plus a floor: (1) the game's own `game-announcements` binding,
 * (2) the bot's default text channel, (3) neither — warn and skip.
 *
 * The floor NEVER throws. This runs inside an `@OnEvent` handler, and an
 * unroutable message must not propagate back into whatever emitted the
 * transition.
 *
 * A missing guild also skips: `lfg_group_messages.guild_id` is NOT NULL, so a
 * channel with no guild to record it under is not a usable target. In practice
 * unreachable — the consumer returns early unless `clientService.isConnected()`
 * — but it is the honest answer rather than a fabricated empty string.
 *
 * @param deps - Client, bindings, settings and the caller's logger.
 * @param gameId - The `games` PK whose group is being announced.
 * @returns The guild + channel to post in, or null to skip posting.
 */
export async function resolveLfmChannel(
  deps: LfmChannelDeps,
  gameId: number,
): Promise<LfmChannelTarget | null> {
  const guildId = deps.clientService.getGuildId();
  if (!guildId) {
    deps.logger.warn(
      `Skipping LFM message for game ${String(gameId)}: no guild is available.`,
    );
    return null;
  }

  const bound = await deps.channelBindings.getChannelForGame(guildId, gameId);
  if (bound) return { guildId, channelId: bound };

  const fallback = await deps.settingsService.getDiscordBotDefaultChannel();
  if (fallback) return { guildId, channelId: fallback };

  deps.logger.warn(
    `No Discord channel for LFM game ${String(gameId)}. ` +
      'Bind one with /bind or set a default channel in the Discord bot settings.',
  );
  return null;
}
