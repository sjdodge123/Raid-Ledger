import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  aggregateCoPlay,
  type SignupRow,
  type VoiceSessionRow,
} from '../co-play-graph.helpers';

type Db = PostgresJsDatabase<typeof schema>;

export async function runBuildCoPlayGraph(db: Db): Promise<void> {
  const voiceSessions = await db.select().from(schema.eventVoiceSessions);
  const events = await db.select().from(schema.events);
  const eventGameMap = new Map(events.map((e) => [e.id, e.gameId]));

  const voiceSessionsByEvent = new Map<number, VoiceSessionRow[]>();
  for (const vs of voiceSessions) {
    const list = voiceSessionsByEvent.get(vs.eventId) ?? [];
    list.push({
      eventId: vs.eventId,
      userId: vs.userId,
      gameId: eventGameMap.get(vs.eventId) ?? null,
      segments: vs.segments ?? [],
    });
    voiceSessionsByEvent.set(vs.eventId, list);
  }

  const signups = await db
    .select()
    .from(schema.eventSignups)
    .where(sql`${schema.eventSignups.status} IN ('signed_up', 'confirmed')`);
  const signupsByEvent = new Map<number, SignupRow[]>();
  for (const s of signups) {
    const list = signupsByEvent.get(s.eventId) ?? [];
    list.push({
      eventId: s.eventId,
      userId: s.userId,
      gameId: eventGameMap.get(s.eventId) ?? null,
    });
    signupsByEvent.set(s.eventId, list);
  }

  const aggregates = aggregateCoPlay(voiceSessionsByEvent, signupsByEvent);

  // Wipe and reinsert — pair count is small relative to team size, and this
  // gives deterministic canonical ordering.
  await db.delete(schema.playerCoPlay);
  if (aggregates.length === 0) return;

  await db.insert(schema.playerCoPlay).values(
    aggregates.map((a) => ({
      userIdA: a.userIdA,
      userIdB: a.userIdB,
      sessionCount: a.sessionCount,
      totalMinutes: a.totalMinutes,
      lastPlayedAt: a.lastPlayedAt,
      gamesPlayed: a.gamesPlayed,
    })),
  );
}
