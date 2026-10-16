/**
 * Shared helpers for the Quick Play Announcements smokes (ROK-1766 and
 * ROK-1768): one binding-list reader and one candidate set, so the two tests'
 * channel-selection rules cannot drift apart (ROK-1766 takes the FIRST game
 * and the FIRST two channels, ROK-1768 the SECOND game and the LAST two).
 */
import { deleteBinding } from './fixtures.js';
import type { ApiClient } from './api.js';
import type { DiscordChannel, TestContext } from './types.js';

export const QP_PURPOSE = 'quick-play-announcements';

export interface BindingRow {
  id: string;
  channelId: string;
  bindingPurpose: string;
  gameId: number | null;
}

/** Every binding the admin API lists (it answers a bare array or `{ data }`). */
export async function listBindings(api: ApiClient): Promise<BindingRow[]> {
  const res = await api.get<BindingRow[] | { data?: BindingRow[] }>(
    '/admin/discord/bindings',
  );
  return Array.isArray(res) ? res : (res.data ?? []);
}

/** The Quick Play Announcements rows for one game (at most one by design). */
export async function quickPlayRows(
  api: ApiClient,
  gameId: number,
): Promise<BindingRow[]> {
  const rows = await listBindings(api);
  return rows.filter(
    (r) => r.bindingPurpose === QP_PURPOSE && r.gameId === gameId,
  );
}

/** Drop every QP(G) row — a crashed earlier run, or this run's teardown. */
export async function sweepQuickPlayBindings(
  api: ApiClient,
  gameId: number,
): Promise<void> {
  for (const row of await quickPlayRows(api, gameId)) {
    await deleteBinding(api, row.id);
  }
}

export interface NonPoolFixtures {
  /** Every game the settings page lists (first 25). */
  games: { id: number; name: string }[];
  /** Games with no channel-pool binding. */
  freeGames: { id: number; name: string }[];
  /** Text channels that are neither the default nor a pool channel. */
  texts: DiscordChannel[];
}

/**
 * The candidates a Quick Play smoke may pick from: a card routed by the wrong
 * tier (pool or default channel) can never land where an assertion looks.
 */
export async function nonPoolFixtures(ctx: TestContext): Promise<NonPoolFixtures> {
  const pool = ctx.channelPool ?? [];
  const poolGames = new Set(pool.map((s) => s.gameId));
  const poolChannels = new Set(pool.map((s) => s.channelId));
  const res = await ctx.api.get<{ data: { id: number; name: string }[] }>(
    '/admin/settings/games?limit=25',
  );
  return {
    games: res.data,
    freeGames: res.data.filter((g) => !poolGames.has(g.id)),
    texts: ctx.textChannels.filter(
      (c) => c.id !== ctx.defaultChannelId && !poolChannels.has(c.id),
    ),
  };
}
