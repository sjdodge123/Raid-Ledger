/**
 * ROK-1612 AC1 (operator ruling 2026-09-22 "pin it") — the composer card is a
 * real Discord pin.
 *
 * On the FORUM surface Discord allows one pinned post per forum, and that slot
 * is meant for the board's intro post. So the composer's `Post an LFG` button
 * rides on the intro post's starter message (`LfgComposerPinService`). This
 * phase asserts that THIS env's bot's intro post carries the composer button.
 *
 * ROK-1658: there is no separate opt-in. Enabling the board alone puts the
 * button up, and disabling it takes the button down.
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
import { readForumThreads } from "./fixtures-lfg-board.js";
import { pickBoardIntro } from "./lfg-board-intro-pick.js";
import {
  forumId,
  INTRO_TITLE,
  INTRO_TITLES,
  type Run,
} from "./lfg-board-shared.js";

/** `LFG_COMPOSER_IDS.OPEN` — the card's `Post an LFG` custom id. */
export const COMPOSER_OPEN_CUSTOM_ID = "lfgc:open";

/**
 * `LFG_COMPOSER_IDS.VIEW` — the card's `View games ↗` (ROK-1685). A press, not
 * a link: the card is public, so the clicker's own magic link arrives in a
 * private reply and the card itself never carries a token.
 */
export const COMPOSER_VIEW_CUSTOM_ID = "lfgc:view";

/** Provisioning + the ENABLED handler are a few Discord round-trips. */
const COMPOSER_READY_MS = 30_000;

/** The fields this smoke reads off one component in an action row. */
interface RowChild {
  customId?: string | null;
  url?: string | null;
}

/** Every component on a message's action rows. */
function rowChildren(message: Message): RowChild[] {
  return message.components.flatMap((row) =>
    "components" in row && Array.isArray(row.components)
      ? row.components.flatMap((c: RowChild) => [c])
      : [],
  );
}

/** Every custom id on a message's action rows. */
function customIds(message: Message): string[] {
  return rowChildren(message).flatMap((c) => (c.customId ? [c.customId] : []));
}

/**
 * How many Link buttons carry a `token` — counted, never collected, so a
 * failure message can report a leak without printing the token itself.
 */
function tokenUrlCount(message: Message): number {
  return rowChildren(message).filter(
    (c) => typeof c.url === "string" && c.url.includes("token"),
  ).length;
}

/** What this env's intro post currently looks like. */
interface IntroState {
  /** This bot's intro post's id, or null when it owns none yet. */
  introId: string | null;
  /** Its title — ROK-1658 renames a legacy-titled intro to `INTRO_TITLE`. */
  title: string | null;
  /** Whether that post holds the forum's one pin — reported, not required. */
  pinned: boolean;
  /** How many posts carry an intro title — the shared guild holds several. */
  introTitled: number;
  /** Custom ids on the intro's starter message. */
  ids: string[];
  /** Link buttons on the starter whose URL carries a `token` (ROK-1685). */
  tokenUrls: number;
}

/**
 * Read THIS env's bot's intro post. The CI guild is shared, so the forum holds
 * one intro per bot, under the current or the legacy title; ownership names ours (see
 * `pickBoardIntro`). The starter is force-fetched so a cached copy from
 * before the composer's edit cannot mask it.
 */
async function readIntro(run: Run): Promise<IntroState> {
  const threads = await readForumThreads(forumId(run));
  const intro = pickBoardIntro(threads, INTRO_TITLES);
  const introTitled = threads.filter((t) => INTRO_TITLES.includes(t.name)).length;
  if (!intro) {
    return {
      introId: null,
      title: null,
      pinned: false,
      introTitled,
      ids: [],
      tokenUrls: 0,
    };
  }
  const thread = await getGuild().channels.fetch(intro.id);
  const starter = thread?.isThread()
    ? await thread.fetchStarterMessage({ force: true }).catch(() => null)
    : null;
  return {
    introId: intro.id,
    title: intro.name,
    pinned: intro.pinned,
    introTitled,
    ids: starter ? customIds(starter) : [],
    tokenUrls: starter ? tokenUrlCount(starter) : 0,
  };
}

