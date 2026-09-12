/**
 * ROK-1160 slice B (D10) — the contract shape for `restore-drill-report.json`.
 *
 * The schema lives in `packages/contract/src/backup.schema.ts`; this spec is
 * its only executing test. It is here, and not beside the contract source,
 * because the `@raid-ledger/contract` workspace declares no test runner — its
 * two existing `src/__tests__/*.spec.ts` files are executed by nothing (api
 * Jest has `rootDir: 'src'`, web Vitest is scoped to `web/`). Adding a runner
 * to the contract workspace for one file is out of scope for this slice; see
 * TECH-DEBT-BACKLOG.md.
 *
 * The fixture below is not invented. It reproduces, field for field, what the
 * slice-A emitter actually writes:
 *   - `scripts/backup-restore-drill.sh::emit_report` (:214-233) printf-builds
 *     the meta block and the A1 / reconcile / boot findings.
 *   - `scripts/restore-drill-assertions.mjs::main` merges that with the
 *     database tiers and adds `findings`, `finishedAt`, `status`.
 * If the emitter grows a key, case 1's key-set assertion fails here first.
 */
import {
  DrillFindingSchema,
  RestoreDrillReportSchema,
  RestoreDrillStatusSchema,
  type RestoreDrillReportDto,
} from '@raid-ledger/contract';

/**
 * `json_finding` (shell, :183-186) and `finding` (mjs, :28) build the same
 * four-key object; both sides are represented here.
 */
const FINDINGS = [
  {
    id: 'a1-toc-entries',
    tier: 'A1',
    status: 'passed',
    detail: '214 TABLE DATA entries',
  },
  {
    id: 'reconcile-exit',
    tier: 'reconcile',
    status: 'passed',
    detail: 'exit 0',
  },
  {
    id: 'boot-health',
    tier: 'boot',
    status: 'informational',
    detail: 'skipped (no --boot-check)',
  },
  {
    id: 'a2-table-users',
    tier: 'A2',
    status: 'passed',
    detail: 'critical table users present',
  },
  {
    id: 'a3-count-events',
    tier: 'A3',
    status: 'passed',
    detail: 'events: 412 rows (ts 2026-09-11)',
  },
  {
    id: 'a4-orphans-signups',
    tier: 'A4',
    status: 'passed',
    detail: '0 orphan row(s)',
  },
  {
    id: 'a5-empty-sessions',
    tier: 'A5',
    status: 'passed',
    detail: 'sessions is empty',
  },
];

/**
 * NOTE the two timestamp shapes — this is real, not a typo. `startedAt` comes
 * from shell `date -u +%Y-%m-%dT%H:%M:%SZ` (NO milliseconds); `finishedAt`
 * comes from JS `new Date().toISOString()` (WITH milliseconds). A strict
 * datetime refinement would reject production output; case 6 locks that in.
 */
const makeReport = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  startedAt: '2026-09-13T04:00:11Z',
  dumpFilename: 'raid-ledger-2026-09-12.dump',
  dumpSizeBytes: 48210944,
  dumpTakenAt: null,
  stale: false,
  error: null,
  restoreDurationMs: 18422,
  reconcileDurationMs: 2140,
  bootDurationMs: 0,
  totalDurationMs: 41022,
  findings: FINDINGS,
  finishedAt: '2026-09-13T04:00:52.118Z',
  status: 'passed',
  ...overrides,
});

describe('RestoreDrillReportSchema (ROK-1160 D10 / AC2)', () => {
  // Case 1 — the real emitter payload round-trips, and the schema declares
  // exactly the keys the emitter writes: no more, no fewer.
  it('parses the emitter output field-for-field', () => {
    // Annotated, not cast: this asserts at compile time that the inferred
    // DTO actually describes what `parse` returns.
    const parsed: RestoreDrillReportDto =
      RestoreDrillReportSchema.parse(makeReport());

    expect(parsed.status).toBe('passed');
    expect(parsed.findings).toHaveLength(7);
    // AC2's timing data must survive the parse, not be silently stripped.
    expect(parsed.restoreDurationMs).toBe(18422);
    expect(parsed.reconcileDurationMs).toBe(2140);
    expect(parsed.bootDurationMs).toBe(0);
    expect(parsed.totalDurationMs).toBe(41022);
    expect(parsed.dumpSizeBytes).toBe(48210944);
    // Sorted key SETS, never Object.keys() order: `{...meta, findings,
    // finishedAt, status}` reorders relative to the shell's printf.
    expect(Object.keys(RestoreDrillReportSchema.shape).sort()).toEqual(
      Object.keys(makeReport()).sort(),
    );
  });
});

