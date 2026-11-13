import { and, eq, sql } from 'drizzle-orm';
import type { GgVoiceCardSchema } from '@raid-ledger/contract';
import type { z } from 'zod';
import { events, eventVoiceSessions } from '../../../../drizzle/schema';
import type { GgCardContext } from '../gg-card.registry';
import { ggEventInWindow } from './events.queries';

export type GgVoiceCard = z.infer<typeof GgVoiceCardSchema>;

/** Metric 8 — the user's event voice time over the year's counted events. */
export async function loadYearVoice(ctx: GgCardContext): Promise<GgVoiceCard> {
  const [row] = await ctx.db
    .select({
      totalSeconds: sql<number>`coalesce(sum(${eventVoiceSessions.totalDurationSec}), 0)::int`,
      sessions: sql<number>`count(*)::int`,
    })
    .from(eventVoiceSessions)
    .innerJoin(events, eq(events.id, eventVoiceSessions.eventId))
    .where(
      and(
        eq(eventVoiceSessions.userId, ctx.userId),
        ggEventInWindow(ctx.window),
      ),
    );
  return { totalSeconds: row?.totalSeconds ?? 0, sessions: row?.sessions ?? 0 };
}

/** Core card `voice`; omitted when the user spent no time in event voice. */
export async function produceVoiceCard(
  ctx: GgCardContext,
): Promise<GgVoiceCard | null> {
  const voice = await loadYearVoice(ctx);
  return voice.sessions === 0 || voice.totalSeconds === 0 ? null : voice;
}
