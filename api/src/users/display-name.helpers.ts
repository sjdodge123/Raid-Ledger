import { sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

export function resolveDisplayName({
  displayName,
  username,
}: {
  displayName?: string | null;
  username: string;
}): string {
  return displayName || username;
}

export function displayNameSql<
  T extends { displayName: PgColumn; username: PgColumn },
>(table: T): SQL<string> {
  return sql<string>`COALESCE(${table.displayName}, ${table.username})`;
}
