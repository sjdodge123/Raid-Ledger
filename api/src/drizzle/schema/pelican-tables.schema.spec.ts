/**
 * ROK-1772 §3 / ROK-1773 — Pelican tables security guard.
 *
 * Member-facing surfaces must never reach a host:port, a panel uuid or a
 * schedule's console command. The column sets are pinned exactly, and no
 * column may carry an address/ip/port/node/host/payload/command token. The one
 * permitted uuid column is `pelican_servers.panel_uuid` (the upsert key, which
 * never leaves the API). Widening either table needs a security review, not a
 * test edit.
 */
import { getTableConfig } from 'drizzle-orm/pg-core';
import { GameServerEffectSchema } from '@raid-ledger/contract';
import { pelicanServers } from './pelican-servers';
import { pelicanSchedules } from './pelican-schedules';

const SERVER_COLUMNS = [
  'current_state',
  'game_id',
  'id',
  'identifier',
  'is_suspended',
  'last_synced_at',
  'missing_since',
  'name',
  'panel_uuid',
  'show_on_calendar',
  'status_checked_at',
  'timezone',
];

const SCHEDULE_COLUMNS = [
  'cron_day_of_month',
  'cron_day_of_week',
  'cron_hour',
  'cron_minute',
  'cron_month',
  'effect',
  'effect_offset_s',
  'id',
  'is_active',
  'last_run_at',
  'name',
  'next_run_at',
  'only_when_online',
  'panel_schedule_id',
  'server_id',
];

const FORBIDDEN_TOKENS = [
  'address',
  'addr',
  'allocation',
  'command',
  'host',
  'ip',
  'node',
  'payload',
  'port',
  'uuid',
];

/** Columns allowed to carry an otherwise-forbidden token. */
const PERMITTED = new Set(['pelican_servers.panel_uuid']);

function forbiddenColumns(table: string, names: string[]): string[] {
  return names.filter(
    (n) =>
      !PERMITTED.has(`${table}.${n}`) &&
      n.split('_').some((tok) => FORBIDDEN_TOKENS.includes(tok)),
  );
}

describe('pelican_servers schema (ROK-1772 §3)', () => {
  const config = getTableConfig(pelicanServers);
  const names = config.columns.map((c) => c.name);

  it('is the pelican_servers table', () => {
    expect(config.name).toBe('pelican_servers');
  });

  it('has exactly the pinned column set', () => {
    expect([...names].sort()).toEqual(SERVER_COLUMNS);
  });

  it('has no address/ip/port/node/payload/command/uuid column besides panel_uuid', () => {
    expect(forbiddenColumns(config.name, names)).toEqual([]);
  });

  it('nulls game_id when the game is deleted, and indexes it', () => {
    const fks = config.foreignKeys.map((fk) => ({
      cols: fk.reference().columns.map((c) => c.name),
      onDelete: fk.onDelete,
    }));
    expect(fks).toEqual([{ cols: ['game_id'], onDelete: 'set null' }]);
    const idx = config.indexes.map((i) => i.config.name);
    expect(idx).toContain('pelican_servers_game_id_idx');
  });
});

describe('pelican_schedules schema (ROK-1772 §3 / ROK-1773)', () => {
  const config = getTableConfig(pelicanSchedules);
  const names = config.columns.map((c) => c.name);

  it('is the pelican_schedules table', () => {
    expect(config.name).toBe('pelican_schedules');
  });

  it('has exactly the pinned column set', () => {
    expect([...names].sort()).toEqual(SCHEDULE_COLUMNS);
  });

  it('has no payload/command/address/ip/port/node/uuid column', () => {
    expect(forbiddenColumns(config.name, names)).toEqual([]);
  });

  it('cascades from pelican_servers', () => {
    const fks = config.foreignKeys.map((fk) => ({
      cols: fk.reference().columns.map((c) => c.name),
      onDelete: fk.onDelete,
    }));
    expect(fks).toEqual([{ cols: ['server_id'], onDelete: 'cascade' }]);
  });

  /** The literal text of a CHECK lives in its SQL template's string chunks. */
  function checkSqlText(name: string): string {
    const chk = config.checks.find((c) => c.name === name);
    expect(chk).toBeDefined();
    return (chk?.value.queryChunks ?? [])
      .flatMap((c) =>
        typeof c === 'object' && c !== null && 'value' in c
          ? [String(c.value)]
          : [],
      )
      .join('');
  }

  it('restricts effect to every GameServerEffectSchema value', () => {
    const sqlText = checkSqlText('pelican_schedules_effect_chk');
    for (const effect of GameServerEffectSchema.options) {
      expect(sqlText).toContain(`'${effect}'`);
    }
  });

  it('bounds effect_offset_s to one day (running sum of task offsets)', () => {
    expect(checkSqlText('pelican_schedules_effect_offset_chk')).toContain(
      'BETWEEN 0 AND 86400',
    );
  });
});

describe('forbiddenColumns guard', () => {
  it('flags a smuggled host:port or payload column', () => {
    expect(
      forbiddenColumns('pelican_servers', [
        'name',
        'ip_address',
        'port',
        'node_id',
        'task_payload',
        'node_uuid',
      ]),
    ).toEqual(['ip_address', 'port', 'node_id', 'task_payload', 'node_uuid']);
  });
});
