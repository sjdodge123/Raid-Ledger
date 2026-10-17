/**
 * ROK-788: Verifies the games Drizzle schema includes apiNamespacePrefix.
 * This test validates that the column is present and has the correct
 * name mapping (api_namespace_prefix -> apiNamespacePrefix).
 */
import { games } from './schema/games';
import { getTableColumns } from 'drizzle-orm';

describe('games schema — apiNamespacePrefix column (ROK-788)', () => {
  it('has an apiNamespacePrefix column mapped to api_namespace_prefix', () => {
    const columns = getTableColumns(games);
    expect(columns.apiNamespacePrefix).toBeDefined();
    expect(columns.apiNamespacePrefix.name).toBe('api_namespace_prefix');
  });

  it('apiNamespacePrefix column is nullable (no notNull)', () => {
    const columns = getTableColumns(games);
    expect(columns.apiNamespacePrefix.notNull).toBe(false);
  });
});
