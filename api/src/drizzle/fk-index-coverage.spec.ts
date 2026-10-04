/**
 * ROK-1157 regression guard: foreign-key columns must lead an index.
 *
 * Postgres never indexes the referencing side of a foreign key. When a parent
 * row is deleted (or its key updated) the RI trigger looks up matching child
 * rows, and without an index whose LEADING column is the FK column that is a
 * sequential scan of the child table per parent row — user deletion, game
 * dedup and event deletion all hit it.
 *
 * This ratchet reads the latest drizzle snapshot (meta/_journal.json head ->
 * meta/<NNNN>_snapshot.json) and lists every FK whose first column is not the
 * leading column of an index, a unique constraint, a composite primary key,
 * or a primary-key / unique column. A partial index (snapshot `where` set) does
 * not count: the RI trigger's `WHERE fk = $1` does not imply the index
 * predicate, so Postgres cannot use it. The list must equal DEFERRED_UNINDEXED_FKS
 * exactly, so a new unindexed FK fails here, and indexing a deferred column
 * fails until it is removed from the list.
 *
 * Indexes that exist only in hand-written migration SQL are invisible to the
 * snapshot; declare indexes in the schema so drizzle-kit records them.
 */
import * as fs from 'fs';
import * as path from 'path';
import { at } from '../common/testing/narrow';

const META_DIR = path.join(__dirname, 'migrations', 'meta');

/** Last snapshot before the ROK-1157 FK indexes were added. */
const PRE_INDEX_SNAPSHOT = '0195';

interface SnapshotColumn {
  name: string;
  primaryKey?: boolean;
  isUnique?: boolean;
}

interface SnapshotTable {
  name: string;
  columns: Record<string, SnapshotColumn>;
  indexes?: Record<
    string,
    {
      columns: { expression: string; isExpression?: boolean }[];
      where?: string;
    }
  >;
  foreignKeys?: Record<string, { columnsFrom: string[] }>;
  compositePrimaryKeys?: Record<string, { columns: string[] }>;
  uniqueConstraints?: Record<string, { columns: string[] }>;
}

interface Snapshot {
  tables: Record<string, SnapshotTable>;
}

/** ROK-1157 deferred long tail — see docs/db-index-audit-2026-Q3.md; shrink, never grow, without an index. */
const DEFERRED_UNINDEXED_FKS = [
  'admin_actions.actor_id',
  'ai_request_logs.user_id',
  'community_lineup_cohort_memory.game_id',
  'community_lineup_cohort_memory.source_lineup_id',
  'community_lineup_entries.carried_over_from',
  'community_lineup_entries.game_id',
  'community_lineup_entries.nominated_by',
  'community_lineup_invitees.invited_by',
  'community_lineup_match_members.user_id',
  'community_lineup_matches.game_id',
  'community_lineup_matches.linked_event_id',
  'community_lineup_schedule_slots.match_id',
  'community_lineup_schedule_votes.user_id',
  'community_lineup_tiebreaker_bracket_matchups.game_a_id',
  'community_lineup_tiebreaker_bracket_matchups.game_b_id',
  'community_lineup_tiebreaker_bracket_matchups.winner_game_id',
  'community_lineup_tiebreaker_bracket_votes.game_id',
  'community_lineup_tiebreaker_bracket_votes.user_id',
  'community_lineup_tiebreaker_vetoes.game_id',
  'community_lineup_tiebreaker_vetoes.user_id',
  'community_lineup_tiebreakers.lineup_id',
  'community_lineup_tiebreakers.winner_game_id',
  'community_lineup_user_submissions.user_id',
  'community_lineup_votes.game_id',
  'community_lineup_votes.user_id',
  'community_lineups.created_by',
  'community_lineups.decided_game_id',
  'community_lineups.linked_event_id',
  'community_lineups.tie_pick_by',
  'community_lineups.tie_pick_game_id',
  'discord_channel_presence_occupancy.game_id',
  'discord_game_mappings.game_id',
  'discovery_category_suggestions.reviewed_by',
  'event_plans.created_event_id',
  'event_plans.game_id',
  'event_templates.user_id',
  'feedback.user_id',
  'game_interest_suppressions.game_id',
  'games_dedup_audit.canonical_game_id',
  'lfg_group_messages.game_id',
  'lfg_intents.converted_to_poll_id',
  'lfg_intents.game_id',
  'lfg_intents.user_id',
  'lfg_invites.inviter_user_id',
  'local_credentials.user_id',
  'post_event_followup_sent.match_id',
  'post_event_reminders_sent.pug_slot_id',
  'pug_slots.claimed_by_user_id',
  'pug_slots.created_by',
  'pug_slots.event_id',
  'sessions.user_id',
  'wow_classic_quest_progress.user_id',
];

