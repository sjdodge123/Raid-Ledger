import { Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ValheimSkill } from '@raid-ledger/contract';
import * as schema from '../../../drizzle/schema';
import type { ValheimLinkTx } from '../link/valheim-link-token-lock';
import {
  SKILL_DAYS_RETAINED,
  playDateIn,
  resolvePlayTimezone,
} from './valheim-skill-days.helpers';

type Exec = PostgresJsDatabase<typeof schema> | ValheimLinkTx;
const {
  valheimProfileSkillDays: days,
  valheimProfiles: profiles,
  pelicanServers: servers,
} = schema;

/** A character's natural key (`valheim_profiles_identity_uq`). */
export interface ValheimCharacterKey {
  pelicanServerId: number;
  steamId: string;
  playerId: string;
}

/**
 * The game server's own IANA timezone, or null when none is stored. Shared
 * by the skill and container play-day recorders (ROK-2014).
 */
export async function selectServerTimezone(
  exec: Exec,
  pelicanServerId: number,
): Promise<string | null> {
  const [row] = await exec
    .select({ tz: servers.timezone })
    .from(servers)
    .where(eq(servers.id, pelicanServerId));
  return row?.tz ?? null;
}

/**
 * ROK-1882: per-play-day skill history. Every write runs on the importer's
 * transaction — no catch-and-retry (a failed statement poisons the tx).
 */
@Injectable()
export class ValheimSkillDaysRepository {
  /** The character's stored skills BEFORE this import; null for a new character. */
  async findPriorSkills(
    tx: ValheimLinkTx,
    key: ValheimCharacterKey,
  ): Promise<ValheimSkill[] | null> {
    const [row] = await tx
      .select({ skills: profiles.skills })
      .from(profiles)
      .where(
        and(
          eq(profiles.pelicanServerId, key.pelicanServerId),
          eq(profiles.steamId, key.steamId),
          eq(profiles.playerId, key.playerId),
        ),
      );
    return row?.skills ?? null;
  }

  /** The game server's own IANA timezone, or null when none is stored. */
  findServerTimezone(
    tx: ValheimLinkTx,
    pelicanServerId: number,
  ): Promise<string | null> {
    return selectServerTimezone(tx, pelicanServerId);
  }

  /**
   * Record a freshly upserted profile on its play day, then prune to the
   * newest {@link SKILL_DAYS_RETAINED} days. A new day stores `startSkills`
   * as its start; a later import that day moves only `end_skills` and
   * `last_seen_at` (never backwards).
   */
  async recordDay(
    tx: ValheimLinkTx,
    profile: schema.ValheimProfileRow,
    startSkills: ValheimSkill[],
    defaultTz: string | null,
  ): Promise<string> {
    const serverTz = await this.findServerTimezone(tx, profile.pelicanServerId);
    const playDate = playDateIn(
      profile.capturedAt,
      resolvePlayTimezone(serverTz, defaultTz),
    );
    await this.upsertDay(tx, profile, playDate, startSkills);
    await this.prune(tx, profile.id);
    return playDate;
  }

  /** Newest-first play days for a character (lane 3's trend read). */
  listRecentDays(
    exec: Exec,
    profileId: number,
    limit: number,
  ): Promise<schema.ValheimProfileSkillDayRow[]> {
    return exec
      .select()
      .from(days)
      .where(eq(days.profileId, profileId))
      .orderBy(desc(days.playDate))
      .limit(limit);
  }

  private async upsertDay(
    tx: ValheimLinkTx,
    profile: schema.ValheimProfileRow,
    playDate: string,
    startSkills: ValheimSkill[],
  ): Promise<void> {
    await tx
      .insert(days)
      .values({
        profileId: profile.id,
        playDate,
        firstSeenAt: profile.capturedAt,
        lastSeenAt: profile.capturedAt,
        startSkills,
        endSkills: profile.skills,
      })
      .onConflictDoUpdate({
        target: [days.profileId, days.playDate],
        set: {
          endSkills: sql`excluded.end_skills`,
          lastSeenAt: sql`excluded.last_seen_at`,
        },
        setWhere: sql`${days.lastSeenAt} <= excluded.last_seen_at`,
      });
  }

  /** Delete every day older than the profile's Nth-newest (no-op below N). */
  private async prune(tx: ValheimLinkTx, profileId: number): Promise<void> {
    const keepFrom = sql`(SELECT d.play_date FROM ${days} d
      WHERE d.profile_id = ${profileId}
      ORDER BY d.play_date DESC OFFSET ${SKILL_DAYS_RETAINED - 1} LIMIT 1)`;
    await tx
      .delete(days)
      .where(
        and(eq(days.profileId, profileId), sql`${days.playDate} < ${keepFrom}`),
      );
  }
}
