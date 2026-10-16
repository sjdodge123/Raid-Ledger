/**
 * ROK-1800 — the server-presence path's post-write side effects: roster
 * broadcast, embed refresh, grace once a server leave empties the event, and
 * the spawn announcement. Split from AdHocServerPresenceService (file size).
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import type { AdHocEventsGateway } from '../../events/ad-hoc-events.gateway';
import type {
  ServerPresencePlayer,
  ServerPresenceSource,
} from '../../plugins/pelican/presence/server-presence.sink';
import type { AdHocGracePeriodQueueService } from '../queues/ad-hoc-grace-period.queue';
import type { AdHocEventService } from './ad-hoc-event.service';
import type { AdHocNotificationService } from './ad-hoc-notification.service';
import type { AdHocParticipantService } from './ad-hoc-participant.service';
import type { ChannelBindingsService } from './channel-bindings.service';
import { startGracePeriod } from './ad-hoc-event.handlers';
import { getEventById, resolveGameName } from './ad-hoc-event.helpers';
import { spawnRoster } from './ad-hoc-server-spawn.helpers';
import {
  listOnServerSteamIds,
  type GameQuickPlayBinding,
  type LiveGameEvent,
  type SteamIdentity,
} from './ad-hoc-server-presence.helpers';

export interface PresenceEffectsDeps {
  db: PostgresJsDatabase<typeof schema>;
  adHocEventService: AdHocEventService;
  participantService: AdHocParticipantService;
  notificationService: AdHocNotificationService;
  channelBindingsService: ChannelBindingsService;
  gracePeriodQueue: AdHocGracePeriodQueueService;
  gateway: AdHocEventsGateway;
}

export interface SpawnPlan {
  source: ServerPresenceSource;
  binding: GameQuickPlayBinding | null;
  players: ServerPresencePlayer[];
}

export async function emitServerRoster(
  deps: PresenceEffectsDeps,
  eventId: number,
): Promise<void> {
  const roster = await deps.adHocEventService.getAdHocRoster(eventId);
  deps.gateway.emitRosterUpdate(
    eventId,
    roster.participants,
    roster.activeCount,
  );
}

export async function refreshLive(
  deps: PresenceEffectsDeps,
  live: LiveGameEvent,
): Promise<void> {
  if (live.channelBindingId)
    deps.notificationService.queueUpdate(live.id, live.channelBindingId);
  await emitServerRoster(deps, live.id);
}

/** After a server leave: refresh, then start grace once nobody is left. */
export async function afterServerLeave(
  deps: PresenceEffectsDeps,
  live: LiveGameEvent,
): Promise<void> {
  await refreshLive(deps, live);
  if (live.adHocStatus !== 'live') return;
  if ((await deps.participantService.getActiveCount(live.id)) > 0) return;
  await startGracePeriod(
    {
      db: deps.db,
      channelBindingsService: deps.channelBindingsService,
      gracePeriodQueue: deps.gracePeriodQueue,
      gateway: deps.gateway,
    },
    live.id,
    live.channelBindingId,
  );
}

/** Close one server's open rows on `live`; grace if that emptied it. */
export async function closeServerRows(
  deps: PresenceEffectsDeps,
  live: LiveGameEvent,
  pelicanServerId: number,
): Promise<void> {
  const open = await listOnServerSteamIds(deps.db, live.id, pelicanServerId);
  for (const steamId of open)
    await deps.participantService.markServerLeave(
      live.id,
      steamId,
      pelicanServerId,
    );
  if (open.length > 0) await afterServerLeave(deps, live);
}

/** The bound game's Quick Play channel when one exists, else web only. */
export async function announceServerSpawn(
  deps: PresenceEffectsDeps,

  eventId: number,
  plan: SpawnPlan,
  ids: (SteamIdentity | null)[],
): Promise<void> {
  const { binding, players, source } = plan;
  if (binding) {
    const event = await getEventById(deps.db, eventId);
    const gameName = await resolveGameName(deps.db, source.gameId);
    await deps.notificationService.notifySpawn(
      eventId,
      binding.id,
      {
        id: eventId,
        title: event?.title ?? 'Quick Play',
        ...(gameName !== undefined ? { gameName } : {}),
      },
      spawnRoster(players, ids),
      source.gameId,
    );
  }
  deps.gateway.emitStatusChange(eventId, 'live');
  await emitServerRoster(deps, eventId);
}
