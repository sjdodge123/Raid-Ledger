/**
 * ROK-1619 AC1/AC3 on the FORUM surface — the `+1` that forms a now-group
 * says so, and the mark is gone once the group has formed.
 *
 * Lives here, not in `lfm-playing.test.ts`, because the board is the ONLY
 * surface that carries a `+1` at all: a text post has no component row
 * (`postText` / `editRow` send the embed only) and a one-hand group is never
 * posted to text (`LFM_FLOOR = 2`). The text-surface version of these checks
 * could never pass — see `TECH-DEBT-BACKLOG.md` (2026-09-22, ROK-1619).
 *
 * Deterministic waits only (`pollForCondition`), no `sleep()`.
 */
import { pollForCondition } from '../helpers/polling.js';
import type { SimpleComponent } from '../helpers/messages.js';
import {
  awaitProcessing,
  postLfgIntent,
  seedFixtureUser,
  type FixtureUser,
} from './fixtures.js';
import { readForumThreads, type ForumThreadSnapshot } from './fixtures-lfg-board.js';
import {
  describeThreads,
  forumId,
  isGroupThread,
  JOIN_CUSTOM_ID,
  readGroup,
  type LfgGroupDetail,
  type Run,
} from './lfg-board-shared.js';

/** `LFG_NOW_SPAWN_BUTTON_LABEL` (`lfg-now-indicator.helpers.ts`). U+00B7. */
export const JOIN_LABEL_SPAWNS = "+1 · I'm in · starts the group";
/**
 * `LFG_NOW_DEFAULT_INDICATOR_EMOJI` — 🎉 (operator ruling 2026-09-22). The
 * smoke env leaves `lfg_now_indicator_emoji` unset, so the default is what the
 * resolver hands `setEmoji`. It rides the button's `emoji` field, NOT the label.
 */
export const DEFAULT_INDICATOR_EMOJI = '🎉';
/** `▸ PLAYING NOW · N in voice` — the spawned (`playing`) author line. */
const PLAYING_AUTHOR = /^▸ PLAYING NOW · \d+ in voice$/u;

/** The join button on a thread's starter message, if it carries one. */
function joinButton(t: ForumThreadSnapshot | null): SimpleComponent | null {
  const components = t?.starterMessage?.components ?? [];
  return components.find((c) => c.customId?.startsWith(`${JOIN_CUSTOM_ID}:`)) ?? null;
}

function describeJoin(join: SimpleComponent | null): string {
  if (!join) return '<no join button>';
  return `label "${join.label ?? 'null'}", emoji ${join.emoji ? `"${join.emoji}"` : '<none>'}`;
}

/** Raise a `now` hand, failing when the group was not where the test needs it. */
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
      `ROK-1619 precondition: expected activeCount ${String(expectedCount)} ` +
        `after a now-hand on "${run.game.name}", got ` +
        `${String(res.group.activeCount)} — the group was not idle`,
    );
  }
  await awaitProcessing(run.ctx.api);
}

/**
 * AC1 — one now-hand short of the threshold, the post's `+1` is the press that
 * forms the group: full label AND the indicator emoji.
 */
async function assertArmed(run: Run): Promise<void> {
  let seen: ForumThreadSnapshot | null = null;
  let all: ForumThreadSnapshot[] = [];
  try {
    await pollForCondition(async () => {
      all = await readForumThreads(forumId(run));
      seen = all.find((t) => isGroupThread(run, t)) ?? null;
      return joinButton(seen)?.label === JOIN_LABEL_SPAWNS ? true : null;
    }, run.ctx.config.timeoutMs);
  } catch {
    throw new Error(
      `ROK-1619 AC1: one now-hand short of the threshold, the board post's +1 ` +
        `must read "${JOIN_LABEL_SPAWNS}" — got ${describeJoin(joinButton(seen))}. ` +
        `Forum threads: ${describeThreads(all)}`,
    );
  }
  const thread = seen as ForumThreadSnapshot | null;
  const join = joinButton(thread);
  if (join?.emoji !== DEFAULT_INDICATOR_EMOJI) {
    throw new Error(
      `ROK-1619 AC1/AC5: the spawning +1 must carry the default indicator ` +
        `emoji "${DEFAULT_INDICATOR_EMOJI}" (lfg_now_indicator_emoji unset) — ` +
        `got ${describeJoin(join)}`,
    );
  }
  run.threadId = thread?.id;
  run.starterMessageId = thread?.starterMessage?.id;
}

/**
 * Fail with "never spawned" when that is the truth, not a poll timeout. The
 * session spawns asynchronously after the second now-hand, so a single read
 * raced it (TECH-DEBT 2026-09-24: `playingNow is null (activeCount=2)`).
 */
async function assertSpawned(run: Run): Promise<void> {
  let group: LfgGroupDetail | null = null;
  try {
    await pollForCondition(async () => {
      group = await readGroup(run.ctx, run.game.id);
      return group.playingNow ? true : null;
    }, run.ctx.config.timeoutMs);
  } catch {
    throw new Error(
      `ROK-1619 AC3 precondition: two now-hands did NOT spawn a session on ` +
        `"${run.game.name}" — playingNow is null ` +
        `(activeCount=${String((group as LfgGroupDetail | null)?.activeCount)})`,
    );
  }
}

/**
 * AC3 — once the session has spawned, the SAME post flips to PLAYING NOW and
 * carries no live `+1` at all ("dropped the indicator" as the stronger claim).
 */
async function assertIndicatorGone(run: Run): Promise<void> {
  let seen: ForumThreadSnapshot | null = null;
  try {
    seen = await pollForCondition(async () => {
      const threads = await readForumThreads(forumId(run));
      const t = threads.find((x) => x.id === run.threadId) ?? null;
      const author = t?.starterMessage?.embeds[0]?.author ?? '';
      return t && PLAYING_AUTHOR.test(author) ? t : null;
    }, run.ctx.config.timeoutMs);
  } catch {
    throw new Error(
      `ROK-1619 AC3 precondition: thread ${run.threadId ?? '?'} never flipped ` +
        `to the PLAYING NOW author line after the spawn`,
    );
  }
  const join = joinButton(seen);
  if (join) {
    throw new Error(
      `ROK-1619 AC3: once the session has spawned the post must carry no live ` +
        `+1 at all, got ${describeJoin(join)} — a card still offering the ` +
        `threshold-crossing press after it was taken is a lie`,
    );
  }
}

/**
 * The whole phase: first now-hand arms the indicator, the second spawns the
 * session and the indicator must be gone. Hands are `run.second` and
 * `run.third` so the suite's shared cleanup withdraws them.
 */
export async function assertSpawnIndicatorLifecycle(run: Run): Promise<void> {
  run.second = await seedFixtureUser(run.ctx.api, 3, 5);
  run.third = await seedFixtureUser(run.ctx.api, 3, 6);
  await raiseNowHand(run, run.second, 1);
  await assertArmed(run);
  await raiseNowHand(run, run.third, null);
  await assertSpawned(run);
  await assertIndicatorGone(run);
}
