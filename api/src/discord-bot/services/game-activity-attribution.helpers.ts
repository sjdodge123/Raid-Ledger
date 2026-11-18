import type { Logger } from '@nestjs/common';
import type { GameActivityAttributionAdapter } from '../../plugins/plugin-host/extension-points';
import type { SessionOpenEvent } from './game-activity.helpers';

/**
 * ROK-2259 — let plugin-owned adapters re-attribute each opened session to the
 * game the player actually plays (e.g. WoW: Forever reported by Discord as
 * "World of Warcraft Classic"). Adapters of an inactive plugin are suspended by
 * the registry, so an empty list keeps today's name-only resolution.
 *
 * A name that resolved to no game is offered to adapters that implement
 * `attributeUnresolved` (Discord's raw Classic name without a mapping row);
 * every other unresolved name stays uncredited.
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
    const base = cache.get(ev.discordActivityName) ?? null;
    try {
      const gameId =
        base === null
          ? await attributeUnresolved(ev, adapters)
          : await attributeResolved(ev, base, adapters);
      if (gameId !== null && gameId !== base) ev.attributedGameId = gameId;
    } catch (err) {
      logger.warn(
        `Game attribution failed for user ${ev.userId} / "${ev.discordActivityName}": ${String(err)}`,
      );
    }
  }
}

/** Chain every adapter over a session the registry resolved to `base`. */
async function attributeResolved(
  ev: SessionOpenEvent,
  base: number,
  adapters: readonly GameActivityAttributionAdapter[],
): Promise<number> {
  let gameId = base;
  for (const adapter of adapters) {
    gameId = await adapter.attribute(ev.userId, gameId);
  }
  return gameId;
}

/** First adapter that recognises an unresolved raw name wins; else `null`. */
async function attributeUnresolved(
  ev: SessionOpenEvent,
  adapters: readonly GameActivityAttributionAdapter[],
): Promise<number | null> {
  for (const adapter of adapters) {
    if (!adapter.attributeUnresolved) continue;
    const gameId = await adapter.attributeUnresolved(
      ev.userId,
      ev.discordActivityName,
    );
    if (gameId !== null) return gameId;
  }
  return null;
}
