/**
 * ROK-1888 — one live Quick Play per game, the unlinked server row, and the
 * "Join Raid Ledger" hint, observed on the real Discord card.
 *
 * Two `game-voice-monitor` bindings on two voice channels share a game G and
 * route their card to one text channel T (Quick Play Announcements(G)).
 *
 *  (a) A join on V1 spawns; a join on V2 JOINS that event — one event id, and
 *      exactly ONE new G card in T (V2 edits V1's card, never posts its own).
 *  (b) An unlinked server player (SteamID, no Raid Ledger account) renders as
 *      `**name** · on server` and is NOT counted: the author line stays at
 *      `2 playing` with three names in the roster.
 *  (c) A Discord-only voice member (no Raid Ledger account) puts the LIVE-only
 *      `[Join Raid Ledger ↗](…/login)` hint on the card; it is absent before.
 *
 * Joins go through the DEMO_MODE seams (`quick-play/voice-join`, which also
 * takes a Discord-only member, and `quick-play/server-join`, which calls the
 * real Pelican presence sink). No voice connection is needed, so CI runs it.
 * Deterministic polling only — no fixed-delay waits.
 */
import { pollForEmbed, snapshotMessageIds } from '../../helpers/polling.js';
import { readLastMessages, type SimpleMessage } from '../../helpers/messages.js';
import { SmokeAssertionError, rosterHasExactly } from '../assert.js';
import {
  quickPlayServerJoin,
  quickPlayVoiceJoin,
  randomUnlinkedSteamId,
  withAdHocEventsEnabled,
} from '../fixtures-quick-play.js';
import {
  assertConditionNeverMet,
  awaitProcessing,
  createBinding,
  deleteBinding,
  deleteEvent,
  seedFixtureUser,
} from '../fixtures.js';
import { QP_PURPOSE, nonPoolFixtures, sweepQuickPlayBindings } from '../quick-play-bindings.js';
import type { DiscordChannel, SmokeTest, TestContext } from '../types.js';
import { must } from './must.js';

const JOIN_HINT = 'Join Raid Ledger ↗](';
const ON_SERVER = ' · on server';

interface Setup {
  game: { id: number; name: string };
  text: DiscordChannel;
  voices: [DiscordChannel, DiscordChannel];
  monitors: [string, string];
}

function pickFixtures(ctx: TestContext, picked: Awaited<ReturnType<typeof nonPoolFixtures>>) {
  const game = picked.freeGames[1] ?? picked.freeGames[0] ?? picked.games[0];
  const text = picked.texts[0];
  const v = ctx.voiceChannels;
  const v1 = v[v.length - 2];
  const v2 = v[v.length - 1];
  if (!game || !text || !v1 || !v2 || v1.id === v2.id) {
    throw new SmokeAssertionError(
      `ROK-1888 needs a game, a non-pool text channel and two voice channels; ` +
        `got game=${String(game?.id)} text=${String(text?.id)} voices=${String(v.length)}`,
    );
  }
  return { game, text, voices: [v1, v2] as [DiscordChannel, DiscordChannel] };
}

async function bindAll(ctx: TestContext, ids: string[]): Promise<Setup> {
  const { game, text, voices } = pickFixtures(ctx, await nonPoolFixtures(ctx));
  await sweepQuickPlayBindings(ctx.api, game.id);
  const bind = async (opts: Parameters<typeof createBinding>[1]) => {
    try {
      const id = await createBinding(ctx.api, opts);
      ids.push(id); // claimed before any assertion so teardown always sees it
      return id;
    } catch (err) {
      throw new Error(
        `[qp-1888] fixture precondition failed: ${opts.purpose} on ${opts.channelId}: ` +
          `${(err as Error).message}`,
      );
    }
  };
  await bind({ channelId: text.id, channelType: 'text', purpose: QP_PURPOSE, gameId: game.id });
  const monitor = (ch: DiscordChannel) =>
    bind({
      channelId: ch.id,
      channelType: 'voice',
      purpose: 'game-voice-monitor',
      gameId: game.id,
      config: { minPlayers: 1, notificationChannelId: text.id },
    });
  const monitors: [string, string] = [await monitor(voices[0]), await monitor(voices[1])];
  return { game, text, voices, monitors };
}

const isGameCard = (gameName: string) => (m: SimpleMessage) =>
  m.embeds.some((e) => /Quick Play/.test(e.author ?? '') && (e.title ?? '').includes(gameName));

/** The G card in T, once `extra` holds for its embed (polls through edits). */
async function cardWhere(
  ctx: TestContext,
  s: Setup,
  before: ReadonlySet<string>,
  extra: (author: string, desc: string) => boolean,
  expectation: string,
): Promise<SimpleMessage> {
  const match = (m: SimpleMessage) =>
    isGameCard(s.game.name)(m) &&
    m.embeds.some((e) => extra(e.author ?? '', e.description ?? ''));
  try {
    return await pollForEmbed(s.text.id, match, ctx.config.timeoutMs, { excludeIds: before });
  } catch (err) {
    const cards = (await readLastMessages(s.text.id, 10)).filter(isGameCard(s.game.name));
    const seen = cards.flatMap((m) => m.embeds.map((e) => `${e.author ?? ''} | ${e.description ?? ''}`));
    throw new SmokeAssertionError(
      `${expectation} — never observed. Cards now: ${JSON.stringify(seen)} ` +
        `(underlying: ${(err as Error).message})`,
    );
  }
}

