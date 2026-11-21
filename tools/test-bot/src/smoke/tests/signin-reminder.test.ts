/**
 * ROK-2284 — sign-in reminder DM for guild members who never signed in.
 *
 *  1. Reset the companion bot's reminder row (`/admin/test/signin-reminder/reset`).
 *  2. Run ONE real pass aimed at the companion bot only
 *     (`/admin/test/signin-reminder/tick {botDiscordId}`): roster fetch, claim,
 *     send, stamp. The fixture can only ever target a BOT guild member, so a
 *     smoke run never DMs a person. Exactly one send is attempted.
 *  3. The DM itself cannot be read: Discord refuses bot-to-bot DMs (50007 —
 *     see `dm-embed-render.test.ts`), so the send is recorded as a failed
 *     attempt with that code. If Discord ever delivers it, `sent` is 1 instead.
 *     Either way the row counts one reminder, and the DM the deployed builder
 *     sends is read back through `/admin/test/signin-reminder/state`: the
 *     `/login` copy, an "Open Raid Ledger" link button and the
 *     "Don't remind me again" (`signin_reminder:stop`) button.
 *  4. A second tick claims nothing — inside the cadence, nothing is sent.
 *  5. Teardown resets the row so the next run starts from "never reminded".
 *
 * The stop button is never clicked: bots cannot press another bot's buttons.
 * Its handler is covered by `signin-reminder-interaction.integration.spec.ts`.
 *
 * The switch is NOT flipped here: turning it on would let the hourly cron DM
 * real members of the test guild. An unset switch is OFF everywhere (ruling
 * 2026-11-21), and the bot-targeted tick bypasses the switch, so this runs
 * with the cron idle.
 */
import { pollForCondition } from "../../helpers/polling.js";
import { SmokeAssertionError } from "../assert.js";
import type { SmokeTest, TestContext } from "../types.js";

const BASE = "/admin/test/signin-reminder";
const STOP_ID = "signin_reminder:stop";
const STOP_LABEL = "Don't remind me again";
const LINK_LABEL = "Open Raid Ledger";
/** Discord "Cannot send messages to this user" — what a bot-to-bot DM gets. */
const DM_REFUSED = 50007;
/** Discord component type for a button; style 5 = link. */
const BUTTON = 2;
const LINK_STYLE = 5;

type TickOutcome =
  | { status: "disabled" | "not-connected" | "busy" }
  | { status: "ran"; candidates: number; sent: number; failed: number };

interface ButtonJson {
  type: number;
  style?: number;
  label?: string;
  custom_id?: string;
  url?: string;
}

interface StateResponse {
  row: {
    sentCount: number;
    lastSentAt: string | null;
    optedOutAt: string | null;
    lastFailureCode: number | null;
  } | null;
  dm: {
    embeds: Array<{ description?: string }>;
    components: Array<{ components?: ButtonJson[] }>;
  };
}

function fail(msg: string): never {
  throw new SmokeAssertionError(msg);
}

/** One targeted pass; waits out a concurrent hourly tick (`busy`). */
async function tick(ctx: TestContext): Promise<Extract<TickOutcome, { status: "ran" }>> {
  const out = await pollForCondition(async () => {
    const res = await ctx.api.post<TickOutcome>(`${BASE}/tick`, {
      botDiscordId: ctx.testBotDiscordId,
    });
    return res.status === "busy" ? null : res;
  }, ctx.config.timeoutMs);
  if (out.status !== "ran") {
    fail(`tick: expected status "ran", got ${JSON.stringify(out)} (is the sign-in reminder switch off?)`);
  }
  return out;
}

function state(ctx: TestContext): Promise<StateResponse> {
  return ctx.api.post<StateResponse>(`${BASE}/state`, { discordId: ctx.testBotDiscordId });
}

function reset(ctx: TestContext): Promise<unknown> {
  return ctx.api.post(`${BASE}/reset`, { discordId: ctx.testBotDiscordId });
}

function assertOneAttempt(first: Extract<TickOutcome, { status: "ran" }>): void {
  if (first.candidates !== 1 || first.sent + first.failed !== 1) {
    fail(`first tick: expected 1 candidate and exactly 1 send attempt, got ${JSON.stringify(first)}`);
  }
}

function assertRow(row: StateResponse["row"], delivered: boolean): void {
  if (!row || row.sentCount !== 1 || row.optedOutAt !== null || row.lastSentAt === null) {
    fail(`row after the first tick: expected sentCount 1, lastSentAt set, not opted out — got ${JSON.stringify(row)}`);
  }
  if (!delivered && row.lastFailureCode !== DM_REFUSED) {
    fail(`undelivered DM: expected lastFailureCode ${DM_REFUSED}, got ${row.lastFailureCode}`);
  }
}

function assertDm(dm: StateResponse["dm"]): void {
  const description = dm.embeds[0]?.description ?? "";
  if (!description.includes("/login")) {
    fail(`DM description should tell the member to type /login, got: ${description}`);
  }
  const buttons = dm.components.flatMap((r) => r.components ?? []);
  const link = buttons.find((b) => b.label === LINK_LABEL);
  const stop = buttons.find((b) => b.custom_id === STOP_ID);
  if (buttons.length !== 2 || buttons.some((b) => b.type !== BUTTON)) {
    fail(`DM should carry exactly two buttons, got ${JSON.stringify(buttons)}`);
  }
  if (!link || link.style !== LINK_STYLE || !link.url?.startsWith("http")) {
    fail(`"${LINK_LABEL}" should be a link button to the site, got ${JSON.stringify(link)}`);
  }
  if (!stop || stop.label !== STOP_LABEL) {
    fail(`stop button should be "${STOP_LABEL}" (${STOP_ID}), got ${JSON.stringify(stop)}`);
  }
}

async function remindsOnceThenWaits(ctx: TestContext): Promise<void> {
  await reset(ctx);
  try {
    const first = await tick(ctx);
    assertOneAttempt(first);
    const after = await state(ctx);
    assertRow(after.row, first.sent === 1);
    assertDm(after.dm);
    const second = await tick(ctx);
    if (second.sent !== 0 || second.failed !== 0) {
      fail(`second tick inside the cadence should send nothing, got ${JSON.stringify(second)}`);
    }
  } finally {
    await reset(ctx);
  }
}

export const signinReminderTests: SmokeTest[] = [
  {
    name: "Sign-in reminder: one DM with Open Raid Ledger + Don't remind me again, then none inside the cadence (ROK-2284)",
    category: "dm",
    run: remindsOnceThenWaits,
  },
];
