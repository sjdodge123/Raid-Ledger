/**
 * ROK-2263 — backup-export token storage. Pins the column set, the unique
 * hash, the cascading owner FK and its index. No column may hold a plaintext
 * token — only the sha256 hex hash (char 64) + a 4-char `token_hint`.
 */
import { getTableConfig } from 'drizzle-orm/pg-core';
import { backupExportTokens } from './backup-export-tokens';

const config = getTableConfig(backupExportTokens);

describe('backup_export_tokens schema', () => {
  it('has exactly the pinned column set (no raw token column)', () => {
    expect(config.name).toBe('backup_export_tokens');
    expect(config.columns.map((c) => c.name).sort()).toEqual([
      'created_at',
      'created_by',
      'expires_at',
      'id',
      'label',
      'last_used_at',
      'last_used_ip_coarse',
      'revoked_at',
      'token_hash',
      'token_hint',
    ]);
  });

  it('stores the hash as a unique, not-null char(64)', () => {
    const hash = config.columns.find((c) => c.name === 'token_hash');
    expect(hash?.getSQLType()).toBe('char(64)');
    expect(hash?.notNull).toBe(true);
    const unique = config.columns.filter((c) => c.isUnique).map((c) => c.name);
    expect(unique).toEqual(['token_hash']);
  });

  it('cascades from the minting user and indexes created_by', () => {
    const fks = config.foreignKeys.map((fk) => ({
      cols: fk.reference().columns.map((c) => c.name),
      onDelete: fk.onDelete,
    }));
    expect(fks).toEqual([{ cols: ['created_by'], onDelete: 'cascade' }]);
    expect(config.indexes.map((i) => i.config.name)).toEqual([
      'backup_export_tokens_created_by_idx',
    ]);
  });

  it('leaves expiry, last-use and revocation nullable', () => {
    const nullable = config.columns
      .filter((c) => !c.notNull)
      .map((c) => c.name)
      .sort();
    expect(nullable).toEqual([
      'expires_at',
      'last_used_at',
      'last_used_ip_coarse',
      'revoked_at',
    ]);
  });
});
