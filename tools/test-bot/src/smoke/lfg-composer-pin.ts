/**
 * ROK-1612 AC1 (operator ruling 2026-09-22 "pin it") — the composer card is a
 * real Discord pin.
 *
 * On the FORUM surface Discord allows one pinned post per forum, and that slot
 * is meant for the board's intro post. So the composer's `Post an LFG` button
 * rides on the intro post's starter message (`LfgComposerPinService`). This
 * phase asserts that THIS env's bot's intro post carries the composer button.
 *
 * It does not assert the pin: the CI guild is shared, its forum's one pin slot
 * belongs to whichever env's bot pinned first, and Discord refuses the rest
 * (30047). The product logs that and still puts the buttons on its own intro,
 * so a pin assertion here only measured which env got there first.
 *
 * Bots cannot press another bot's button, so the flow behind the button is
 * covered by the api unit tier; this asserts only that the card is there.
 */
import { type Message } from "discord.js";
import { getGuild } from "../client.js";
import { pollForCondition } from "../helpers/polling.js";
import {
  readForumThreads,
  setLfgComposerEnabled,
} from "./fixtures-lfg-board.js";
import { pickBoardIntro } from "./lfg-board-intro-pick.js";
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

/** What this env's intro post currently looks like. */
interface IntroState {
  /** This bot's intro post's id, or null when it owns none yet. */
  introId: string | null;
  /** Whether that post holds the forum's one pin — reported, not required. */
  pinned: boolean;
  /** How many posts carry the intro title — the shared guild holds several. */
  introTitled: number;
  /** Custom ids on the intro's starter message. */
  ids: string[];
}

/**
 * Read THIS env's bot's intro post. The CI guild is shared, so the forum holds
 * one "How this board works" per bot; ownership names ours (see
 * `pickBoardIntro`). The starter is force-fetched so a cached copy from
 * before the composer's edit cannot mask it.
 */
async function readIntro(run: Run): Promise<IntroState> {
  const threads = await readForumThreads(forumId(run));
  const intro = pickBoardIntro(threads, INTRO_TITLE);
  const introTitled = threads.filter((t) => t.name === INTRO_TITLE).length;
  if (!intro) return { introId: null, pinned: false, introTitled, ids: [] };
  const thread = await getGuild().channels.fetch(intro.id);
  const starter = thread?.isThread()
    ? await thread.fetchStarterMessage({ force: true }).catch(() => null)
    : null;
  return {
    introId: intro.id,
    pinned: intro.pinned,
    introTitled,
    ids: starter ? customIds(starter) : [],
  };
}

function isComposerReady(state: IntroState): boolean {
  return (
    state.introId !== null && state.ids.includes(COMPOSER_OPEN_CUSTOM_ID)
  );
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
 * This env's intro post carries the composer card's `Post an LFG` button.
 *
 * @param run - The board run, after `enableBoard` + {@link enableComposer}.
 */
export async function assertComposerPinned(run: Run): Promise<void> {
  try {
    await pollForCondition(async () => {
      const state = await readIntro(run);
      return isComposerReady(state) ? state : null;
    }, COMPOSER_READY_MS);
  } catch {
    const last = await readIntro(run).catch(() => null);
    throw new Error(
      "ROK-1612 AC1: this env's LFG board intro post must carry the " +
        `composer button "${COMPOSER_OPEN_CUSTOM_ID}" within ` +
        `${String(COMPOSER_READY_MS)}ms of enabling the board; last seen ` +
        `${JSON.stringify(last)} in forum ${forumId(run)}`,
    );
  }
}
