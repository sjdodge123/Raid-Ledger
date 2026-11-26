import { CrosswalkKindSchema, type CrosswalkKind } from '@raid-ledger/contract';
import type { Sql } from 'postgres';
import type { CliIo } from '../cli-io';
import { table } from '../format';

export const LOOKUP_USAGE =
  'Usage: hub-admin lookup --kind <kind> --value <value>';
const LOWER_CASE_KINDS: readonly CrosswalkKind[] = ['itad_uuid', 'itad_slug'];

interface GameRow {
  readonly rl_game_id: string;
  readonly display_name: string;
}
interface IdRow {
  readonly kind: string;
  readonly value: string;
  readonly source: string;
  readonly provenance: string;
}

function flag(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
}

/** L5: a known kind and a value, ITAD values lower-cased; else undefined. */
export function parseLookupArgs(
  args: readonly string[],
): { kind: CrosswalkKind; value: string } | undefined {
  const kind = CrosswalkKindSchema.safeParse(flag(args, '--kind'));
  const value = flag(args, '--value');
  if (!kind.success || value === undefined || value === '') return undefined;
  const lower = LOWER_CASE_KINDS.includes(kind.data);
  return { kind: kind.data, value: lower ? value.toLowerCase() : value };
}

/** `hub-admin lookup --kind <k> --value <v>` (L5): exit 0 found, 1 not found, 2 usage. */
export async function runLookup(
  sql: Sql,
  args: readonly string[],
  io: CliIo,
): Promise<number> {
  const q = parseLookupArgs(args);
  if (!q) {
    io.err(LOOKUP_USAGE);
    return 2;
  }
  const [game] = await sql<GameRow[]>`
    SELECT g.rl_game_id, g.display_name
    FROM hub_game_ids i JOIN hub_games g ON g.rl_game_id = i.rl_game_id
    WHERE i.kind = ${q.kind} AND i.value = ${q.value}`;
  if (!game) {
    io.err(`not found: ${q.kind} ${q.value}`);
    return 1;
  }
  const ids = await sql<IdRow[]>`
    SELECT kind, value, source, coalesce(provenance, 'none') AS provenance
    FROM hub_game_ids WHERE rl_game_id = ${game.rl_game_id}
    ORDER BY kind, value`;
  io.out(`${game.rl_game_id}  ${game.display_name} (match-only)`);
  const rows = [
    ['kind', 'value', 'source', 'provenance'],
    ...ids.map((i) => [i.kind, i.value, i.source, i.provenance]),
  ];
  table(rows).forEach((line) => io.out(`  ${line}`));
  return 0;
}
