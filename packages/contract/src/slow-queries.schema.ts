import { z } from 'zod';

export const SourceEnum = z.enum(['cron', 'manual']);
export type SourceDto = z.infer<typeof SourceEnum>;

// queryid is bigint in Postgres (pg_stat_statements.queryid) — serialize as
// string in the contract to avoid JS Number precision loss.
export const SlowQueryEntrySchema = z.object({
  queryid: z.string(),
  queryText: z.string(),
  calls: z.number().int().nonnegative(),
  meanExecTimeMs: z.number().nonnegative(),
  totalExecTimeMs: z.number().nonnegative(),
});
export type SlowQueryEntryDto = z.infer<typeof SlowQueryEntrySchema>;

export const SlowQuerySnapshotSchema = z.object({
  id: z.number().int(),
  capturedAt: z.string().datetime(),
  source: SourceEnum,
});
export type SlowQuerySnapshotDto = z.infer<typeof SlowQuerySnapshotSchema>;

export const SlowQueryDigestSchema = z.object({
  snapshot: SlowQuerySnapshotSchema,
  baseline: SlowQuerySnapshotSchema.nullable(),
  entries: z.array(SlowQueryEntrySchema),
});
export type SlowQueryDigestDto = z.infer<typeof SlowQueryDigestSchema>;
