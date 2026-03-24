import { ModuleRef } from '@nestjs/core';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import {
  ScheduledEventService,
  type ScheduledEventData,
} from '../discord-bot/services/scheduled-event.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import { ChannelResolverService } from '../discord-bot/services/channel-resolver.service';
import { EventsService } from '../events/events.service';
import { getCreateSkipReason } from '../discord-bot/services/scheduled-event.helpers';
import { buildLifecyclePayload } from '../events/event-response-map.helpers';
import { SettingsService } from '../settings/settings.service';

export interface ScheduledEventCreateResult {
  success: boolean;
  skipReason: string | null;
  error: string | null;
  debug: Record<string, unknown> | null;
  discordScheduledEventId: string | null;
}

/** Synchronously trigger Discord scheduled event creation for a test event. */
export async function triggerScheduledEventCreate(
  db: PostgresJsDatabase<typeof schema>,
  moduleRef: ModuleRef,
  eventId: number,
): Promise<ScheduledEventCreateResult> {
  const eventsService = moduleRef.get(EventsService, { strict: false });
  const response = await eventsService.findOne(eventId);
  const payload = buildLifecyclePayload(response);
  const event = payload.event as ScheduledEventData;
  const startTime = event.startTime ?? '';

  const botClient = moduleRef.get(DiscordBotClientService, { strict: false });
  const skipReason = getCreateSkipReason(
    eventId,
    startTime,
    payload.isAdHoc as boolean | undefined,
    botClient.isConnected(),
  );
  if (skipReason) {
    return {
      success: false,
      skipReason,
      error: null,
      debug: null,
      discordScheduledEventId: null,
    };
  }

  // Debug: check voice channel resolution independently
  const channelResolver = moduleRef.get(ChannelResolverService, {
    strict: false,
  });
  const settings = moduleRef.get(SettingsService, { strict: false });
  const resolvedVoice =
    await channelResolver.resolveVoiceChannelForScheduledEvent(
      payload.gameId as number | null,
    );
  const defaultVoice = await settings.getDiscordBotDefaultVoiceChannel();
  const permissions = botClient.checkPermissions?.() ?? [];
  const debug = {
    resolvedVoice,
    defaultVoice,
    gameId: payload.gameId,
    guildId: botClient.getGuildId?.() ?? null,
    botConnected: botClient.isConnected(),
    permissions: permissions.map(
      (p) => `${p.name}:${p.granted}`,
    ),
  };

  // Intercept the service's internal logger to capture swallowed errors
  const svc = moduleRef.get(ScheduledEventService, { strict: false });
  const capturedErrors: string[] = [];
  const capturedWarns: string[] = [];
  const origLogger = (svc as unknown as Record<string, unknown>).logger;
  const proxyLogger = {
    log: (...a: unknown[]) => (origLogger as { log: Function }).log?.(...a),
    warn: (...a: unknown[]) => {
      capturedWarns.push(a.map(String).join(' '));
      (origLogger as { warn: Function }).warn?.(...a);
    },
    error: (...a: unknown[]) => {
      capturedErrors.push(a.map(String).join(' '));
      (origLogger as { error: Function }).error?.(...a);
    },
  };
  (svc as unknown as Record<string, unknown>).logger = proxyLogger;

  try {
    await svc.createScheduledEvent(
      eventId,
      event,
      payload.gameId as number | null | undefined,
      payload.isAdHoc as boolean | undefined,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    (svc as unknown as Record<string, unknown>).logger = origLogger;
    return {
      success: false,
      skipReason: null,
      error: msg,
      debug,
      discordScheduledEventId: null,
    };
  }
  (svc as unknown as Record<string, unknown>).logger = origLogger;

  const updated = await db.query.events.findFirst({
    where: eq(schema.events.id, eventId),
  });
  const seId = updated?.discordScheduledEventId ?? null;
  return {
    success: !!seId,
    skipReason: null,
    error: seId
      ? null
      : `discordScheduledEventId is null after createScheduledEvent. ` +
        `capturedWarns=[${capturedWarns.join('; ')}] ` +
        `capturedErrors=[${capturedErrors.join('; ')}]`,
    debug,
    discordScheduledEventId: seId,
  };
}
