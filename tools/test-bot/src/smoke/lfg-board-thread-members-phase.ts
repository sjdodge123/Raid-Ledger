/**
 * ROK-1541 — the thread-membership phase of the LFG board smoke.
 *
 * A player who joins a group becomes a member of the group's forum thread (so
 * the post shows in their Discord sidebar); withdrawing takes them back out.
 *
 * Only a REAL guild member can be added to a thread, and every fixture user
 * carries a synthetic `smoke-invitee-fixture-00N` id that the API filters out
 * as unlinked. So the joiner here is a fixture user temporarily linked to the
 * COMPANION BOT's snowflake — the one real member the smoke owns — and the
 * link is handed back to the DM recipient (and the fixture's own id restored)
 * in `finally`, because later categories DM that recipient.
 *
 * Membership is read through `GET /admin/test/lfg-board/thread-members` (the
 * API bot lists it; the companion lacks the GuildMembers intent). Every wait
 * is a poll on that read — never a sleep.
 */
import { pollForCondition } from '../helpers/polling.js';
import {
  awaitProcessing,
  linkDiscord,
  postLfgIntent,
  seedFixtureUser,
  withdrawLfgIntent,
  type FixtureUser,
} from './fixtures.js';
import type { Run } from './lfg-board-shared.js';

/** Unused by every other smoke (lfg-board 3/4, lfm-playing 5/6, invite 5). */
const JOINER_SLOT = 7;
/** `fixtureIdentity(7).username` — restored with the fixture's own id. */
const JOINER_USERNAME = 'smoke-invitee-fixture-7';
/** The name `setup()` links the companion snowflake under. */
const DM_RECIPIENT_NAME = 'SmokeTestBot';

interface ThreadMembers {
  threadId: string | null;
  memberIds: string[];
}

function readMembers(run: Run): Promise<ThreadMembers> {
  return run.ctx.api.get<ThreadMembers>(
    `/admin/test/lfg-board/thread-members?gameId=${String(run.game.id)}`,
  );
}

/**
 * Poll until the post's thread does (or no longer does) hold the companion.
 *
 * @param run - The active run, with a live post.
 * @param present - Whether the companion must be IN the thread.
 * @param failure - What the timeout means, quoted with the last read.
 */
async function pollMembership(
  run: Run,
  present: boolean,
  failure: string,
): Promise<void> {
  const botId = run.ctx.testBotDiscordId;
  let last: ThreadMembers | null = null;
  try {
    await pollForCondition(async () => {
      last = await readMembers(run);
      const inThread = last.memberIds.includes(botId);
      return last.threadId === run.threadId && inThread === present
        ? true
        : null;
    }, run.ctx.config.timeoutMs);
  } catch {
    throw new Error(
      `${failure} (companion ${botId}, expected thread ` +
        `${run.threadId ?? '?'}; last read ${JSON.stringify(last)})`,
    );
  }
}

/**
 * ROK-1541 AC1 / AC2 — join adds the joiner to the thread, withdraw removes.
 *
 * Runs with a LIVE post and leaves the group's hand count as it found it.
 *
 * @param run - The active run.
 */
export async function assertThreadMembersFollowGroup(run: Run): Promise<void> {
  const joiner = await seedFixtureUser(run.ctx.api, 3, JOINER_SLOT);
  try {
    await linkDiscord(
      run.ctx.api,
      joiner.userId,
      run.ctx.testBotDiscordId,
      DM_RECIPIENT_NAME,
    );
    await postLfgIntent(joiner.api, run.game.id);
    await awaitProcessing(run.ctx.api);
    await pollMembership(
      run,
      true,
      `ROK-1541 AC1: joining "${run.game.name}" must add the joiner to the ` +
        `group's forum thread`,
    );
    await joiner.api.delete(`/lfg/${String(run.game.id)}`);
    await awaitProcessing(run.ctx.api);
    await pollMembership(
      run,
      false,
      `ROK-1541 AC2: withdrawing from "${run.game.name}" must remove the ` +
        `withdrawer from the group's forum thread`,
    );
  } finally {
    await restoreLinks(run, joiner);
  }
}

/** Hand the companion snowflake back to the DM recipient. Never throws. */
async function restoreLinks(run: Run, joiner: FixtureUser): Promise<void> {
  await withdrawLfgIntent(joiner.api, run.game.id);
  const { api, dmRecipientUserId, testBotDiscordId } = run.ctx;
  await linkDiscord(api, dmRecipientUserId, testBotDiscordId, DM_RECIPIENT_NAME)
    .then(() =>
      linkDiscord(api, joiner.userId, joiner.discordId, JOINER_USERNAME),
    )
    .catch((err: unknown) => {
      console.log(
        `  [lfg-board] could not restore the companion link: ${String(err)}`,
      );
    });
}
