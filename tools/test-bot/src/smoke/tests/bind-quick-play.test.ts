/**
 * ROK-1768 — `/bind purpose:Quick Play Announcements` from Discord.
 *
 * Drives the real `/bind` handler through the DEMO_MODE slash-command harness
 * (a bot cannot run another bot's slash command) and checks what the operator
 * would observe: the success reply titled `… → Quick Play Announcements ·
 * <game>`, the row the admin API lists, and the refusal naming the channel
 * that already holds the game's Quick Play binding when the same game is bound
 * on a second channel.
 *
 * Uses two existing non-default, non-pool text channels — no new channels
 * (ROK-1623). Deterministic polling only — no fixed-delay waits.
 */
import { pollForCondition } from '../../helpers/polling.js';
import { SmokeAssertionError } from '../assert.js';
import { assertBindSucceeded, type BindReply } from '../bind-reply.js';
import { deleteBinding } from '../fixtures.js';
import type { ApiClient } from '../api.js';
import type { DiscordChannel, SmokeTest, TestContext } from '../types.js';

const QP_PURPOSE = 'quick-play-announcements';
/** Discord channel type for a guild text channel. */
const GUILD_TEXT = 0;

interface BindingRow {
  id: string;
  channelId: string;
  bindingPurpose: string;
  gameId: number | null;
}

interface Picked {
  game: { id: number; name: string };
  first: DiscordChannel;
  second: DiscordChannel;
}

/**
 * The SECOND game without a channel-pool binding (ROK-1766's smoke takes the
 * first, and Quick Play allows one channel per game), plus the LAST two text
 * channels that are neither the default nor a pool channel (ROK-1766 takes
 * the first two).
 */
async function pickChannels(ctx: TestContext): Promise<Picked> {
  const pool = ctx.channelPool ?? [];
  const poolGames = new Set(pool.map((s) => s.gameId));
  const poolChannels = new Set(pool.map((s) => s.channelId));
  const res = await ctx.api.get<{ data: { id: number; name: string }[] }>(
    '/admin/settings/games?limit=25',
  );
  const free = res.data.filter((g) => !poolGames.has(g.id));
  const game = free[1] ?? free[0];
  const texts = ctx.textChannels.filter(
    (c) => c.id !== ctx.defaultChannelId && !poolChannels.has(c.id),
  );
  const [second, first] = texts.slice(-2);
  if (!game || !first || !second) {
    throw new SmokeAssertionError(
      `ROK-1768 needs a non-pool game and two non-default non-pool text ` +
        `channels; got game=${String(game?.id)} texts=${String(texts.length)}`,
    );
  }
  return { game, first, second };
}

async function listBindings(api: ApiClient): Promise<BindingRow[]> {
  const res = await api.get<{ data: BindingRow[] }>('/admin/discord/bindings');
  return Array.isArray(res) ? (res as BindingRow[]) : (res.data ?? []);
}

async function quickPlayRows(api: ApiClient, gameId: number): Promise<BindingRow[]> {
  const rows = await listBindings(api);
  return rows.filter((r) => r.bindingPurpose === QP_PURPOSE && r.gameId === gameId);
}

/** Drop every QP(G) row — a crashed earlier run, or this run's teardown. */
async function sweepQuickPlayBindings(api: ApiClient, gameId: number) {
  for (const row of await quickPlayRows(api, gameId)) {
    await deleteBinding(api, row.id);
  }
}

/** `/bind channel:<ch> game:<game> purpose:Quick Play Announcements`. */
function bindQuickPlay(
  ctx: TestContext,
  channel: DiscordChannel,
  gameName: string,
): Promise<BindReply> {
  return ctx.api.post<BindReply>('/admin/test/slash-command', {
    commandName: 'bind',
    options: {
      channel: { id: channel.id, type: GUILD_TEXT },
      game: gameName,
      purpose: QP_PURPOSE,
    },
    discordUserId: ctx.operatorDiscordId,
    guildId: ctx.config.guildId,
    channelId: channel.id,
  });
}

/** The success embed's title carries the purpose label AND ` · <game>`. */
function assertQuickPlayTitle(res: BindReply, p: Picked): void {
  const want = `Quick Play Announcements · ${p.game.name}`;
  const titles = (res.embeds ?? []).map((e) => e.title ?? '');
  if (!titles.some((t) => t.includes(want))) {
    throw new SmokeAssertionError(
      `/bind QP reply title must contain "${want}", got ${JSON.stringify(titles)}`,
    );
  }
}

/** Wait for the admin API to list exactly the QP(G) row on `first`. */
async function awaitQuickPlayRow(ctx: TestContext, p: Picked): Promise<BindingRow> {
  const rows = await pollForCondition(
    async () => {
      const qp = await quickPlayRows(ctx.api, p.game.id);
      return qp.length > 0 ? qp : null;
    },
    ctx.config.timeoutMs,
    { intervalMs: 1000, backoff: false },
  ).catch(() => [] as BindingRow[]);
  const row = rows[0];
  if (rows.length !== 1 || row?.channelId !== p.first.id) {
    throw new SmokeAssertionError(
      `Expected one Quick Play row for ${p.game.name} on #${p.first.name} ` +
        `(${p.first.id}), got ${JSON.stringify(rows)}`,
    );
  }
  return row;
}

/** A second channel for the same game is refused, naming the first one. */
async function assertSecondBindRefused(ctx: TestContext, p: Picked): Promise<void> {
  const res = await bindQuickPlay(ctx, p.second, p.game.name);
  const mention = `<#${p.first.id}>`;
  if (!(res.content ?? '').includes(mention)) {
    throw new SmokeAssertionError(
      `Second QP /bind for ${p.game.name} must refuse naming ${mention}, ` +
        `got ${JSON.stringify(res)}`,
    );
  }
  const rows = await quickPlayRows(ctx.api, p.game.id);
  if (rows.length !== 1 || rows[0]?.channelId !== p.first.id) {
    throw new SmokeAssertionError(
      `Refused QP /bind must leave only the #${p.first.name} row, got ` +
        JSON.stringify(rows),
    );
  }
}

const bindQuickPlayFromDiscord: SmokeTest = {
  name: 'ROK-1768: /bind purpose binds a text channel as Quick Play Announcements',
  category: 'command',
  // Serial: it sweeps the game's QP rows, which nothing else may hold mid-run.
  serial: true,
  async run(ctx) {
    const p = await pickChannels(ctx);
    await sweepQuickPlayBindings(ctx.api, p.game.id);
    try {
      const res = await bindQuickPlay(ctx, p.first, p.game.name);
      assertBindSucceeded(res, `QP #${p.first.id} game "${p.game.name}"`);
      assertQuickPlayTitle(res, p);
      await awaitQuickPlayRow(ctx, p);
      await assertSecondBindRefused(ctx, p);
    } finally {
      // Ids come from the API, so a refused or half-run bind still cleans up.
      await sweepQuickPlayBindings(ctx.api, p.game.id).catch(() => {});
    }
  },
};

export const bindQuickPlayTests: SmokeTest[] = [bindQuickPlayFromDiscord];
