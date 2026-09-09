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
 *
 * CANNOT GO GREEN ON `rok-1494-discord` ALONE. This branch carries only the
 * RENDER of `playing` — nothing on it emits `GROUP_CHANGED { reason:
 * 'playing' }`, because the spawn service and the voice-state re-render are
 * Lane A's, on `rok-1494`. Until the two merge, `awaitPlayingPost` times out
 * at the poll rather than at an assertion, which is exactly the "proves
 * nothing" failure mode — so do NOT read a red run here as a defect in the
 * render. Every string it asserts is quoted from
 * `api/src/discord-bot/lfm/lfm-embed.helpers.ts` (`stateAuthorLine`,
 * `playingDescription`) rather than guessed, so the first post-merge run is
 * the first run whose result means anything.
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

/**
 * `▸ PLAYING NOW · N in voice` — the sixth state's author line (D3).
 *
 * ANCHORED at both ends on purpose. `▸` is `OPEN`, `·` is `SEP`, and
 * `PLAYING NOW` is `LFG_BOARD_TAGS[5]`; the chrome puts `authorLine` into the
 * author slot verbatim (`embed-chrome.helpers.ts:145`, `opts.authorLine ||
 * community`), so there is no prefix to allow for. The `🔥 ` that ROK-1479
 * prepends to a now-group is NOT here — `isNowGroup` returns false for any
 * state other than `open`, and a spawned group is `playing`. If a post-merge
 * run fails on the anchor with a fire emoji in the actual, the regression is
 * `isNowGroup`, not this pattern.
 */
const PLAYING_AUTHOR = /^▸ PLAYING NOW · (\d+) in voice$/u;
/**
 * The temp voice channel, as `playingDescription` masks it —
 * `[Join voice ↗](https://discord.com/channels/<guild>/<channel>)`. Matched
 * unanchored so the mask's brackets do not have to be modelled; the capture is
 * the channel id the companion bot joins.
 */
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
  if (candidates.length === 0) throw new Error('AC7: no games in the registry');
  for (const game of candidates) {
    const group = await ctx.api.get<LfgGroupSummary>(`/lfg/${game.id}`);
    if (group.activeCount === 0) return game;
  }
  throw new Error(
    `AC7: no idle game among ${candidates.length} candidates — clear the LFG ` +
      'intents before re-running',
  );
}

/**
 * One `now` hand on this run's game.
 *
 * `expectedCount` is checked only when given. It is given for the FIRST hand,
 * where `activeCount === 1` is the precondition that this run owns the group
 * and every assertion below is about its own post. It is deliberately NOT
 * given for the second: that hand is the one that trips the spawn, and whether
 * the echoed `activeCount` then reads 2 (the spawn converts on the event) or 0
 * (it converts inside the same request) is Lane A's transaction boundary, not
 * something AC7 is testing. Pinning it would make this test fail on a design
 * choice; the thing that actually proves the group spawned is the PLAYING NOW
 * post, which is asserted next.
 */
async function raiseNowHand(
  run: Run,
  user: FixtureUser,
  expectedCount: number | null,
): Promise<void> {
  const res = await postLfgIntent(user.api, run.game.id, {
    urgency: 'now',
    ttlMinutes: 60,
  });
  if (expectedCount !== null && res.group.activeCount !== expectedCount) {
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
  // Round-2 TECH-DEBT: a bare poll timeout named no author line, so three
  // rounds of this gate could not tell "never rendered" from "painted over".
  let seen = '<no post for this game>';
  const msg = await pollForEmbed(
    run.channelId,
    (m) =>
      isNew(run, m) &&
      m.embeds.some((e) => {
        if (e.title !== run.game.name) return false;
        seen = e.author ?? '';
        return PLAYING_AUTHOR.test(seen);
      }),
    run.ctx.config.timeoutMs,
  ).catch((err: unknown) => {
    // Only the WAIT expiring means "it never rendered" — restating a gateway
    // error as a render failure would hide the real cause.
    const text = err instanceof Error ? err.message : String(err);
    if (!text.includes('timed out')) throw err;
    throw new Error(
      `AC7: no PLAYING NOW post — expected an author line matching ` +
        `${String(PLAYING_AUTHOR)}, last rendered "${seen}"`,
    );
  });
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
  } catch (err) {
    // Only the WAIT expiring means "the count never moved". A render-rule
    // violation or a gateway error rejects here too, and restating it as a
    // head-count failure would hide the real cause behind a wrong diagnosis —
    // the same masking `waitForEmbedUpdate` itself was fixed to avoid.
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('timed out')) throw err;
    throw new Error(
      `${label}: expected the author line to read "${expected} in voice", ` +
        `last rendered "${seen}"`,
    );
  }
}

