import {
  type CrosswalkContributionItem,
  type CrosswalkContributionResult,
  type CrosswalkIdProvenance,
} from '@raid-ledger/contract';
import type { Sql } from 'postgres';
import { InstancesRepository } from '../instances/instances.repository';
import type { HubDb } from '../drizzle/drizzle.module';

/** The ids a test item carries (any subset; the contract needs ≥ 1). */
export interface TestIds {
  readonly steam?: number;
  readonly igdb?: number;
  readonly itad?: string;
}

/** Per-id provenance override; each defaults to its own kind's source. */
export type TestProvenance = Partial<
  Record<keyof TestIds, CrosswalkIdProvenance>
>;

/** Throws when a value a test depends on is missing (no `!`). */
export function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`missing ${label}`);
  return value;
}

/** A contract-valid contribution item (one provenance per id sent). */
export function testItem(
  name: string,
  ids: TestIds,
  prov: TestProvenance = {},
): CrosswalkContributionItem {
  const { steam, igdb, itad } = ids;
  return {
    clientRef: `ref-${name}`.slice(0, 40),
    name,
    ...(steam === undefined ? {} : { steamAppId: steam }),
    ...(igdb === undefined ? {} : { igdbId: igdb }),
    ...(itad === undefined ? {} : { itadUuid: itad }),
    provenance: {
      ...(steam === undefined ? {} : { steamAppId: prov.steam ?? 'steam' }),
      ...(igdb === undefined ? {} : { igdbId: prov.igdb ?? 'igdb' }),
      ...(itad === undefined ? {} : { itadUuid: prov.itad ?? 'itad' }),
    },
  };
}

/** The single result of a one-item batch. */
export function only(results: CrosswalkContributionResult[]): {
  result: CrosswalkContributionResult['result'];
  rlGameId: string;
} {
  expect(results).toHaveLength(1);
  const r = must(results[0], 'result');
  return { result: r.result, rlGameId: must(r.rlGameId, 'rlGameId') };
}

/** Registers and approves `instanceId` through RH-3a's repository. */
export async function seedApprovedInstance(
  db: HubDb,
  instanceId: string,
): Promise<void> {
  const repo = new InstancesRepository(db);
  await repo.upsertPending({
    instanceId,
    tokenHash: 'e'.repeat(64),
    version: '0.0.1',
    schemaVersion: 1,
  });
  expect(await repo.approve(instanceId)).toBe('approved');
}

/** `max(hub_games.updated_seq)` as text (postgres.js returns bigint as text). */
export async function maxSeq(sql: Sql): Promise<string> {
  const rows = await sql<{ m: string }[]>`
    SELECT coalesce(max(updated_seq), 0)::text AS m FROM hub_games`;
  return must(rows[0], 'max seq').m;
}

/** One game's `updated_seq` as text. */
export async function seqOf(sql: Sql, rlGameId: string): Promise<string> {
  const rows = await sql<{ s: string }[]>`
    SELECT updated_seq::text AS s FROM hub_games WHERE rl_game_id = ${rlGameId}`;
  return must(rows[0], `seq of ${rlGameId}`).s;
}

/** Number of hub games whose normalized name is `normalized`. */
export async function gamesNamed(
  sql: Sql,
  normalized: string,
): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM hub_games
    WHERE normalized_name = ${normalized}`;
  return must(rows[0], 'games named').n;
}

/** A game's id rows, ordered by kind, in a comparable shape. */
export async function idRowsOf(
  sql: Sql,
  rlGameId: string,
): Promise<Record<string, unknown>[]> {
  return sql`SELECT kind, value, provenance, source,
      first_contributor_instance_id AS instance, contributor_count AS count
    FROM hub_game_ids WHERE rl_game_id = ${rlGameId} ORDER BY kind`;
}
