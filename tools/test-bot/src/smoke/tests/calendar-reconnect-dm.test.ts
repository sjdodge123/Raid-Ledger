/**
 * ROK-1866 Lane C — the calendar reconnect nudge, at smoke tier.
 *
 * The companion bot cannot read a DM another bot sends (Discord 50007), so
 * the DM is asserted in two halves against the deployed API, like the
 * ROK-1933 claim DM:
 *
 *  1. The REAL pipeline flips and nudges: a Fake Google connection is seeded
 *     for the caller, `fail-read-auth` scripts an `invalid_grant` and runs
 *     one real read sync (F1). The row must flip to `needs_reconnect` and
 *     exactly one `calendar_needs_reconnect` notification must land for it.
 *     A further auth failure on the same episode (`emit-needs-reconnect`,
 *     awaited) must claim nothing, and the count must stay at one.
 *  2. The REAL DM builder renders it: `render-dm-embed` runs
 *     `buildNotificationEmbed` with the stored row's title/body/payload and
 *     must return a "Reconnect calendar" link button to the Integrations page.
 *
 * The seeded connection is deleted and the sync switch restored in `finally`.
 */
import { pollForCondition } from "../../helpers/polling.js";
import { SmokeAssertionError } from "../assert.js";
import { getNotificationsFor } from "../fixtures.js";
import type { SmokeTest, TestContext } from "../types.js";

const TYPE = "calendar_needs_reconnect";
/** `nudgeCopy('google')` in api/src/notifications/calendar-reconnect-nudge.helpers.ts. */
const TITLE = "Reconnect your Google calendar";
const BUTTON = "Reconnect calendar";
/** `CALENDAR_RECONNECT_PATH` (same file). */
const RECONNECT_PATH = "/profile/integrations";
const SYNC_SETTINGS = "/admin/settings/calendar-sync";

interface NudgeRow {
  type: string;
  title?: string;
  message?: string;
  payload?: Record<string, unknown>;
}
interface RenderedButton {
  label?: string;
  url?: string;
}
interface RenderedDm {
  embed: { title?: string; description?: string };
  components: { components?: RenderedButton[] }[];
}

function fail(msg: string): never {
  throw new SmokeAssertionError(msg);
}

async function nudgesFor(
  ctx: TestContext,
  userId: number,
  connectionId: number,
): Promise<NudgeRow[]> {
  const rows = (await getNotificationsFor(
    ctx.api,
    userId,
    TYPE,
    50,
  )) as NudgeRow[];
  return rows.filter((r) => r.payload?.connectionId === connectionId);
}

/** F1 must flip the row; returns the connection's owner. */
async function failReadAuth(
  ctx: TestContext,
  connectionId: number,
): Promise<number> {
  const res = await ctx.api.post<{
    outcome?: string;
    userId?: number;
    status?: string;
  }>("/admin/test/calendar/fail-read-auth", { connectionId });
  if (res.status !== "needs_reconnect" || typeof res.userId !== "number") {
    fail(
      `fail-read-auth: expected status needs_reconnect, got ${JSON.stringify(res)}`,
    );
  }
  return res.userId;
}

async function expectExactlyOneNudge(
  ctx: TestContext,
  userId: number,
  connectionId: number,
): Promise<NudgeRow> {
  const rows = await pollForCondition(async () => {
    const r = await nudgesFor(ctx, userId, connectionId);
    return r.length > 0 ? r : null;
  }, 15_000);
  if (rows.length !== 1) {
    fail(
      `expected exactly 1 ${TYPE} for connection ${String(connectionId)}, got ${String(rows.length)}`,
    );
  }
  const [row] = rows;
  if (!row) fail("nudge row vanished");
  return row;
}

/** A second auth failure on the same episode claims nothing. */
async function expectNoSecondNudge(
  ctx: TestContext,
  userId: number,
  connectionId: number,
): Promise<void> {
  const res = await ctx.api.post<{ nudged?: boolean }>(
    "/admin/test/calendar/emit-needs-reconnect",
    { connectionId },
  );
  if (res.nudged !== false) {
    fail(
      `second failure on the same episode: expected nudged=false, got ${JSON.stringify(res)}`,
    );
  }
  const rows = await nudgesFor(ctx, userId, connectionId);
  if (rows.length !== 1) {
    fail(
      `after a second failure: expected still 1 ${TYPE}, got ${String(rows.length)}`,
    );
  }
}

async function expectReconnectButton(
  ctx: TestContext,
  row: NudgeRow,
): Promise<void> {
  if (row.title !== TITLE) {
    fail(`nudge title: expected "${TITLE}", got "${String(row.title)}"`);
  }
  const dm = await ctx.api.post<RenderedDm>("/admin/test/render-dm-embed", {
    type: TYPE,
    title: row.title,
    message: row.message ?? "",
    payload: row.payload ?? {},
  });
  const buttons = dm.components.flatMap((r) => r.components ?? []);
  const btn = buttons.find((b) => b.label === BUTTON);
  if (!btn?.url?.endsWith(RECONNECT_PATH)) {
    fail(
      `DM: expected [${BUTTON}] → …${RECONNECT_PATH}, got ${JSON.stringify(buttons)}`,
    );
  }
}

async function flipAndAssert(
  ctx: TestContext,
  connectionId: number,
): Promise<void> {
  const userId = await failReadAuth(ctx, connectionId);
  const row = await expectExactlyOneNudge(ctx, userId, connectionId);
  await expectNoSecondNudge(ctx, userId, connectionId);
  await expectReconnectButton(ctx, row);
}

async function reconnectNudgeOnce(ctx: TestContext): Promise<void> {
  const before = await ctx.api.get<{ enabled?: boolean }>(SYNC_SETTINGS);
  if (before.enabled !== true)
    await ctx.api.put(SYNC_SETTINGS, { enabled: true });
  let connectionId: number | null = null;
  try {
    const seeded = await ctx.api.post<{ id: number }>(
      "/admin/test/calendar/seed-connection",
      {},
    );
    connectionId = seeded.id; // claimed before the first assertion
    await flipAndAssert(ctx, connectionId);
  } finally {
    if (connectionId !== null) {
      await ctx.api
        .delete(`/users/me/calendars/${String(connectionId)}`)
        .catch(() => undefined);
    }
    if (before.enabled !== true) {
      await ctx.api
        .put(SYNC_SETTINGS, { enabled: false })
        .catch(() => undefined);
    }
  }
}

export const calendarReconnectDmTests: SmokeTest[] = [
  {
    name: "ROK-1866 calendar reconnect DM: one nudge per episode, Reconnect button",
    category: "dm",
    // Toggles the global calendar-sync switch and the shared Fake; run alone.
    serial: true,
    run: reconnectNudgeOnce,
  },
];