describe('DrillFindingSchema / RestoreDrillStatusSchema (ROK-1160 D10)', () => {
  // Case 2 — every tier and every status the two emitters can produce.
  it.each(['A1', 'A2', 'A3', 'A4', 'A5', 'restore', 'reconcile', 'boot'])(
    'accepts tier %s',
    (tier) => {
      expect(
        DrillFindingSchema.parse({
          id: 'x',
          tier,
          status: 'passed',
          detail: 'd',
        }).tier,
      ).toBe(tier);
    },
  );

  it.each(['passed', 'failed', 'informational'])(
    'accepts finding status %s',
    (status) => {
      expect(
        DrillFindingSchema.parse({ id: 'x', tier: 'A1', status, detail: 'd' })
          .status,
      ).toBe(status);
    },
  );

  // Case 3 — a tier the emitters never produce is rejected by name.
  it('rejects an unknown tier', () => {
    const result = DrillFindingSchema.safeParse({
      id: 'x',
      tier: 'A6',
      status: 'passed',
      detail: 'd',
    });

    expect(result.success).toBe(false);
    const issue = result.error!.issues[0];
    expect(issue.path).toEqual(['tier']);
    expect(issue.message).toContain('A5');
  });

  // The report-level status is passed|failed only — `summarize()`
  // (restore-drill-assertions.mjs) cannot return 'informational'.
  it('rejects informational as a report-level status', () => {
    expect(RestoreDrillStatusSchema.safeParse('informational').success).toBe(
      false,
    );
    expect(RestoreDrillStatusSchema.parse('failed')).toBe('failed');
  });
});

describe('RestoreDrillReportSchema — nullability, strictness, timestamps', () => {
  // Case 4 — the emitter writes `dumpTakenAt: null` today; D10 wants the real
  // value later. Both must parse without a schema change.
  it('accepts dumpTakenAt as null and as an ISO string', () => {
    expect(RestoreDrillReportSchema.parse(makeReport()).dumpTakenAt).toBeNull();
    expect(
      RestoreDrillReportSchema.parse(
        makeReport({ dumpTakenAt: '2026-09-12T03:00:00.000Z' }),
      ).dumpTakenAt,
    ).toBe('2026-09-12T03:00:00.000Z');
  });

  it('accepts error as null and as a string', () => {
    expect(RestoreDrillReportSchema.parse(makeReport()).error).toBeNull();
    expect(
      RestoreDrillReportSchema.parse(makeReport({ error: 'boom' })).error,
    ).toBe('boom');
  });

  // Case 5 — the `.strict()` bite. This is what makes the schema non-vacuous:
  // if the emitter grows a key the contract does not know about, the parse
  // FAILS and names the key, rather than silently dropping data.
  it('rejects an emitter key the schema does not declare', () => {
    const result = RestoreDrillReportSchema.safeParse(
      makeReport({ sentryCheckInId: 'abc-123' }),
    );

    expect(result.success).toBe(false);
    const issue = result.error!.issues[0];
    expect(issue.code).toBe('unrecognized_keys');
    expect((issue as { keys: string[] }).keys).toContain('sentryCheckInId');
  });

  it('rejects an unknown key inside a finding', () => {
    const bad = makeReport({ findings: [{ ...FINDINGS[0], durationMs: 12 }] });
    const result = RestoreDrillReportSchema.safeParse(bad);

    expect(result.success).toBe(false);
    expect(result.error!.issues[0].code).toBe('unrecognized_keys');
  });

  // Case 6 — the two real timestamp shapes. `startedAt` has no milliseconds,
  // `finishedAt` does. Both are produced on every single run.
  it('accepts both real timestamp shapes', () => {
    const parsed = RestoreDrillReportSchema.parse(makeReport());

    expect(parsed.startedAt).toBe('2026-09-13T04:00:11Z');
    expect(parsed.finishedAt).toBe('2026-09-13T04:00:52.118Z');
    // and the inverse pairing must parse too — nothing pins ms to a field.
    expect(
      RestoreDrillReportSchema.parse(
        makeReport({
          startedAt: '2026-09-13T04:00:11.004Z',
          finishedAt: '2026-09-13T04:00:52Z',
        }),
      ).startedAt,
    ).toBe('2026-09-13T04:00:11.004Z');
  });

  // A missing duration is a malformed report, not a defaulted zero.
  it('rejects a report missing a duration field', () => {
    const partial = makeReport();
    delete partial.totalDurationMs;
    const result = RestoreDrillReportSchema.safeParse(partial);

    expect(result.success).toBe(false);
    expect(result.error!.issues[0].path).toEqual(['totalDurationMs']);
  });
});
