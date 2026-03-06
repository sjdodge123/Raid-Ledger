import { and, isNotNull, gte, sql, ilike, eq, isNull } from 'drizzle-orm';
import {
  escapeLikePattern,
  buildWordMatchFilters,
} from '../../common/search.util';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schemaType from '../../drizzle/schema';
import * as schema from '../../drizzle/schema';

/**
 * Autocomplete for game names in the games catalog.
 */
export async function autocompleteGames(
  db: PostgresJsDatabase<typeof schemaType>,
  value: string,
): Promise<Array<{ name: string; value: string }>> {
  const filters = buildWordMatchFilters(schema.games.name, value);
  const results = await db
    .select({ id: schema.games.id, name: schema.games.name })
    .from(schema.games)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .limit(25);

  return results.map((g) => ({ name: g.name, value: g.name }));
}

/**
 * Autocomplete for event series (recurrence groups).
 */
export async function autocompleteSeries(
  db: PostgresJsDatabase<typeof schemaType>,
  value: string,
): Promise<Array<{ name: string; value: string }>> {
  const results = await queryActiveSeries(db, value.toLowerCase());
  return results
    .filter(
      (r): r is typeof r & { recurrenceGroupId: string } =>
        r.recurrenceGroupId !== null,
    )
    .map(formatSeriesOption);
}

/** Query active series matching search text. */
async function queryActiveSeries(
  db: PostgresJsDatabase<typeof schemaType>,
  searchValue: string,
): Promise<
  Array<{
    recurrenceGroupId: string | null;
    title: string;
    recurrenceRule: unknown;
  }>
> {
  const now = new Date().toISOString();
  return db
    .selectDistinctOn([schema.events.recurrenceGroupId], {
      recurrenceGroupId: schema.events.recurrenceGroupId,
      title: schema.events.title,
      recurrenceRule: schema.events.recurrenceRule,
    })
    .from(schema.events)
    .where(
      and(
        isNotNull(schema.events.recurrenceGroupId),
        gte(sql`upper(${schema.events.duration})`, sql`${now}::timestamp`),
        sql`${schema.events.cancelledAt} IS NULL`,
        searchValue
          ? ilike(schema.events.title, `%${escapeLikePattern(searchValue)}%`)
          : undefined,
      ),
    )
    .limit(25);
}

/** Format a series row into an autocomplete option. */
function formatSeriesOption(r: {
  recurrenceGroupId: string;
  title: string;
  recurrenceRule: unknown;
}): { name: string; value: string } {
  const rule = r.recurrenceRule as { frequency?: string } | null;
  const freq = rule?.frequency ? ` (${rule.frequency})` : '';
  const label = `${r.title}${freq}`.slice(0, 100);
  return { name: label, value: r.recurrenceGroupId };
}

/**
 * Autocomplete for upcoming events a user can manage.
 */
export async function autocompleteEvents(
  db: PostgresJsDatabase<typeof schemaType>,
  discordId: string,
  searchValue: string,
): Promise<Array<{ name: string; value: string }>> {
  const user = await lookupUserForAutocomplete(db, discordId);
  const conditions = buildEventConditions(user, searchValue);
  const results = await db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      duration: schema.events.duration,
    })
    .from(schema.events)
    .where(and(...conditions))
    .orderBy(sql`lower(${schema.events.duration})`)
    .limit(25);
  return results.map(formatEventOption);
}

/** Look up a user for autocomplete permission filtering. */
async function lookupUserForAutocomplete(
  db: PostgresJsDatabase<typeof schemaType>,
  discordId: string,
): Promise<{ id: number; role: string } | null> {
  const [user] = await db
    .select({ id: schema.users.id, role: schema.users.role })
    .from(schema.users)
    .where(eq(schema.users.discordId, discordId))
    .limit(1);
  return user ?? null;
}

/** Build WHERE conditions for event autocomplete. */
function buildEventConditions(
  user: { id: number; role: string } | null,
  searchValue: string,
): ReturnType<typeof gte>[] {
  const now = new Date().toISOString();
  const conditions = [
    gte(sql`upper(${schema.events.duration})`, sql`${now}::timestamp`),
    isNull(schema.events.cancelledAt),
  ];
  if (user && user.role !== 'admin' && user.role !== 'operator') {
    conditions.push(eq(schema.events.creatorId, user.id));
  }
  if (searchValue) {
    conditions.push(
      ilike(
        schema.events.title,
        `%${escapeLikePattern(searchValue.toLowerCase())}%`,
      ),
    );
  }
  return conditions;
}

/** Format an event row into an autocomplete option. */
function formatEventOption(e: {
  id: number;
  title: string;
  duration: [Date, Date];
}): { name: string; value: string } {
  const date = e.duration[0].toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
  const label = `${e.title} (${date})`.slice(0, 100);
  return { name: label, value: String(e.id) };
}
