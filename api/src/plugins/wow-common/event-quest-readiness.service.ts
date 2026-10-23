import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { EventQuestReadinessDto } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import {
  GuildAccessService,
  isStaff,
  type GuildActor,
} from '../../guilds/guild-access.service';
import { loadEventQuestSet } from './event-forever-progress.query';
import { buildQuestReadiness } from './event-quest-readiness.helpers';
import {
  hasActiveSignup,
  loadEventManualRows,
  loadReadinessEvent,
  loadReadinessRoster,
  type ReadinessEvent,
} from './event-quest-readiness.query';
import { loadForeverCharSnapshots } from './forever-char-snapshot.query';
import { WOW_FOREVER_GAME_SLUG } from './wow-forever-identity.helpers';

/**
 * ROK-1911 (H9 of ROK-1905) — `GET plugins/wow-classic/events/:eventId/
 * quest-readiness`: every active signup's state on the event's dungeon quests.
 * 404 when the event is missing; 403 unless staff, a member of the event's
 * guild, or an active signup; then 404 for a non-Forever event (D7 — Classic
 * events have no readiness view and their quest routes are untouched).
 */
@Injectable()
export class EventQuestReadinessService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly access: GuildAccessService,
  ) {}

  /** The readiness matrix; every read is batched (no per-signup query). */
  async readiness(
    actor: GuildActor,
    eventId: number,
  ): Promise<EventQuestReadinessDto> {
    const event = await loadReadinessEvent(this.db, eventId);
    if (!event) throw new NotFoundException('Event not found');
    await this.assertCanRead(actor, eventId, event);
    if (event.slug !== WOW_FOREVER_GAME_SLUG) {
      throw new NotFoundException('Quest readiness is for Forever events only');
    }
    const [quests, signups, manual] = await Promise.all([
      loadEventQuestSet(this.db, event.contentInstances),
      loadReadinessRoster(this.db, eventId),
      loadEventManualRows(this.db, eventId),
    ]);
    const charIds = signups.flatMap((s) => s.characterId ?? []);
    const snapshots = await loadForeverCharSnapshots(this.db, charIds);
    return buildQuestReadiness({ quests, signups, snapshots, manual });
  }

  /** Staff, the event's guild members, or the event's active signups. */
  private async assertCanRead(
    actor: GuildActor,
    eventId: number,
    event: ReadinessEvent,
  ): Promise<void> {
    if (isStaff(actor)) return;
    if (event.guildId !== null) {
      if (await this.access.canView(actor, event.guildId)) return;
    }
    if (await hasActiveSignup(this.db, eventId, actor.id)) return;
    throw new ForbiddenException('Not a member of this event or its guild');
  }
}
