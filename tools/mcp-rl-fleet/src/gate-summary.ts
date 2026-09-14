// ROK-1565 — reading a validate-ci.sh SUMMARY block.
//
// The pre-push sentinel used to ask one question ("did the Playwright row
// PASS?"). It now asks two ("were the static rows green, and did anything
// FAIL?"), so the parsing is worth its own module — both to keep
// playwright-sentinel.ts under the 300-line limit and because the row format is
// a contract with validate-ci.sh that deserves its own specs.
//
// The format is `<check name><2+ spaces><PASS|FAIL|SKIPPED>[ — reason]`, printed
// after a `========== Summary ==========` banner. Rows are read from the LAST
// banner in the tail (a re-run's output can follow an earlier one); when there
// is no banner the whole tail is scanned, which is how a run that died before
// printing a summary is still read as "this row FAILed".

/** The three states validate-ci.sh prints for a step. */
export type GateRowStatus = 'PASS' | 'FAIL' | 'SKIPPED';

/** One parsed SUMMARY row. */
export interface GateRow {
  name: string;
  status: GateRowStatus;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;
const SUMMARY_BANNER = /^=+\s*Summary\s*=+$/;
const ROW = /^([A-Za-z][^\n]*?)\s{2,}(PASS|FAIL|SKIPPED)\b/;

/**
 * The step rows of the last SUMMARY block in a task log tail.
 *
 * @param logTail - Raw (possibly ANSI-coloured) tail of the validate-ci log.
 * @returns Every parsed row, in print order. Empty when none are present.
 */
export function summaryRows(logTail?: string): GateRow[] {
  if (!logTail) return [];
  const lines = logTail.replace(ANSI, '').split('\n');
  let start = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (SUMMARY_BANNER.test(lines[i].trim())) {
      start = i + 1;
      break;
    }
  }
  const rows: GateRow[] = [];
  for (const line of lines.slice(start)) {
    const match = ROW.exec(line.trimEnd());
    if (match) rows.push({ name: match[1].trim(), status: match[2] as GateRowStatus });
  }
  return rows;
}

// `[^)]*` so the ROK-1565 scoped label — `Playwright (desktop + mobile, scoped:
// 3 specs)` — is still recognised as the Playwright row. validate-ci.sh is
// required to keep that prefix for exactly this reason.
const PLAYWRIGHT_ROW = /^Playwright \(desktop \+ mobile[^)]*\)$/;

/** Status of the last Playwright row, or null when the tier printed none. */
export function playwrightRowStatus(logTail?: string): GateRowStatus | null {
  const rows = summaryRows(logTail).filter((r) => PLAYWRIGHT_ROW.test(r.name));
  return rows.length ? rows[rows.length - 1].status : null;
}

// A green `--static` gate is Build + TypeScript + Lint. Anything narrower is a
// run that died before finishing them, and is not evidence of anything.
const REQUIRED_STATIC = [/^Build\b/, /^TypeScript\b/, /^Lint\b/];

/**
 * Did the static tier (build + typecheck + lint) pass with nothing FAILing?
 *
 * A missing required row is NOT a pass — the gate stops at the first failure,
 * so an absent row means the tier never got there.
 *
 * @param logTail - Raw tail of the validate-ci log.
 */
export function staticGateGreen(logTail?: string): boolean {
  const rows = summaryRows(logTail);
  if (!rows.length) return false;
  if (rows.some((r) => r.status === 'FAIL')) return false;
  return REQUIRED_STATIC.every((re) =>
    rows.some((r) => re.test(r.name) && r.status === 'PASS'),
  );
}
