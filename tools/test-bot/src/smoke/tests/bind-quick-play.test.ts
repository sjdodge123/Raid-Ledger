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
import {
  QP_PURPOSE,
  listBindings,
  nonPoolFixtures,
  quickPlayRows,
  sweepQuickPlayBindings,
  type BindingRow,
} from '../quick-play-bindings.js';
import type { DiscordChannel, SmokeTest, TestContext } from '../types.js';

/** Discord channel type for a guild text channel. */
const GUILD_TEXT = 0;

interface Picked {
  game: { id: number; name: string };
  first: DiscordChannel;
  second: DiscordChannel;
}

/**
 * The SECOND free game (ROK-1766's smoke takes the first, and Quick Play
 * allows one channel per game), plus the LAST two candidate text channels
 * (ROK-1766 takes the first two). A channel that already holds a non-QP
 * binding for that game is never picked: the QP upsert would convert that row
 * and the teardown sweep would then delete a binding this test never made.
 */
async function pickChannels(ctx: TestContext): Promise<Picked> {
  const { freeGames, texts } = await nonPoolFixtures(ctx);
  const game = freeGames[1] ?? freeGames[0];
  const taken = new Set(
    (await listBindings(ctx.api))
      .filter((r) => r.gameId === game?.id && r.bindingPurpose !== QP_PURPOSE)
      .map((r) => r.channelId),
  );
  const usable = texts.filter((c) => !taken.has(c.id));
  const [second, first] = usable.slice(-2);
  if (!game || !first || !second) {
    throw new SmokeAssertionError(
      `ROK-1768 needs a non-pool game and two non-default non-pool text ` +
        `channels with no binding for it; got game=${String(game?.id)} ` +
        `usable=${String(usable.length)}/${String(texts.length)}`,
    );
  }
  return { game, first, second };
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
