import type { Sql } from 'postgres';
import type { CliIo } from '../cli-io';
import { table } from '../format';

/**
 * One conflict, labelled by meaning (RH-4a): `resolvedTo` is the game the
 * contributed item resolved to (`existing_rl_game_id`); `owner` is the game
 * that already owns the id (`proposed_rl_game_id`). Fixed key order.
 */
export interface ConflictView {
  readonly id: string;
  readonly kind: string;
  readonly value: string;
  readonly resolvedTo: string;
  readonly owner: string | null;
  readonly instanceId: string;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
}

interface ConflictRow {
  readonly id: string;
  readonly kind: string;
  readonly value: string;
  readonly existing_rl_game_id: string;
  readonly proposed_rl_game_id: string | null;
  readonly instance_id: string;
  readonly created_at: Date;
  readonly resolved_at: Date | null;
}

const HEADER = [
  'id',
  'kind',
  'value',
  'resolved-to',
  'owner',
  'instance',
  'created',
];

function toView(r: ConflictRow): ConflictView {
  return {
    id: r.id,
    kind: r.kind,
    value: r.value,
    resolvedTo: r.existing_rl_game_id,
    owner: r.proposed_rl_game_id,
    instanceId: r.instance_id,
    createdAt: r.created_at.toISOString(),
    resolvedAt: r.resolved_at?.toISOString() ?? null,
  };
}

/** Open conflicts (all with `--all`), newest first, ties by id. */
export async function listConflicts(
  sql: Sql,
  all: boolean,
): Promise<ConflictView[]> {
  const rows = await sql<ConflictRow[]>`
    SELECT id::text AS id, kind, value, existing_rl_game_id, proposed_rl_game_id,
           instance_id, created_at, resolved_at
    FROM hub_crosswalk_conflicts
    ${all ? sql`` : sql`WHERE resolved_at IS NULL`}
    ORDER BY created_at DESC, id DESC`;
  return rows.map(toView);
}

/** `hub-admin conflicts [--all] [--json]` (L6). Read-only. */
export async function runConflicts(
  sql: Sql,
  args: readonly string[],
  io: CliIo,
): Promise<number> {
  const views = await listConflicts(sql, args.includes('--all'));
  if (args.includes('--json')) {
    io.out(JSON.stringify(views, null, 2));
  } else if (views.length === 0) {
    io.out(args.includes('--all') ? 'No conflicts.' : 'No open conflicts.');
  } else {
    const rows = views.map((v) => [
      v.id,
      v.kind,
      v.value,
      v.resolvedTo,
      v.owner ?? '-',
      v.instanceId,
      v.createdAt,
    ]);
    table([HEADER, ...rows]).forEach((line) => io.out(line));
  }
  return 0;
}