/** The hot-path FK columns that ROK-1157 indexed. */
const ROK_1157_INDEXED_FKS = [
  'activity_log.actor_id',
  'availability.game_id',
  'availability.source_event_id',
  'characters.game_id',
  'event_reminders_sent.user_id',
  'event_signups.character_id',
  'event_voice_sessions.user_id',
  'lfg_intents.converted_to_event_id',
  'player_co_play.user_id_b',
  'player_intensity_snapshots.longest_session_game_id',
];

/** Columns that lead a non-partial index, unique constraint or primary key. */
function leadingColumns(table: SnapshotTable): Set<string> {
  const leads = new Set<string>();
  for (const index of Object.values(table.indexes ?? {})) {
    if (index.where) continue;
    const first = index.columns[0];
    if (first && !first.isExpression) leads.add(first.expression);
  }
  const keys = [
    ...Object.values(table.compositePrimaryKeys ?? {}),
    ...Object.values(table.uniqueConstraints ?? {}),
  ];
  for (const key of keys) leads.add(at(key.columns, 0));
  for (const column of Object.values(table.columns)) {
    if (column.primaryKey || column.isUnique) leads.add(column.name);
  }
  return leads;
}

/** Sorted `table.column` for every FK whose first column leads no index. */
function uncoveredFks(snapshot: Snapshot): string[] {
  const uncovered: string[] = [];
  for (const table of Object.values(snapshot.tables)) {
    const leads = leadingColumns(table);
    for (const fk of Object.values(table.foreignKeys ?? {})) {
      const column = at(fk.columnsFrom, 0);
      if (!leads.has(column)) uncovered.push(`${table.name}.${column}`);
    }
  }
  return uncovered.sort();
}

function readSnapshot(prefix: string): Snapshot {
  const file = path.join(META_DIR, `${prefix}_snapshot.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Snapshot;
}

function latestSnapshotPrefix(): string {
  const journal = JSON.parse(
    fs.readFileSync(path.join(META_DIR, '_journal.json'), 'utf8'),
  ) as { entries: { idx: number; tag: string }[] };
  const head = at(
    [...journal.entries].sort((a, b) => b.idx - a.idx),
    0,
  );
  return at(head.tag.split('_'), 0);
}

describe('foreign-key index coverage (ROK-1157)', () => {
  const latest = uncoveredFks(readSnapshot(latestSnapshotPrefix()));
  const preIndex = uncoveredFks(readSnapshot(PRE_INDEX_SNAPSHOT));

  it('the latest snapshot leaves exactly the deferred FKs unindexed', () => {
    expect(latest).toEqual(DEFERRED_UNINDEXED_FKS);
  });

  it('the latest snapshot indexes every ROK-1157 hot-path FK', () => {
    const stillUncovered = ROK_1157_INDEXED_FKS.filter((fk) =>
      latest.includes(fk),
    );
    expect(stillUncovered).toEqual([]);
  });

  it('reports every ROK-1157 hot-path FK as unindexed in the pre-index snapshot', () => {
    const missed = ROK_1157_INDEXED_FKS.filter((fk) => !preIndex.includes(fk));
    expect(missed).toEqual([]);
  });

  it('the deferred list is the pre-index gap minus the ROK-1157 indexes', () => {
    const expected = [...DEFERRED_UNINDEXED_FKS, ...ROK_1157_INDEXED_FKS];
    expect(preIndex).toEqual(expected.sort());
  });
});

/** A one-FK child table whose only index leads on the FK column. */
function childTable(where?: string): Snapshot {
  const table: SnapshotTable = {
    name: 'child',
    columns: {
      id: { name: 'id', primaryKey: true },
      parent_id: { name: 'parent_id' },
    },
    indexes: {
      idx_child_parent_id: { columns: [{ expression: 'parent_id' }], where },
    },
    foreignKeys: { child_parent_id_fk: { columnsFrom: ['parent_id'] } },
  };
  return { tables: { child: table } };
}

describe('foreign-key index coverage rule (ROK-1157)', () => {
  it('counts a plain index leading on the FK column as covering it', () => {
    expect(uncoveredFks(childTable())).toEqual([]);
  });

  it('does not count a partial index as covering its leading FK column', () => {
    const partial = childTable(`"child"."status" = 'active'`);
    expect(uncoveredFks(partial)).toEqual(['child.parent_id']);
  });
});
