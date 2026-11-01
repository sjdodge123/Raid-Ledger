/**
 * ROK-1926 (D3) — the one access rule shared by the event readiness
 * endpoints (quest readiness, raid readiness): staff, a member of the event's
 * guild (`GuildAccessService.canView`), or an active signup of the event.
 * Anyone else is refused with 403.
 */
import { ForbiddenException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import {
  isStaff,
  type GuildAccessService,
  type GuildActor,
} from '../../guilds/guild-access.service';
import {
  hasActiveSignup,
  type ReadinessEvent,
} from './event-quest-readiness.query';

/**
 * @throws ForbiddenException unless staff, the event guild's member, or an
 * active signup of the event.
 */
export async function assertCanReadEvent(
  db: PostgresJsDatabase<typeof schema>,
  access: Pick<GuildAccessService, 'canView'>,
  actor: GuildActor,
  eventId: number,
  event: Pick<ReadinessEvent, 'guildId'>,
): Promise<void> {
  if (isStaff(actor)) return;
  if (event.guildId !== null) {
    if (await access.canView(actor, event.guildId)) return;
  }
  if (await hasActiveSignup(db, eventId, actor.id)) return;
  throw new ForbiddenException('Not a member of this event or its guild');
}
