/**
 * Full edit of a bound Discord Scheduled Event (name, times, description,
 * place), extracted from ScheduledEventService.tryEdit (ROK-2201). A refused
 * edit goes to `recoverRejectedEdit`, which ends + recreates an ACTIVE SE that
 * moved later, recreates a gone/finished one, and logs anything else.
 */
import type { Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import type { SettingsService } from '../../settings/settings.service';
import type { ChannelResolverService } from './channel-resolver.service';
import {
  buildDescriptionText,
  type ScheduledEventData,
} from './scheduled-event.helpers';
import type { ScheduledEventRecord } from './scheduled-event.db-helpers';
import {
  tryEditFullEvent,
  resolveVoiceForEdit,
  resolveEditedScheduledEventName,
} from './scheduled-event.discord-ops';
import {
  plannedSELocation,
  type SEPlace,
} from './scheduled-event.planned-voice';
import { recoverRejectedEdit } from './scheduled-event.edit-recovery';

type Guild = NonNullable<ReturnType<DiscordBotClientService['getGuild']>>;

/** Services the full edit reads from, plus the recreate fallback. */
export interface FullEditDeps {
  db: PostgresJsDatabase<typeof schema>;
  settings: SettingsService;
  channelResolver: ChannelResolverService;
  logger: Pick<Logger, 'warn' | 'error'>;
  /** Clear the stored SE id and create a fresh SE via the create path. */
  recreate: () => Promise<void>;
}

/** The event whose bound SE `seId` is being edited. */
export interface FullEditTarget {
  guild: Guild;
  eventId: number;
  seId: string;
  event: ScheduledEventRecord;
  eventData: ScheduledEventData;
  gameId: number | null | undefined;
}

/** A planned temporary channel keeps the SE External (2026-11-13). */
async function resolveEditPlace(
  deps: FullEditDeps,
  t: FullEditTarget,
): Promise<SEPlace | null> {
  const planDeps = {
    settings: deps.settings,
    channelResolver: deps.channelResolver,
  };
  const loc = await plannedSELocation(
    deps.db,
    planDeps,
    t.eventId,
    t.eventData,
  );
  const vc = await resolveVoiceForEdit(t.event, t.gameId, deps.channelResolver);
  return loc ? { location: loc } : vc;
}

/**
 * Edit every field of the bound SE; on refusal, recover per ROK-2201 instead
 * of throwing. Errors from the recreate fallback propagate to the caller.
 */
export async function editScheduledEventFully(
  deps: FullEditDeps,
  t: FullEditTarget,
): Promise<void> {
  const clientUrl = await deps.settings.getClientUrl();
  const description = buildDescriptionText(t.eventId, t.eventData, clientUrl);
  const place = await resolveEditPlace(deps, t);
  const tz = (): Promise<string | null> => deps.settings.getDefaultTimezone();
  const name = await resolveEditedScheduledEventName(t.event, t.eventData, tz);
  const { guild, eventId, seId, eventData } = t;
  try {
    await tryEditFullEvent(
      guild,
      eventId,
      seId,
      eventData,
      description,
      place,
      name,
    );
  } catch (err) {
    const { logger } = deps;
    const fields = { name, description };
    const rejected = { guild, eventId, seId, eventData, logger, fields };
    await recoverRejectedEdit(rejected, err, deps.recreate);
  }
}
