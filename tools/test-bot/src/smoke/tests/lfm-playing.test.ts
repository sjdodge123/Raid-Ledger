/**
 * ROK-1494 AC7 — the LFM post while the group is PLAYING NOW.
 *
 * Two now-hands spawn a session (`LfgNowSpawnService`), and from that moment
 * the post is not a group advert any more: its author line is
 * `▸ PLAYING NOW · N in voice` and its description carries the temp voice
 * channel. This test drives the ONE thing no unit test can prove — that the
 * head-count is live: a seeded, Discord-linked human is recorded joining the
 * session's voice channel, the post must go up by one, they leave, and the
 * post must come back down.
 *
 * The join goes through `POST /admin/test/lfg-now/voice-join|leave`
 * (`fixtures-lfg-now.ts`), which calls the voice listener's own
 * `recordLfgNowVoiceJoin` / `recordLfgNowVoiceLeave`. It used to be the
 * companion bot's real `joinVoice`, which could never move the count: the join
 * dispatch drops bot members before the roster (`isBotMember`,
 * `voice-state-join-dispatch.handlers.ts`), and CI cannot open a voice
 * connection at all — so the test was gated off everywhere it ran.
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
 * Deterministic helpers only: `pollForEmbed`, `waitForEmbedUpdate`, plus
 * `await-processing` / `flush-voice-sessions` drains. No `sleep()` anywhere
 * (`npm run lint:no-sleep`).
 *
 * Every string it asserts is quoted from
 * `api/src/discord-bot/lfm/lfm-embed.helpers.ts` (`stateAuthorLine`,
 * `playingDescription`) rather than guessed.
 */
import { pollForEmbed, waitForEmbedUpdate } from '../../helpers/polling.js';
import { readLastMessages } from '../../helpers/messages.js';
import {
  endLfgSession,
  lfgNowVoiceJoin,
  lfgNowVoiceLeave,
  type LfgNowVoiceResult,
  type LfgNowVoiceTarget,
} from '../fixtures-lfg-now.js';
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
import { lfmCandidates } from '../lfg-smoke-scope.js';
import { armForumSweep, sweepForumThreads } from '../lfg-forum-sweep.js';

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
 * the channel id the seeded user is recorded joining.
 */
