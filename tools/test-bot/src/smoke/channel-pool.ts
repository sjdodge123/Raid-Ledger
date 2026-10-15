/**
 * Channel pool setup/teardown for smoke test isolation.
 * Creates game→channel bindings so embed tests can distribute
 * across multiple Discord channels instead of sharing one.
 */
import type { ApiClient } from "./api.js";
import type { DiscordChannel, ChannelSlot } from "./types.js";
import { createBinding, deleteBinding } from "./fixtures.js";
import { poolCandidateChannels } from "./join-post-channel.js";

interface GameEntry {
  id: number;
  name: string;
}

/** Fetch all games from admin API for binding creation. */
async function fetchGames(api: ApiClient): Promise<GameEntry[]> {
  try {
    const res = await api.get<{ data: GameEntry[] }>("/admin/games");
    return Array.isArray(res.data) ? res.data : [];
  } catch {
    return [];
  }
}

/**
 * Create game→text channel bindings for test isolation.
 * Uses non-default text channels and assigns one game per channel.
 * Returns an empty pool if insufficient games or channels.
 */
export async function setupChannelPool(
  api: ApiClient,
  textChannels: DiscordChannel[],
  defaultChannelId: string,
): Promise<ChannelSlot[]> {
  const poolGames = await fetchGames(api);
  // Non-default channels, minus the one reserved for the join post (ROK-1740)
  const poolChannels = poolCandidateChannels(textChannels, defaultChannelId);

  if (poolGames.length === 0 || poolChannels.length === 0) {
    console.log("  Channel pool: not enough games or channels, skipping");
    return [];
  }

  const slotCount = Math.min(poolGames.length, poolChannels.length);
  const pool: ChannelSlot[] = [];

  for (let i = 0; i < slotCount; i++) {
    const game = poolGames[i];
    const channel = poolChannels[i];
    if (!game || !channel) {
      // Unreachable: i < min(poolGames.length, poolChannels.length).
      throw new Error(`channel pool slot ${i} missing a game or channel`);
    }
    try {
      const bindingId = await createBinding(api, {
        channelId: channel.id,
        channelType: "text",
        purpose: "notification",
        gameId: game.id,
      });
      pool.push({
        gameId: game.id,
        channelId: channel.id,
        bindingId,
      });
    } catch {
      // Binding may fail if game already has a binding — skip
    }
  }

  console.log(`  Channel pool: ${pool.length} bindings created`);
  return pool;
}

/** Delete all channel bindings created for test isolation. */
export async function teardownChannelPool(
  api: ApiClient,
  pool: ChannelSlot[],
): Promise<void> {
  for (const slot of pool) {
    try {
      await deleteBinding(api, slot.bindingId);
    } catch (err) {
      console.warn(
        `  Channel pool: failed to delete binding ${slot.bindingId}:`,
        err,
      );
    }
  }
  if (pool.length > 0) {
    console.log(`  Channel pool: ${pool.length} bindings cleaned up`);
  }
}
