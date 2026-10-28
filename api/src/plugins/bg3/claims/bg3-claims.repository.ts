/**
 * ROK-1957 §5.5 — party claim reads/writes. Each write is one statement
 * (no surrounding tx), so a unique violation on a lost race is safe to map.
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;
const p = schema.bg3PartyClaims;
const s = schema.bg3Saves;

/** Rows tied for "newest" are few; 20 covers every duplicate of the top save. */
const NEWEST_ROWS = 20;

export interface Bg3ClaimRow {
  slotKey: string;
  userId: number;
}

@Injectable()
export class Bg3ClaimsRepository {
  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  /** The campaign's newest rows (party only), for `pickCanonical`. */
  newestSaves(campaignId: number) {
    return this.db
      .select({
        id: s.id,
        uploaderUserId: s.uploaderUserId,
        campaignKey: s.campaignKey,
        savedAt: s.savedAt,
        party: s.party,
      })
      .from(s)
      .where(eq(s.campaignId, campaignId))
      .orderBy(desc(s.savedAt), asc(s.id))
      .limit(NEWEST_ROWS);
  }

  /** Claims that hold this slot or belong to this user, in the campaign. */
  conflicts(campaignId: number, slotKey: string, userId: number) {
    return this.db
      .select({ slotKey: p.slotKey, userId: p.userId })
      .from(p)
      .where(
        and(
          eq(p.campaignId, campaignId),
          or(eq(p.slotKey, slotKey), eq(p.userId, userId)),
        ),
      );
  }

  async insert(campaignId: number, slotKey: string, userId: number) {
    await this.db.insert(p).values({ campaignId, slotKey, userId });
  }

  async find(campaignId: number, slotKey: string): Promise<Bg3ClaimRow | null> {
    const [row] = await this.db
      .select({ slotKey: p.slotKey, userId: p.userId })
      .from(p)
      .where(and(eq(p.campaignId, campaignId), eq(p.slotKey, slotKey)))
      .limit(1);
    return row ?? null;
  }

  async delete(campaignId: number, slotKey: string): Promise<void> {
    await this.db
      .delete(p)
      .where(and(eq(p.campaignId, campaignId), eq(p.slotKey, slotKey)));
  }
}