/**
 * The button is up AND the intro carries the current title: the same
 * reconcile that sets the button renames a legacy-titled intro (ROK-1658).
 */
function isComposerReady(state: IntroState): boolean {
  return (
    state.introId !== null &&
    state.title === INTRO_TITLE &&
    state.ids.includes(COMPOSER_OPEN_CUSTOM_ID)
  );
}

/**
 * This env's intro post carries the composer card's `Post an LFG` button.
 * No composer PUT precedes this: the board alone puts it up (ROK-1658).
 *
 * @param run - The board run, after `enableBoard`.
 */
export async function assertComposerPinned(run: Run): Promise<void> {
  try {
    await pollForCondition(async () => {
      const state = await readIntro(run);
      return isComposerReady(state) ? state : null;
    }, COMPOSER_READY_MS);
  } catch {
    await failComposerPinned(run);
  }
  await assertViewIsAPress(run);
}

/** The AC1 failure, quoting what the intro looked like last. */
async function failComposerPinned(run: Run): Promise<never> {
  const last = await readIntro(run).catch(() => null);
  throw new Error(
    "ROK-1612 AC1 / ROK-1658: this env's LFG board intro post must carry " +
      `the composer button "${COMPOSER_OPEN_CUSTOM_ID}" and the title ` +
      `"${INTRO_TITLE}" within ` +
      `${String(COMPOSER_READY_MS)}ms of enabling the board; last seen ` +
      `${JSON.stringify(last)} in forum ${forumId(run)}`,
  );
}

/**
 * ROK-1685 AC3/AC5 — the card's `View games ↗` is a press and no button on
 * the public card carries a token.
 *
 * The card offers `View games ↗` whenever a client URL is configured, and the
 * pin service reads `getClientUrl()`, which falls back to a default and is
 * never empty (`settings-bot.helpers.ts` `getClientUrl`) — so every env's card
 * carries it. It is polled for because a card posted by an older build (a
 * `View games ↗` LINK) is re-edited by the same reconcile that set `Post an
 * LFG`, which the caller has already seen. The token check is not polled: a
 * token on a public message is a leak the moment it is there.
 *
 * @param run - The board run, after `assertComposerPinned`'s poll passed.
 */
async function assertViewIsAPress(run: Run): Promise<void> {
  let state: IntroState | null = null;
  try {
    state = await pollForCondition(async () => {
      const seen = await readIntro(run);
      return seen.ids.includes(COMPOSER_VIEW_CUSTOM_ID) ? seen : null;
    }, COMPOSER_READY_MS);
  } catch {
    const last = await readIntro(run).catch(() => null);
    throw new Error(
      "ROK-1685 AC3: this env's LFG board intro post must carry the " +
        `"${COMPOSER_VIEW_CUSTOM_ID}" press (View games) within ` +
        `${String(COMPOSER_READY_MS)}ms; last seen ${JSON.stringify(last)} ` +
        `in forum ${forumId(run)}`,
    );
  }
  if (state.tokenUrls > 0) {
    throw new Error(
      "ROK-1685 AC3/AC4: the public composer card must never carry a token; " +
        `${String(state.tokenUrls)} button URL(s) on intro ${String(state.introId)} ` +
        "contain 'token' (URLs withheld so the token is not printed)",
    );
  }
}

/**
 * ROK-1658 — disabling the board strips the composer button from this env's
 * intro post (the intro itself stays).
 *
 * @param run - The board run, after the board was switched off.
 */
export async function assertComposerCleared(run: Run): Promise<void> {
  try {
    await pollForCondition(async () => {
      const state = await readIntro(run);
      return state.introId !== null &&
        !state.ids.includes(COMPOSER_OPEN_CUSTOM_ID)
        ? state
        : null;
    }, COMPOSER_READY_MS);
  } catch {
    const last = await readIntro(run).catch(() => null);
    throw new Error(
      "ROK-1658: disabling the board must strip the composer button " +
        `"${COMPOSER_OPEN_CUSTOM_ID}" from this env's intro post within ` +
        `${String(COMPOSER_READY_MS)}ms; last seen ${JSON.stringify(last)} ` +
        `in forum ${forumId(run)}`,
    );
  }
}
