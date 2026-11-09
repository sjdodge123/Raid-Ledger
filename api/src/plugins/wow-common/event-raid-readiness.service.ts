import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { EventRaidReadiness } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { SettingsService } from '../../settings/settings.service';
import {
  GuildAccessService,
  type GuildActor,
} from '../../guilds/guild-access.service';
import { loadEventQuestSet } from './event-forever-progress.query';
import type { QuestOverlayDeps } from './dungeon-quests.overlay';
import {
  buildQuestReadiness,
  type ReadinessSignup,
} from './event-quest-readiness.helpers';
import {
  loadEventManualRows,
  loadReadinessEvent,
  loadReadinessRoster,
  type ReadinessEvent,
} from './event-quest-readiness.query';
import { assertCanReadEvent } from './event-readiness.access';
import {
  buildRaidReadiness,
  type ReadinessSignupInput,
} from './event-raid-readiness.helpers';
import { questEvidence } from './event-raid-readiness.evidence';
import type { ResolvedRoster } from './facts/wow-facts.service';
import { WowFactsService } from './facts/wow-facts.service';
import type { RosterCharRef } from './facts/wow-fact.types';
import { loadForeverQuestSources } from './forever-quest-source.query';
import { loadRosterMemberIds } from './guilds/guild-roster.helpers';
import { WOW_FOREVER_GAME_SLUG } from './wow-forever-identity.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** The resolver key of a signup's character; null = no character. */
function refKey(characterId: string | null, members: Map<string, number>) {
  if (characterId === null) return null;
  const memberId = members.get(characterId);
  return memberId === undefined ? `c${characterId}` : `m${memberId}`;
}

/**
 * D6 — `characterId → memberId` for signup characters that are rows of the
 * event guild's latest roster (one query bounded to `charIds`; empty
 * without a guild).
 */
function loadMemberIds(
  db: Db,
  guildId: number | null,
  charIds: readonly string[],
): Promise<Map<string, number>> {
  if (guildId === null) return Promise.resolve(new Map<string, number>());
  return loadRosterMemberIds(db, guildId, charIds);
}

/** One resolver ref per distinct signup character. */
function toRefs(
  signups: readonly ReadinessSignup[],
  members: Map<string, number>,
): RosterCharRef[] {
  const refs = new Map<string, RosterCharRef>();
  for (const s of signups) {
    const key = refKey(s.characterId, members);
    if (key === null || refs.has(key)) continue;
    refs.set(key, {
      key,
      memberId: members.get(s.characterId ?? '') ?? null,
      characterId: s.characterId,
    });
  }
  return [...refs.values()];
}

/**
 * ROK-1926 (W11 of ROK-1905) — `GET plugins/wow-classic/events/:eventId/
 * raid-readiness`: per active signup (tentative + bench included), whether
 * the character meets the event's level, dungeon quests, lockout and item
 * level. Same access order as quest readiness: 404 missing → 403 → 404
 * non-Forever. Every read is batched; no query runs per signup.
 */
@Injectable()
export class EventRaidReadinessService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: Db,
    private readonly access: GuildAccessService,
    private readonly facts: WowFactsService,
    private readonly settings: SettingsService,
  ) {}

  /** The DB plus the quest-import switch the known-quest overlay reads. */
  private get questDeps(): QuestOverlayDeps {
    return { db: this.db, settings: this.settings };
  }

  async readiness(
    actor: GuildActor,
    eventId: number,
  ): Promise<EventRaidReadiness> {
    const event = await loadReadinessEvent(this.db, eventId);
    if (!event) throw new NotFoundException('Event not found');
    await assertCanReadEvent(this.db, this.access, actor, eventId, event);
    if (event.slug !== WOW_FOREVER_GAME_SLUG) {
      throw new NotFoundException('Raid readiness is for Forever events only');
    }
    return this.build(eventId, event);
  }

  private async build(
    eventId: number,
    event: ReadinessEvent,
  ): Promise<EventRaidReadiness> {
    const [quests, signups, manual] = await Promise.all([
      loadEventQuestSet(this.questDeps, event.contentInstances),
      loadReadinessRoster(this.db, eventId),
      loadEventManualRows(this.db, eventId),
    ]);
    const charIds = signups.flatMap((s) => s.characterId ?? []);
    const [snapshots, members] = await Promise.all([
      loadForeverQuestSources(this.db, charIds),
      loadMemberIds(this.db, event.guildId, charIds),
    ]);
    const qr = buildQuestReadiness({ quests, signups, snapshots, manual });
    const { facts } = await this.facts.resolveFacts(toRefs(signups, members));
    return buildRaidReadiness({
      event: {
        id: eventId,
        title: event.title,
        startTime: event.duration[0],
        contentInstances: event.contentInstances,
      },
      questCount: qr.quests.length,
      signups: signups.map((s, i) => ({
        ...toSignupInput(s, qr.signups[i]?.perQuest ?? null, members, facts),
        questEvidence: questEvidence(qr.signups[i], snapshots, manual),
      })),
    });
  }
}

/** One signup's builder input (facts null without a character). */
function toSignupInput(
  s: ReadinessSignup,
  perQuest: ReadinessSignupInput['perQuest'],
  members: Map<string, number>,
  facts: ResolvedRoster,
): Omit<ReadinessSignupInput, 'questEvidence'> {
  const key = refKey(s.characterId, members);
  return {
    userId: s.userId,
    characterId: s.characterId,
    name: s.characterName ?? s.username,
    facts: key === null ? null : (facts.get(key) ?? null),
    perQuest,
  };
}
