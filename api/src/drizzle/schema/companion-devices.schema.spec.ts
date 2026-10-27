/**
 * ROK-1955 — companion device storage. Pins both tables' column sets, fks,
 * keys and CHECKs. No column may hold a plaintext token, device code or user
 * code — only sha256 hex hashes + a 4-char `token_hint`.
 */
import { getTableConfig } from 'drizzle-orm/pg-core';
import { companionDevices, companionDeviceLinks } from './companion-devices';

type Config = ReturnType<typeof getTableConfig>;

function columnNames(config: Config): string[] {
  return config.columns.map((c) => c.name).sort();
}

function fks(
  config: Config,
): { cols: string[]; onDelete: string | undefined }[] {
  return config.foreignKeys
    .map((fk) => ({
      cols: fk.reference().columns.map((c) => c.name),
      onDelete: fk.onDelete,
    }))
    .sort((a, b) => a.cols.join().localeCompare(b.cols.join()));
}

function indexNames(config: Config): string[] {
  return config.indexes.map((i) => i.config.name ?? '').sort();
}

function checkNames(config: Config): string[] {
  return config.checks.map((c) => c.name).sort();
}

describe('companion_devices schema', () => {
  const config = getTableConfig(companionDevices);

  it('has exactly the pinned column set (no raw token column)', () => {
    expect(config.name).toBe('companion_devices');
    expect(columnNames(config)).toEqual([
      'app_version',
      'created_at',
      'id',
      'last_used_at',
      'last_used_ip_coarse',
      'name',
      'os',
      'os_version',
      'revoked_at',
      'scope',
      'token_hash',
      'token_hint',
      'user_id',
    ]);
  });

  it('is one row per hash, cascades from the user and indexes user_id', () => {
    const unique = config.columns.filter((c) => c.isUnique).map((c) => c.name);
    expect(unique).toEqual(['token_hash']);
    expect(fks(config)).toEqual([{ cols: ['user_id'], onDelete: 'cascade' }]);
    expect(indexNames(config)).toEqual(['companion_devices_user_id_idx']);
  });

  it("defaults scope to 'companion:ingest' and pins it with a CHECK", () => {
    const scope = config.columns.find((c) => c.name === 'scope');
    expect(scope?.notNull).toBe(true);
    expect(scope?.default).toBe('companion:ingest');
    expect(checkNames(config)).toEqual(['companion_devices_scope_chk']);
  });
});

describe('companion_device_links schema', () => {
  const config = getTableConfig(companionDeviceLinks);

  it('has exactly the pinned column set (hashed codes only)', () => {
    expect(config.name).toBe('companion_device_links');
    expect(columnNames(config)).toEqual([
      'app_version',
      'created_at',
      'decided_at',
      'decided_by',
      'device_code_hash',
      'device_id',
      'device_name',
      'device_os',
      'device_os_version',
      'expires_at',
      'id',
      'interval_sec',
      'last_polled_at',
      'requested_ip_coarse',
      'status',
      'user_code_hash',
    ]);
  });

  it('cascades from the decider, nulls the device on delete', () => {
    expect(fks(config)).toEqual([
      { cols: ['decided_by'], onDelete: 'cascade' },
      { cols: ['device_id'], onDelete: 'set null' },
    ]);
  });

  it('keys the device code and only pending user codes', () => {
    const unique = config.columns.filter((c) => c.isUnique).map((c) => c.name);
    expect(unique).toEqual(['device_code_hash']);
    const pendingUq = config.indexes.find(
      (i) => i.config.name === 'companion_device_links_user_code_pending_uq',
    );
    expect(pendingUq?.config.unique).toBe(true);
    expect(pendingUq?.config.where).toBeDefined();
    expect(indexNames(config)).toEqual([
      'companion_device_links_decided_by_idx',
      'companion_device_links_device_id_idx',
      'companion_device_links_expires_at_idx',
      'companion_device_links_user_code_pending_uq',
    ]);
  });

  it('defaults interval_sec to 5 and CHECKs the status set', () => {
    const interval = config.columns.find((c) => c.name === 'interval_sec');
    expect(interval?.notNull).toBe(true);
    expect(interval?.default).toBe(5);
    expect(checkNames(config)).toEqual(['companion_device_links_status_chk']);
  });
});