/**
 * The channel must be in the gateway cache before the bot can join it.
 *
 * `joinVoice` goes through `getVoiceChannel`, which reads the cache and throws
 * on a miss — and the temp channel is created by the API mid-spawn, so the
 * `channelCreate` gateway event can land after the post does.
 */
async function awaitChannelInCache(
  channelId: string,
  timeoutMs: number,
): Promise<void> {
  await pollForCondition(
    () => Promise.resolve(getGuild().channels.cache.has(channelId)),
    timeoutMs,
  );
}

/**
 * Pin the board toggle for the duration of this test, returning its prior value.
 *
 * `withLfgSurface` only SERIALISES the global toggle — it never sets it, so
 * this test inherited whatever the previous test left behind. It binds a TEXT
 * `game-announcements` channel and polls that channel, but
 * `resolveLfgBoardSurface` routes the post to the FORUM whenever the master
 * toggle is on, where this poll can never see it. The post then renders
 * perfectly and the test reports "no post for this game" — which is exactly
 * what happened on 2026-09-09 (post `1547083906535399535` carried
 * `▸ PLAYING NOW · 0 in voice` while the run went red).
 *
 * @param ctx - Test context, for the admin API client.
 * @param enabled - The state to pin.
 * @returns The toggle's value before this call, to restore in `finally`.
 */
async function pinLfgBoard(ctx: TestContext, enabled: boolean): Promise<boolean> {
  const before = await ctx.api.get<{ enabled: boolean }>(
    '/admin/settings/discord-bot/lfg-board',
  );
  if (before.enabled !== enabled) {
    await ctx.api.put('/admin/settings/discord-bot/lfg-board', { enabled });
  }
  return before.enabled;
}

/**
 * Fail with "the spawn never happened" when that is the truth.
 *
 * Without this, a group that never reached two now-hands is indistinguishable
 * from a post that rendered somewhere unwatched: both surface as the poll in
 * {@link awaitPlayingPost} expiring with "no post for this game". Reading the
 * group first makes the two failures name themselves, which is the whole point
 * of an assertion that has to survive a red run being triaged by someone else.
 *
 * @param run - The active run.
 */
async function assertSpawned(run: Run): Promise<void> {
  const group = await run.ctx.api.get<LfgGroupSummary & {
    playingNow?: { eventId: number; voiceChannelId: string | null } | null;
  }>(`/lfg/${run.game.id}`);
  if (!group.playingNow) {
    throw new Error(
      `AC7: two now-hands did NOT spawn a session on "${run.game.name}" — ` +
        `playingNow is null (activeCount=${group.activeCount}, ` +
        `nowCount=${(group as { nowCount?: number }).nowCount ?? '?'}). ` +
        'The post is not the problem; nothing was spawned to post about.',
    );
  }
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
  let boardWas: boolean | undefined;
  try {
    // Deterministic surface: this test polls a TEXT channel, so the board must
    // be OFF or the post lands in the forum and the poll is blind to it.
    boardWas = await pinLfgBoard(ctx, false);
    bindingId = await createBinding(ctx.api, {
      channelId: run.channelId,
      channelType: 'text',
      purpose: 'game-announcements',
      gameId: game.id,
    });
    run.first = await seedFixtureUser(ctx.api, 3, 5);
    run.second = await seedFixtureUser(ctx.api, 3, 6);
    await raiseNowHand(run, run.first, 1);
    await raiseNowHand(run, run.second, null);
    await awaitProcessing(ctx.api);

    // Separate "never spawned" from "spawned but posted out of view".
    await assertSpawned(run);

    const playing = await awaitPlayingPost(run);
    await awaitChannelInCache(playing.voiceChannelId, ctx.config.timeoutMs);

    await joinVoice(playing.voiceChannelId);
    joined = true;
    await awaitHeadCount(run, playing.count + 1, 'AC7 join');

    leaveVoice();
    joined = false;
    await awaitHeadCount(run, playing.count, 'AC7 leave');
  } finally {
    // Voice FIRST: a bot left connected to a channel the next cleanup step may
    // delete wedges the gateway for every later voice test in this process.
    if (joined) leaveVoice();
    // After a spawn both intents are already `converted`, so these 404 —
    // `withdrawLfgIntent` swallows that by design. They matter on the failure
    // path, where the spawn never happened and the hands are still live.
    if (run.first) await withdrawLfgIntent(run.first.api, run.game.id);
    if (run.second) await withdrawLfgIntent(run.second.api, run.game.id);
    if (bindingId) await deleteBinding(ctx.api, bindingId);
    // Restore the toggle for whichever LFM test holds the surface lock next.
    if (boardWas !== undefined) await pinLfgBoard(ctx, boardWas);
    // NOT cleaned up: the ad-hoc event the spawn created and its temp voice
    // channel. Neither has a fixture on this branch, and the temp channel is
    // reaped by the ephemeral-voice lifecycle that owns it. Left deliberately
    // rather than deleted through a raw API call that would race that reaper.
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
