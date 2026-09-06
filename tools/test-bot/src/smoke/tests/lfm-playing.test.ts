/**
 * ROK-1494 AC7 — the LFM post while the group is PLAYING NOW.
 *
 * Two now-hands spawn a session (`LfgNowSpawnService`), and from that moment
 * the post is not a group advert any more: its author line is
 * `▸ PLAYING NOW · N in voice` and its description carries the temp voice
 * channel. This test drives the ONE thing no unit test can prove — that the
 * head-count is live: the companion bot joins the real voice channel, the post
 * must go up by one, it leaves, and the post must come back down.
 *
 * Why the baseline is READ rather than asserted as a constant: whether the two
 * now-hands are already ad-hoc participants at spawn time is Lane A's
 * `autoSignupParticipant` decision, and this test is about the DELTA. Pinning
 * "0 in voice" would make it fail on a design choice it is not testing, and
 * pinning "2" would pass on a frozen count that never moved.
 *
 * The failure of the whole story — `TERMINAL_STATE.playing` closing the row —
 * shows up here as the join never landing, which is why the increment and the
 * decrement are asserted separately and each names the count it saw.
 *
 * Deterministic helpers only: `pollForEmbed`, `waitForEmbedUpdate`,
 * `pollForCondition`, plus `await-processing` / `flush-voice-sessions` drains.
 * No `sleep()` anywhere (`npm run lint:no-sleep`).
 */
import {
  pollForCondition,
  pollForEmbed,
  waitForEmbedUpdate,
} from '../../helpers/polling.js';
import { readLastMessages } from '../../helpers/messages.js';
import { joinVoice, leaveVoice } from '../../helpers/voice.js';
import { getGuild } from '../../client.js';
import {
  awaitProcessing,
  createBinding,
  deleteBinding,
  flushVoiceSessions,
  postLfgIntent,
  seedFixtureUser,
  withdrawLfgIntent,
  type FixtureUser,
  type LfgGroupSummary,
} from '../fixtures.js';
import type { SmokeTest, TestContext } from '../types.js';
import type { SimpleEmbed, SimpleMessage } from '../../helpers/messages.js';
import { withLfgSurface } from '../lfg-surface-lock.js';

/** `▸ PLAYING NOW · N in voice` — the sixth state's author line (D3). */
const PLAYING_AUTHOR = /^▸ PLAYING NOW · (\d+) in voice$/u;
/** The temp voice channel, as the description masks it. */
const VOICE_LINK = /https:\/\/discord\.com\/channels\/\d+\/(\d+)/u;
/** How many games to probe for an idle one before giving up. */
const GAME_SCAN_LIMIT = 8;

/** Everything the phases share. */
interface Run {
  ctx: TestContext;
  channelId: string;
  game: { id: number; name: string };
  first?: FixtureUser;
  second?: FixtureUser;
  /** Message ids already in the channel — the channel is shared across runs. */
  preexisting: Set<string>;
}

/** Only messages this run could have produced. */
function isNew(run: Run, msg: SimpleMessage): boolean {
  return !run.preexisting.has(msg.id);
}

/** The game-titled embed on a message, or a failure naming what was there. */
function embedFor(msg: SimpleMessage, title: string): SimpleEmbed {
  const embed = msg.embeds.find((e) => e.title === title);
  if (!embed) {
    const titles = msg.embeds.map((e) => e.title).join(', ');
    throw new Error(
      `AC7: message ${msg.id} carries no embed titled "${title}" (titles: [${titles}])`,
    );
  }
  return embed;
}

/** The head-count off a PLAYING NOW author line, or a failure naming it. */
function headCount(embed: SimpleEmbed, label: string): number {
  const match = PLAYING_AUTHOR.exec(embed.author ?? '');
  if (!match) {
    throw new Error(
      `${label}: expected an author line matching ${String(PLAYING_AUTHOR)}, ` +
        `got "${embed.author ?? ''}"`,
    );
  }
  return Number(match[1]);
}

/** A game nobody is currently looking for — scanned from the registry's end. */
async function pickIdleGame(
  ctx: TestContext,
): Promise<{ id: number; name: string }> {
  const res = await ctx.api.get<{ data: { id: number; name: string }[] }>(
    '/admin/settings/games?limit=100',
  );
  const candidates = (res.data ?? [])
    .slice()
    .reverse()
    .slice(0, GAME_SCAN_LIMIT);
  for (const game of candidates) {
    const group = await ctx.api.get<LfgGroupSummary>(`/lfg/${game.id}`);
    if (group.activeCount === 0) return game;
  }
  throw new Error(
    `AC7: no idle game among ${candidates.length} candidates — clear the LFG ` +
      'intents before re-running',
  );
}