/** (a) V1 spawns, V2 joins the SAME event, and T holds exactly one G card. */
async function crossChannelJoin(ctx: TestContext, s: Setup, users: number[], before: ReadonlySet<string>) {
  const join = (i: 0 | 1) =>
    quickPlayVoiceJoin(ctx.api, {
      userId: must(users[i], `fixture user ${String(i)}`),
      bindingId: s.monitors[i],
      channelId: s.voices[i].id,
    });
  const a = await join(0);
  if (!a.spawned || a.eventId === null) {
    throw new Error(`V1 voice-join did not spawn (reason=${a.reason ?? 'none'})`);
  }
  const b = await join(1);
  if (b.eventId !== a.eventId) {
    throw new SmokeAssertionError(
      `(a) a join on V2 must JOIN the live Quick Play ${String(a.eventId)} for the same game, ` +
        `got event ${String(b.eventId)} (one live Quick Play per game)`,
    );
  }
  await cardWhere(ctx, s, before, (au, d) => / 2 playing/.test(au) && rosterHasExactly(d, 2),
    '(a) one G card listing both voice members, author "2 playing"');
  await awaitProcessing(ctx.api);
  await assertConditionNeverMet(
    async () => (await readLastMessages(s.text.id, 25)).filter(
      (m) => !before.has(m.id) && isGameCard(s.game.name)(m)).length > 1,
    15_000,
    `(a) expected exactly ONE ${s.game.name} card in #${s.text.name}; V2 posted its own`,
  );
  return a.eventId;
}

/** (b) the unlinked server row renders with its suffix and is not counted. */
async function unlinkedServerRow(ctx: TestContext, s: Setup, eventId: number, before: ReadonlySet<string>) {
  const name = `Srv${String(Date.now()).slice(-5)}`;
  const res = await quickPlayServerJoin(ctx.api, {
    gameId: s.game.id,
    steamId: randomUnlinkedSteamId(),
    displayName: name,
  });
  if (res.eventId !== eventId) {
    throw new SmokeAssertionError(`(b) server-join attached to ${String(res.eventId)}, expected ${String(eventId)}`);
  }
  const card = await cardWhere(ctx, s, before, (_au, d) => d.includes(`**${name}**${ON_SERVER}`),
    `(b) the card renders the unlinked server player as "**${name}**${ON_SERVER}"`);
  const embed = must(card.embeds.find((e) => (e.description ?? '').includes(name)), 'the G card embed');
  if (!/ 2 playing/.test(embed.author ?? '') || !rosterHasExactly(embed.description ?? '', 3)) {
    throw new SmokeAssertionError(
      `(b) an unlinked server player must be listed but NOT counted: expected author "2 playing" ` +
        `and 3 roster names, got author "${embed.author ?? ''}" / "${embed.description ?? ''}"`,
    );
  }
  if ((embed.description ?? '').includes(JOIN_HINT)) {
    throw new SmokeAssertionError('(b) the join hint must stay off while every voice member is linked');
  }
}

/** (c) a Discord-only voice member puts the LIVE join hint on the card. */
async function discordOnlyHint(ctx: TestContext, s: Setup, eventId: number, before: ReadonlySet<string>) {
  const res = await quickPlayVoiceJoin(ctx.api, {
    discordOnly: { discordUserId: `18880${String(Date.now()).slice(-13)}`, displayName: 'NoAccount' },
    bindingId: s.monitors[1],
    channelId: s.voices[1].id,
  });
  if (res.eventId !== eventId) {
    throw new SmokeAssertionError(`(c) Discord-only join landed on ${String(res.eventId)}, expected ${String(eventId)}`);
  }
  await cardWhere(ctx, s, before,
    (au, d) => / 3 playing/.test(au) && d.includes(JOIN_HINT) && d.includes('/login)'),
    '(c) a Discord-only member is counted ("3 playing") and the card shows "[Join Raid Ledger ↗](…/login)"');
}

const onePerGameAcrossChannels: SmokeTest = {
  name: 'ROK-1888: one Quick Play per game across voice channels; unlinked server row; join hint',
  category: 'voice',
  async run(ctx) {
    const ids: string[] = [];
    let eventId: number | null = null;
    try {
      const s = await bindAll(ctx, ids);
      // Slots 6/7, as quick-play-announcements: voice tests run after the pool.
      const users = [(await seedFixtureUser(ctx.api, 3, 6)).userId, (await seedFixtureUser(ctx.api, 3, 7)).userId];
      await withAdHocEventsEnabled(ctx.api, async () => {
        const before = await snapshotMessageIds(s.text.id);
        eventId = await crossChannelJoin(ctx, s, users, before);
        await unlinkedServerRow(ctx, s, eventId, before);
        await discordOnlyHint(ctx, s, eventId, before);
      });
    } finally {
      if (eventId !== null) await deleteEvent(ctx.api, eventId).catch(() => {});
      for (const id of ids) await deleteBinding(ctx.api, id).catch(() => {});
    }
  },
};

export const quickPlayOnePerGameTests: SmokeTest[] = [onePerGameAcrossChannels];
