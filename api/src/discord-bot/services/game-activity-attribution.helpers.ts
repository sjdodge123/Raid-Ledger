import type { Logger } from '@nestjs/common';
import type { GameActivityAttributionAdapter } from '../../plugins/plugin-host/extension-points';
import type { SessionOpenEvent } from './game-activity.helpers';

/**
 * ROK-2259 — let plugin-owned adapters re-attribute each opened session to the
 * game the player actually plays (e.g. WoW: Forever reported by Discord as
 * "World of Warcraft Classic"). Adapters of an inactive plugin are suspended by
 * the registry, so an empty list keeps today's name-only resolution.
 *
 * Stamps `attributedGameId` only when an adapter changed the game; an adapter
 * that throws leaves the registry game in place.
 */
export async function attributeOpenSessions(
  opens: SessionOpenEvent[],
  cache: Map<string, number | null>,
  adapters: readonly GameActivityAttributionAdapter[],
  logger: Logger,
): Promise<void> {
  if (adapters.length === 0) return;
  for (const ev of opens) {
    const base = cache.get(ev.discordActivityName);
    if (base === undefined || base === null) continue;
    try {
      let gameId = base;
      for (const adapter of adapters) {
        gameId = await adapter.attribute(ev.userId, gameId);
      }
      if (gameId !== base) ev.attributedGameId = gameId;
    } catch (err) {
      logger.warn(
        `Game attribution failed for user ${ev.userId} / "${ev.discordActivityName}": ${String(err)}`,
      );
    }
  }
}
