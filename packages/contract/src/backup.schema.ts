import { z } from 'zod';

export const BackupFileSchema = z.object({
  filename: z.string(),
  type: z.enum(['daily', 'migration']),
  sizeBytes: z.number(),
  createdAt: z.string(),
});

export type BackupFileDto = z.infer<typeof BackupFileSchema>;

export const BackupListResponseSchema = z.object({
  backups: z.array(BackupFileSchema),
  total: z.number(),
});

export type BackupListResponseDto = z.infer<typeof BackupListResponseSchema>;

/**
 * ROK-1160 (D10) — the shape of `restore-drill-report.json`, the weekly backup
 * restore drill's artefact. It carries AC2's timing data and is reusable by a
 * future admin surface, so the shape lives here rather than in the script.
 *
 * This is the contract for what two emitters actually write, and the schema
 * must track them field for field:
 *   - `scripts/backup-restore-drill.sh::emit_report` (:214-233) builds the meta
 *     block and the A1 / reconcile / boot findings with printf.
 *   - `scripts/restore-drill-assertions.mjs::main` merges the database tiers in
 *     and adds `findings`, `finishedAt`, `status`.
 * Both objects are `strictObject` on purpose: an emitter key the contract does
 * not declare must fail loudly at the parse, not be silently dropped from a DR
 * report. Enforced by `api/src/backup/restore-drill-report.schema.spec.ts`.
 */

/** `summarize()` (restore-drill-assertions.mjs) returns only these two. */
export const RestoreDrillStatusSchema = z.enum(['passed', 'failed']);

export type RestoreDrillStatusDto = z.infer<typeof RestoreDrillStatusSchema>;

/**
 * One assertion result. A2's code-vs-restore table diff is deliberately
 * `informational` rather than `failed` — a dump is always ≥1 day old, so a
 * table added by a later migration is legitimately absent.
 *
 * `restore` is the D5 stderr classifier's own tier: when it rejects a restore
 * the drill aborts before any database tier runs, and that finding must name
 * the step that actually failed rather than borrow A1's (which, on that path,
 * genuinely passed).
 */
export const DrillFindingSchema = z.strictObject({
  id: z.string(),
  tier: z.enum(['A1', 'A2', 'A3', 'A4', 'A5', 'restore', 'reconcile', 'boot']),
  status: z.enum(['passed', 'failed', 'informational']),
  detail: z.string(),
});

export type DrillFindingDto = z.infer<typeof DrillFindingSchema>;

/**
 * Timestamps are plain strings, NOT `z.iso.datetime()`: the two emitters
 * disagree on precision and both outputs are valid. `startedAt` comes from
 * shell `date -u +%Y-%m-%dT%H:%M:%SZ` (no milliseconds); `finishedAt` comes
 * from JS `toISOString()` (with milliseconds). A strict datetime refinement
 * would reject every real run.
 *
 * `dumpTakenAt` is nullable because the shell emitter hardcodes `null` today;
 * D10 fills in the dump's real mtime once the D3 fetch step lands in slice C.
 */
export const RestoreDrillReportSchema = z.strictObject({
  status: RestoreDrillStatusSchema,
  startedAt: z.string(),
  finishedAt: z.string(),
  dumpFilename: z.string(),
  dumpSizeBytes: z.number(),
  dumpTakenAt: z.string().nullable(),
  restoreDurationMs: z.number(),
  reconcileDurationMs: z.number(),
  bootDurationMs: z.number(),
  totalDurationMs: z.number(),
  findings: z.array(DrillFindingSchema),
  stale: z.boolean(),
  error: z.string().nullable(),
});

export type RestoreDrillReportDto = z.infer<typeof RestoreDrillReportSchema>;
