/**
 * ROK-1728 (L9a) — pure action-row checks for the series-signup embed smoke.
 *
 * An event card's row 1 is the unchanged signup row (Sign Up · Tentative ·
 * Decline, then the optional View Event and Hub links). A series card adds
 * exactly one more row holding exactly one `series_join:<eventId>` button; a
 * non-series card has no second row. Discord rejects a message with more than
 * 5 rows (50035), so every card is checked against that cap too.
 *
 * Each check returns `null` when the card is right, or a sentence naming the
 * defect, so the smoke fails with its own message rather than a timeout.
 */
import type { SimpleComponent, SimpleMessage } from '../helpers/messages.js';

const MAX_ROWS = 5;
const MAX_PER_ROW = 5;
const SIGNUP_ROW = [
  { label: 'Sign Up', prefix: 'signup' },
  { label: 'Tentative', prefix: 'tentative' },
  { label: 'Decline', prefix: 'decline' },
] as const;
/** The optional Link buttons after Decline, in their only allowed order. */
const LINK_TAILS = ['', 'View Event', 'Hub', 'View Event · Hub'];

/** Rebuild a message's action rows from its flat `components` + `rowSizes`. */
export function componentRows(msg: SimpleMessage): SimpleComponent[][] {
  const sizes = msg.rowSizes;
  if (!sizes) throw new Error('componentRows: message has no rowSizes');
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total !== msg.components.length) {
    throw new Error(`componentRows: rowSizes sum ${String(total)} != ${String(msg.components.length)} components`);
  }
  const rows: SimpleComponent[][] = [];
  let at = 0;
  for (const size of sizes) {
    rows.push(msg.components.slice(at, at + size));
    at += size;
  }
  return rows;
}

function describe(row: SimpleComponent[] | undefined): string {
  return JSON.stringify((row ?? []).map((c) => c.customId ?? c.label));
}

/** Row 1 must be Sign Up · Tentative · Decline for `eventId`, then only View Event / Hub links. */
function rowOneProblem(row: SimpleComponent[] | undefined, eventId: number): string | null {
  const head = SIGNUP_ROW.every((want, i) => {
    const got = row?.[i];
    return got?.label === want.label && got.customId === `${want.prefix}:${String(eventId)}`;
  });
  const tail = (row ?? []).slice(SIGNUP_ROW.length);
  const labels = tail.map((c) => c.label ?? '').join(' · ');
  const linksOk = tail.every((c) => c.customId === null) && LINK_TAILS.includes(labels);
  if (head && linksOk) return null;
  return `row 1 must be Sign Up · Tentative · Decline · [View Event] · [Hub] for event ${String(eventId)}, got ${describe(row)}`;
}

/** Discord's caps: at most 5 rows, at most 5 components per row. */
function capProblem(rows: SimpleComponent[][]): string | null {
  if (rows.length > MAX_ROWS) return `message carries ${String(rows.length)} rows, Discord allows ${String(MAX_ROWS)} rows`;
  const wide = rows.findIndex((r) => r.length > MAX_PER_ROW);
  return wide === -1 ? null : `row ${String(wide + 1)} has ${String(rows[wide]?.length ?? 0)} components (max ${String(MAX_PER_ROW)})`;
}

/** A series card: unchanged row 1 plus one row with exactly one `series_join:<eventId>` button. */
export function seriesRowProblem(msg: SimpleMessage, eventId: number): string | null {
  const rows = componentRows(msg);
  const cap = capProblem(rows);
  if (cap) return cap;
  const rowOne = rowOneProblem(rows[0], eventId);
  if (rowOne) return rowOne;
  if (rows.length !== 2) return `series card: expected 2 rows, got ${String(rows.length)}: ${JSON.stringify(rows.map(describe))}`;
  const second = rows[1] ?? [];
  const [join] = second;
  if (second.length !== 1 || !join) return `series row must hold exactly one button, got ${describe(second)}`;
  const want = `series_join:${String(eventId)}`;
  if (join.customId !== want || join.label !== 'Join Series') {
    return `series row button must be "Join Series" ${want}, got ${JSON.stringify(join)}`;
  }
  return null;
}

/** A non-series card: row 1 only, and no `series_join` anywhere. */
export function nonSeriesRowProblem(msg: SimpleMessage, eventId: number): string | null {
  const rows = componentRows(msg);
  const cap = capProblem(rows);
  if (cap) return cap;
  if (rows.length !== 1) return `non-series card: expected 1 row, got ${String(rows.length)}: ${JSON.stringify(rows.map(describe))}`;
  return rowOneProblem(rows[0], eventId);
}
