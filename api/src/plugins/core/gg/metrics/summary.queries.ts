import { eq } from 'drizzle-orm';
import type { GgIntroCard, GgSummaryCard } from '@raid-ledger/contract';
import { users } from '../../../../drizzle/schema';
import type { GgCardContext } from '../gg-card.registry';
import { gameRefOf, totalsByGame } from './games.helpers';
import { loadYearRollups } from './games.queries';
import { loadYearCoPlayers } from './people.queries';
import { pickSuperlative } from './superlatives.helpers';
import { loadSuperlativeInputs } from './superlatives.queries';

/**
 * Core card `intro` — always present for an existing user. The contract
 * carries `memberSince` only: year + tier live on the snapshot, display and
 * community name come from the signed-in session / branding.
 */
export async function produceIntroCard(
  ctx: GgCardContext,
): Promise<GgIntroCard> {
  const [row] = await ctx.db
    .select({ createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, ctx.userId));
  return { memberSince: row ? row.createdAt.toISOString() : null };
}

/**
 * Core card `summary` — always present. Built from the same loaders as the
 * superlative, hours/top-games and people cards so the numbers never drift.
 */
export async function produceSummaryCard(
  ctx: GgCardContext,
): Promise<GgSummaryCard> {
  const [inputs, rollups, coPlayers] = await Promise.all([
    loadSuperlativeInputs(ctx),
    loadYearRollups(ctx),
    loadYearCoPlayers(ctx),
  ]);
  const totals = totalsByGame(rollups);
  return {
    eventsAttended: inputs.attended,
    hoursPlayedSeconds: totals.reduce((sum, t) => sum + t.seconds, 0),
    topGames: totals.slice(0, 3).map(gameRefOf),
    playedWithCount: coPlayers.length,
    superlative: pickSuperlative(inputs).key,
  };
}
