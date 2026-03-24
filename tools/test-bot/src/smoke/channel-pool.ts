/**
 * Channel pool setup/teardown for smoke test isolation.
 * Creates game→channel bindings so embed tests can distribute
 * across multiple Discord channels instead of sharing one.
 */
import type { ApiClient } from './api.js';
import type { DiscordChannel, ChannelSlot } from './types.js';
import { createBinding, deleteBinding } from './fixtures.js';

interface GameEntry {
  id: number;
  name: string;
}

/** Fetch all games from admin API for binding creation. */
async function fetchGames(api: ApiClient): Promise<GameEntry[]> {
  try {
    const res = await api.get<{ data: GameEntry[] }>('/admin/games');
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
  // Use non-default channels for the pool
  const poolChannels = textChannels.filter((ch) => ch.id !== defaultChannelId);

  if (poolGames.length === 0 || poolChannels.length === 0) {
    console.log('  Channel pool: not enough games or channels, skipping');
    return [];
  }

  const slotCount = Math.min(poolGames.length, poolChannels.length);
  const pool: ChannelSlot[] = [];

  for (let i = 0; i < slotCount; i++) {
    try {
      const bindingId = await createBinding(api, {
        channelId: poolChannels[i].id,
        channelType: 'text',
        purpose: 'notification',
        gameId: poolGames[i].id,
      });
      pool.push({
        gameId: poolGames[i].id,
        channelId: poolChannels[i].id,
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
      console.warn(`  Channel pool: failed to delete binding ${slot.bindingId}:`, err);
    }
  }
  if (pool.length > 0) {
    console.log(`  Channel pool: ${pool.length} bindings cleaned up`);
  }
}