/** One `now` hand, asserting the group is the one this run is driving. */
async function raiseNowHand(
  run: Run,
  user: FixtureUser,
  expectedCount: number,
): Promise<void> {
  const res = await postLfgIntent(user.api, run.game.id, {
    urgency: 'now',
    ttlMinutes: 60,
  });
  if (res.group.activeCount !== expectedCount) {
    throw new Error(
      `AC7 precondition: expected activeCount ${expectedCount} after a ` +
        `now-hand on "${run.game.name}", got ${res.group.activeCount} — the ` +
        'group was not idle, so every assertion below is about someone else',
    );
  }
}

/** Wait until the post flips to PLAYING NOW, and hand back its voice channel. */
async function awaitPlayingPost(
  run: Run,
): Promise<{ embed: SimpleEmbed; voiceChannelId: string; count: number }> {
  const msg = await pollForEmbed(
    run.channelId,
    (m) =>
      isNew(run, m) &&
      m.embeds.some(
        (e) =>
          e.title === run.game.name && PLAYING_AUTHOR.test(e.author ?? ''),
      ),
    run.ctx.config.timeoutMs,
  );
  const embed = embedFor(msg, run.game.name);
  const link = VOICE_LINK.exec(embed.description ?? '');
  if (!link) {
    throw new Error(
      'AC7: the PLAYING NOW post carries no voice-channel link — expected a ' +
        `description matching ${String(VOICE_LINK)}, got ` +
        `"${embed.description ?? ''}"`,
    );
  }
  return { embed, voiceChannelId: link[1], count: headCount(embed, 'AC7') };
}

/** Wait for the head-count to reach `expected`, naming what it actually read. */
async function awaitHeadCount(
  run: Run,
  expected: number,
  label: string,
): Promise<void> {
  await flushVoiceSessions(run.ctx.api);
  await awaitProcessing(run.ctx.api);
  let seen = '<no PLAYING NOW post>';
  try {
    await waitForEmbedUpdate(
      run.channelId,
      (m) =>
        isNew(run, m) &&
        m.embeds.some((e) => {
          if (e.title !== run.game.name) return false;
          const match = PLAYING_AUTHOR.exec(e.author ?? '');
          if (match) seen = e.author ?? '';
          return match !== null && Number(match[1]) === expected;
        }),
      run.ctx.config.timeoutMs,
    );
  } catch {
    throw new Error(
      `${label}: expected the author line to read "${expected} in voice", ` +
        `last rendered "${seen}"`,
    );
  }
}

/** The channel must be in the gateway cache before the bot can join it. */
async function awaitChannelInCache(channelId: string): Promise<void> {
  await pollForCondition(
    () => Promise.resolve(getGuild().channels.cache.has(channelId)),
    30_000,
  );
}

/** AC7 proper: join moves the count up, leave moves it back down. */
async function runPlayingNow(ctx: TestContext): Promise<void> {
  const game = await pickIdleGame(ctx);
  const preexisting = new Set(
    (await readLastMessages(ctx.defaultChannelId, 100)).map((m) => m.id),
  );
  const run: Run = { ctx, channelId: ctx.defaultChannelId, game, preexisting };
  let bindingId: string | undefined;
  let joined = false;
  try {
    bindingId = await createBinding(ctx.api, {
      channelId: run.channelId,
      channelType: 'text',
      purpose: 'game-announcements',
      gameId: game.id,
    });
    run.first = await seedFixtureUser(ctx.api, 3, 5);
    run.second = await seedFixtureUser(ctx.api, 3, 6);
    await raiseNowHand(run, run.first, 1);
    await raiseNowHand(run, run.second, 2);
    await awaitProcessing(ctx.api);

    const playing = await awaitPlayingPost(run);
    await awaitChannelInCache(playing.voiceChannelId);

    await joinVoice(playing.voiceChannelId);
    joined = true;
    await awaitHeadCount(run, playing.count + 1, 'AC7 join');

    leaveVoice();
    joined = false;
    await awaitHeadCount(run, playing.count, 'AC7 leave');
  } finally {
    if (joined) leaveVoice();
    if (run.first) await withdrawLfgIntent(run.first.api, run.game.id);
    if (run.second) await withdrawLfgIntent(run.second.api, run.game.id);
    if (bindingId) await deleteBinding(ctx.api, bindingId);
  }
}

const lfmEmbedPlayingNow: SmokeTest = {
  name: 'LFM embed: a spawned now-group renders PLAYING NOW with a live head-count',
  category: 'embed',
  // The same global board toggle every other LFM test contends for.
  run(ctx) {
    return withLfgSurface('lfm-playing', () => runPlayingNow(ctx));
  },
};

export const lfmPlayingTests: SmokeTest[] = [lfmEmbedPlayingNow];
