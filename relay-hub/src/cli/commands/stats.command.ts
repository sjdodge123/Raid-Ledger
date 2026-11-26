import type { Sql } from 'postgres';
import {
  collectStats,
  type CrosswalkStats,
} from '../../crosswalk/crosswalk-stats';
import type { CliIo } from '../cli-io';
import { countLines } from '../format';

/** The human form of {@link CrosswalkStats}, one group per heading. */
export function formatStats(stats: CrosswalkStats): string[] {
  return [
    `games: ${stats.games}`,
    'ids by kind:',
    ...countLines(stats.ids.byKind),
    'ids by source:',
    ...countLines(stats.ids.bySource),
    'ids by provenance:',
    ...countLines(stats.ids.byProvenance),
    `conflicts: open ${stats.conflicts.open} / total ${stats.conflicts.total}`,
  ];
}

/** `hub-admin stats [--json]` (AC 4): `--json` is exactly `JSON.stringify(collectStats())`. */
export async function runStats(
  sql: Sql,
  args: readonly string[],
  io: CliIo,
): Promise<number> {
  const stats = await collectStats(sql);
  if (args.includes('--json')) {
    io.out(JSON.stringify(stats));
  } else {
    formatStats(stats).forEach((line) => io.out(line));
  }
  return 0;
}