const VOICE_LINK = /https:\/\/discord\.com\/channels\/\d+\/(\d+)/u;

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
  // ROK-1522: the shared LFM window, past the board's and the newest games.
  const candidates = lfmCandidates(res.data ?? []);
  if (candidates.length === 0) throw new Error('AC7: no games in the registry');
  for (const game of candidates) {
    const group = await ctx.api.get<LfgGroupSummary>(`/lfg/${game.id}`);
    // A game with a live session is NOT idle even at `activeCount === 0` — the
    // spawn converts every intent while its `lfg_group_messages` row stays
    // open, and `uq_lfg_group_messages_game_open` allows only that one. This
    // run would then edit the earlier group's post instead of posting its own.
    if (group.activeCount === 0 && !group.playingNow) return game;
  }
  throw new Error(
    `AC7: no idle game among ${candidates.length} candidates — clear the LFG ` +
      'intents (and any live LFG-born session) before re-running',
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
/*
 * ROK-1523 blast-radius note. Disabling the board no longer only changes where
 * FUTURE posts land — it now RETIRES every open forum row in the guild
 * (farewell edit, archive, closed row). Two things keep that safe here:
 *
 *  1. this test runs inside `withLfgSurface`, so the only other tests that can
 *    own a forum row (`lfg-board`, `lfm-embed`) are serialised behind it and
 *    have already cleaned theirs up;
 *  2. the retire pass filters on `post_kind = 'forum'`, and every group posted
 *    while the board is OFF is a TEXT row — which is every group any other
 *    smoke category owns, since only `lfg-board.test.ts` ever turns it on.
 *
 * The PUT is also deterministic now: the controller `emitAsync`s and awaits the
 * toggle listener, so when it answers the retire pass has already finished.
 * Restoring `boardWas` in `finally` therefore hands the next lock holder a
 * settled board, not one mid-retirement.
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
 * @returns The spawned event's id, which every voice record must land on.
 */
async function assertSpawned(run: Run): Promise<number> {
  const group = await run.ctx.api.get<LfgGroupSummary>(
    `/lfg/${run.game.id}`,
  );
  if (!group.playingNow) {
    throw new Error(
      `AC7: two now-hands did NOT spawn a session on "${run.game.name}" — ` +
        `playingNow is null (activeCount=${group.activeCount}, ` +
        `nowCount=${(group as { nowCount?: number }).nowCount ?? '?'}). ` +
        'The post is not the problem; nothing was spawned to post about.',
    );
  }
  return group.playingNow.eventId;
}

/**
 * Fail unless a voice record landed on the spawned event.
 *
 * `recorded: false` means no OPEN LFG-born event owns the channel the post
 * links — the head-count poll after it would then time out on a join that
 * never happened, which reads as a re-render bug it is not.
 */
function assertRecorded(
  res: LfgNowVoiceResult,
  action: 'join' | 'leave',
  target: LfgNowVoiceTarget,
  eventId: number,
): void {
  if (res.recorded && res.eventId === eventId) return;
  throw new Error(
    `AC7 ${action}: expected voice-${action} for user ${target.userId} on ` +
      `channel ${target.channelId} to be recorded against spawned event ` +
      `${eventId}, got recorded=${res.recorded} eventId=${res.eventId ?? 'null'}`,
  );
}

/**
 * AC7's delta: a seeded human joins and the count goes up; leaves, back down.
 *
 * The joiner is one of the two now-hands — the real flow, someone who asked to
 * play walking into the channel. The spawn signs them up (`event_signups`) but
 * writes no `ad_hoc_participants` row, so this join is a fresh roster row and
 * fires the PARTICIPANT_JOINED that re-renders the post. ONE join and ONE leave
 * per run: a re-join updates the existing row and does not re-announce.
 */
async function driveHeadCount(
  run: Run,
  joiner: FixtureUser,
  eventId: number,
  playing: { voiceChannelId: string; count: number },
): Promise<void> {
  const target = { userId: joiner.userId, channelId: playing.voiceChannelId };
  // Claimed BEFORE the call: the leave is idempotent, and a join that wrote
  // its row and then failed must still have that row closed.
  let open = true;
  try {
    const joined = await lfgNowVoiceJoin(run.ctx.api, target);
    assertRecorded(joined, 'join', target, eventId);
    await awaitHeadCount(run, playing.count + 1, 'AC7 join');
    const left = await lfgNowVoiceLeave(run.ctx.api, target);
    open = false;
    assertRecorded(left, 'leave', target, eventId);
    await awaitHeadCount(run, playing.count, 'AC7 leave');
  } finally {
    // An open roster row reads as "still in voice" to the session lifecycle.
    // Swallowed so a cleanup error never replaces the test's real failure.
    if (open) await lfgNowVoiceLeave(run.ctx.api, target).catch(() => null);
  }
}

/*
 * ROK-1619 AC1/AC3 (the spawn indicator on the +1) used to be asserted here and
 * could never pass: this test pins the board OFF, a one-hand group is never
 * posted to TEXT, and text posts carry no buttons. Both checks now live on the
 * forum surface — `lfg-board.test.ts` / `lfg-board-spawn-indicator-phase.ts`.
 */

/**
 * Tear down the session this run spawned, if any (a no-op when none was).
 *
 * The ephemeral reaper only deletes the `⏰ … — Playing now` channel 30 min
 * after the session ends, and a CI run's API and DB are gone long before
 * that. Drained afterwards so the post's closing re-render lands before the
 * binding it routes through is deleted. Errors are reported, not thrown, so a
 * cleanup failure never replaces the test's real one.
 */
async function endSpawnedSession(run: Run): Promise<void> {
  try {
    await endLfgSession(run.ctx.api, run.game.id);
    await awaitProcessing(run.ctx.api);
  } catch (err) {
    console.warn(
      `[lfm-playing] end-session cleanup failed for game ${run.game.id} — ` +
        `its temp voice channel may be orphaned: ${String(err)}`,
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
  // ROK-1522: armed BEFORE the board is pinned off, so a hand that still
  // reached the forum is swept too.
  const sweep = await armForumSweep(ctx.api, game.name);
  let bindingId: string | undefined;
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
    await awaitProcessing(ctx.api);
    await raiseNowHand(run, run.second, null);
    await awaitProcessing(ctx.api);

    // Separate "never spawned" from "spawned but posted out of view".
    const eventId = await assertSpawned(run);

    const playing = await awaitPlayingPost(run);
    // Closes its own roster row in its own `finally`.
    await driveHeadCount(run, run.first, eventId, playing);
  } finally {
    // FIRST, while the binding still routes the post's closing re-render:
    // ends the spawned session and force-destroys its temp voice channel,
    // which a CI run would otherwise orphan in the shared guild.
    await endSpawnedSession(run);
    // After a spawn both intents are already `converted`, so these 404 —
    // `withdrawLfgIntent` swallows that by design. They matter on the failure
    // path, where the spawn never happened and the hands are still live.
    if (run.first) await withdrawLfgIntent(run.first.api, run.game.id);
    if (run.second) await withdrawLfgIntent(run.second.api, run.game.id);
    if (bindingId) await deleteBinding(ctx.api, bindingId);
    // Restore the toggle for whichever LFM test holds the surface lock next.
    if (boardWas !== undefined) await pinLfgBoard(ctx, boardWas);
    // Last: after the restore, so a re-enable's repost is caught as well.
    await sweepForumThreads(ctx.api, sweep);
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

/**
 * NOT gated on `SMOKE_SKIP_VOICE_JOIN`. The head-count is driven through the
 * DEMO_MODE voice-join/leave endpoints, not a UDP voice connection, so the
 * test needs nothing a GitHub runner lacks and runs in CI like every other
 * embed test. `voice-activity.test.ts` and `series-dual-binding.test.ts` still
 * gate their REAL voice joins — only this test's gate is gone.
 */
export const lfmPlayingTests: SmokeTest[] = [lfmEmbedPlayingNow];
