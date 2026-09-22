/**
 * ROK-1612 AC1 (operator ruling 2026-09-22 "pin it") — the composer card is a
 * real Discord pin.
 *
 * On the FORUM surface Discord allows one pinned post per forum, and that slot
 * is the board's intro post. So the composer's `Post an LFG` button rides on
 * the pinned intro post's starter message (`LfgComposerPinService`). This
 * phase asserts both halves of "the operator can see it": the intro post is
 * PINNED, and its starter message carries the composer button.
 *
 * Bots cannot press another bot's button, so the flow behind the button is
 * covered by the api unit tier; this asserts only that the card is there.
 */
import { ChannelFlags, type Message } from "discord.js";
import { getGuild } from "../client.js";
import { pollForCondition } from "../helpers/polling.js";
import {
  readForumThreads,
  setLfgComposerEnabled,
} from "./fixtures-lfg-board.js";
import { forumId, INTRO_TITLE, type Run } from "./lfg-board-shared.js";

/** `LFG_COMPOSER_IDS.OPEN` — the card's `Post an LFG` custom id. */
export const COMPOSER_OPEN_CUSTOM_ID = "lfgc:open";

/** Provisioning + the ENABLED handler are a few Discord round-trips. */
const COMPOSER_READY_MS = 30_000;

/** Every custom id on a message's action rows. */
function customIds(message: Message): string[] {
  return message.components.flatMap((row) =>
    "components" in row && Array.isArray(row.components)
      ? row.components.flatMap((c: { customId?: string | null }) =>
          c.customId ? [c.customId] : [],
        )
      : [],
  );
}

/** What the intro post currently looks like, or null while it is not ready. */
async function readIntro(
  run: Run,
): Promise<{ pinned: boolean; ids: string[] } | null> {
  const intro = (await readForumThreads(forumId(run))).find(
    (t) => t.name === INTRO_TITLE,
  );
  if (!intro) return null;
  const thread = await getGuild().channels.fetch(intro.id);
  if (!thread?.isThread()) return null;
  const starter = await thread.fetchStarterMessage().catch(() => null);
  if (!starter) return null;
  const state = {
    pinned: thread.flags.has(ChannelFlags.Pinned),
    ids: customIds(starter),
  };
  return state.pinned && state.ids.includes(COMPOSER_OPEN_CUSTOM_ID)
    ? state
    : null;
}

/**
 * AC6 — the composer is opt-in (default OFF), so enabling the board alone
 * clears the buttons. Switch it on and check the PUT persisted.
 *
 * @param run - The board run, after `enableBoard`.
 */
export async function enableComposer(run: Run): Promise<void> {
  const put = await setLfgComposerEnabled(run.ctx.api, true);
  if (!put.enabled) {
    throw new Error(
      "ROK-1612 AC6: PUT /admin/settings/discord-bot/lfg-board/composer " +
        `{enabled:true} answered { enabled: ${String(put.enabled)} }`,
    );
  }
}

/** AC6 cleanup — back to the default so later tests see no card. */
export async function disableComposer(run: Run): Promise<void> {
  await setLfgComposerEnabled(run.ctx.api, false).catch((err: unknown) => {
    console.log(
      `  [lfg-board] could not disable the composer in cleanup: ${String(err)}`,
    );
  });
}

/**
 * The board's pinned post carries the composer card's `Post an LFG` button.
 *
 * @param run - The board run, after `enableBoard` + {@link enableComposer}.
 */
export async function assertComposerPinned(run: Run): Promise<void> {
  try {
    await pollForCondition(() => readIntro(run), COMPOSER_READY_MS);
  } catch {
    const last = await readIntro(run).catch(() => null);
    throw new Error(
      "ROK-1612 AC1: the LFG board's pinned intro post must carry the " +
        `composer button "${COMPOSER_OPEN_CUSTOM_ID}" within ` +
        `${String(COMPOSER_READY_MS)}ms of enabling the board; last seen ` +
        `${JSON.stringify(last)} in forum ${forumId(run)}`,
    );
  }
}
