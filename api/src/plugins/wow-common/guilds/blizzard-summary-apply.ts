/**
 * ROK-1170 — apply one WoW: Forever guild summary fetch to `guilds`: founded
 * date, Blizzard guild id, faction and the `ok`/`not_found`/`disbanded`/`error`
 * state. Runs OUTSIDE the roster transaction and never throws, so a summary
 * failure can never change a roster sync's result (AC6).
 */
import * as Sentry from '@sentry/nestjs';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../../drizzle/schema';
import type { SummaryFetch } from '../blizzard-forever-guild-summary.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type Logger = { warn: (msg: string) => void };

/** Two 404s at least this far apart (from the first) mean `disbanded`. */
export const DISBANDED_AFTER_MS = 6 * 60 * 60 * 1000;

/** The guild columns the two-strike and id-change rules read. */
export interface SummaryState {
  blizzardGuildId: number | null;
  blizzardNotFoundSince: Date | null;
}

/** Which guild, under which slug (a write only lands while it still holds). */
export interface SummaryTarget {
  id: number;
  region: string;
  slug: string;
}

/** The columns one summary outcome writes. */
export type SummaryPatch = Partial<
  Pick<
    schema.GuildInsert,
    | 'blizzardGuildId'
    | 'foundedAt'
    | 'faction'
    | 'blizzardSummaryStatus'
    | 'blizzardNotFoundSince'
  >
>;

/**
 * Pure: the columns to write for one fetch (spec Lane 2 item 3).
 * @returns the patch, and `mismatch` when a 200 named a different guild id.
 */
export function summaryPatch(
  state: SummaryState,
  fetch: SummaryFetch,
  now: Date,
): { patch: SummaryPatch; mismatch: boolean } {
  if (fetch.kind === 'not_found') {
    return { patch: notFoundPatch(state, now), mismatch: false };
  }
  const { blizzardGuildId, foundedAt, faction } = fetch.summary;
  const stored = state.blizzardGuildId;
  if (
    stored !== null &&
    blizzardGuildId !== null &&
    stored !== blizzardGuildId
  ) {
    return { patch: { blizzardSummaryStatus: 'error' }, mismatch: true };
  }
  const patch: SummaryPatch = {
    blizzardGuildId: blizzardGuildId ?? stored,
    // An unparseable founded date never erases a stored one (like faction).
    ...(foundedAt !== null ? { foundedAt } : {}),
    // Blizzard wins on a 200; LedgerLink stays the fallback (Q10). Same
    // `Alliance`/`Horde` casing LedgerLink writes (F8).
    ...(faction !== null ? { faction } : {}),
    blizzardSummaryStatus: 'ok',
    blizzardNotFoundSince: null,
  };
  return { patch, mismatch: false };
}

/** 404: never-200 → `not_found`; else two strikes ≥6h apart → `disbanded`. */
function notFoundPatch(state: SummaryState, now: Date): SummaryPatch {
  if (state.blizzardGuildId === null)
    return { blizzardSummaryStatus: 'not_found' };
  const since = state.blizzardNotFoundSince;
  if (since === null) {
    return { blizzardSummaryStatus: 'not_found', blizzardNotFoundSince: now };
  }
  const elapsed = now.getTime() - since.getTime();
  return {
    blizzardSummaryStatus:
      elapsed >= DISBANDED_AFTER_MS ? 'disbanded' : 'not_found',
  };
}

/**
 * Write one fetch's outcome; an id change also raises a tags-only Sentry flag.
 * The write is guarded on the slug, so a slug changed mid-fetch writes nothing.
 */
export async function applyForeverGuildSummary(
  db: Db,
  guild: SummaryTarget & SummaryState,
  fetch: SummaryFetch,
  now: Date,
): Promise<void> {
  const { patch, mismatch } = summaryPatch(guild, fetch, now);
  if (mismatch) {
    Sentry.captureMessage('Forever guild summary id mismatch', {
      level: 'warning',
      tags: { guildId: String(guild.id), region: guild.region },
      fingerprint: ['forever-guild-summary-id-mismatch', String(guild.id)],
    });
  }
  await writePatch(db, guild, patch);
}

/** Update the guild row only while it still has `target.slug`. */
async function writePatch(
  db: Db,
  target: SummaryTarget,
  patch: SummaryPatch,
): Promise<void> {
  const g = schema.guilds;
  await db
    .update(g)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(g.id, target.id), eq(g.guildSlug, target.slug)));
}

/** The two rule columns, read fresh after the fetch; null when gone. */
async function readState(
  db: Db,
  guildId: number,
): Promise<SummaryState | null> {
  const g = schema.guilds;
  const [row] = await db
    .select({
      blizzardGuildId: g.blizzardGuildId,
      blizzardNotFoundSince: g.blizzardNotFoundSince,
    })
    .from(g)
    .where(eq(g.id, guildId))
    .limit(1);
  return row ?? null;
}

/**
 * Fetch + apply one guild's summary. Never throws: a failure records status
 * `error` and goes to Sentry (tags only — never the token or the body).
 */
export async function syncForeverGuildSummary(
  db: Db,
  fetchSummary: () => Promise<SummaryFetch>,
  target: SummaryTarget,
  logger: Logger,
): Promise<void> {
  try {
    const fetch = await fetchSummary();
    const state = await readState(db, target.id);
    if (state === null) return;
    await applyForeverGuildSummary(
      db,
      { ...target, ...state },
      fetch,
      new Date(),
    );
  } catch (err: unknown) {
    await recordSummaryFailure(db, target, err, logger);
  }
}

/** Status `error` + Sentry; a failing status write is only logged. */
async function recordSummaryFailure(
  db: Db,
  target: SummaryTarget,
  err: unknown,
  logger: Logger,
): Promise<void> {
  Sentry.captureException(err, {
    tags: { guildId: String(target.id), region: target.region },
  });
  const msg = err instanceof Error ? err.message : 'Unknown error';
  logger.warn(
    `Forever guild summary sync failed for guild ${target.id}: ${msg}`,
  );
  try {
    await writePatch(db, target, { blizzardSummaryStatus: 'error' });
  } catch (e: unknown) {
    const m = e instanceof Error ? e.message : 'Unknown error';
    logger.warn(`Could not record guild summary error for ${target.id}: ${m}`);
  }
}
