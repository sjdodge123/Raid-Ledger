import { perfLog } from '../../common/perf-logger';

/** Discord API error code for "Unknown Scheduled Event" (manually deleted). */
export const UNKNOWN_SCHEDULED_EVENT = 10070;

/** Discord API error code 30038 — guild has hit its 100 uncompleted scheduled
 *  events cap (ROK-1332). */
export const MAX_SCHEDULED_EVENTS_REACHED = 30038;

/** Maximum description length for Discord Scheduled Events. */
export const MAX_DESCRIPTION_LENGTH = 1000;

/** Discord hard cap on Scheduled Event names (50035 rejects names > 100). */
export const MAX_SCHEDULED_EVENT_NAME_LENGTH = 100;

/**
 * Thrown by `withCapacityRecovery` when GC ran but freed 0 stale RL-tracked
 * scheduled events — the cap is held by operator-owned SEs that RL can't
 * touch. The reconciliation cron catches this to apply per-event backoff
 * and emit a single WARN per tick instead of one per candidate (ROK-1332).
 */
export class CapacityStillSaturatedError extends Error {
  readonly orphanCount: number;
  constructor(orphanCount: number) {
    super(
      `Discord scheduled-event capacity still saturated after GC (orphanCount=${orphanCount})`,
    );
    this.name = 'CapacityStillSaturatedError';
    this.orphanCount = orphanCount;
  }
}

/** Timeout (ms) for individual Discord API calls (ROK-685, ROK-969). */
const parsed = parseInt(process.env.DISCORD_API_TIMEOUT_MS ?? '5000', 10);
export const DISCORD_API_TIMEOUT_MS = Number.isNaN(parsed) ? 5000 : parsed;

/**
 * Execute a Discord API call with [PERF] DISCORD instrumentation
 * and a timeout guard (ROK-685).
 */
export async function timedDiscordCall<T>(
  operation: string,
  fn: () => Promise<T>,
  meta?: Record<string, string | number | null | undefined>,
  timeoutMs: number = DISCORD_API_TIMEOUT_MS,
): Promise<T> {
  const start = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `Discord API timeout: ${operation} exceeded ${timeoutMs}ms`,
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
    perfLog('DISCORD', operation, performance.now() - start, meta);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

export interface ScheduledEventData {
  title: string;
  description?: string | null;
  startTime: string;
  endTime: string;
  signupCount: number;
  maxAttendees?: number | null;
  game?: { name: string } | null;
}

/**
 * Build the description string for a Discord Scheduled Event.
 */
export function buildDescriptionText(
  eventId: number,
  eventData: ScheduledEventData,
  clientUrl: string | null,
): string {
  const link = clientUrl
    ? `\n\nView event: ${clientUrl}/events/${eventId}`
    : '';

  const gameName = eventData.game?.name ?? 'Event';
  const attendeeStr = eventData.maxAttendees
    ? `${eventData.signupCount}/${eventData.maxAttendees}`
    : `${eventData.signupCount}`;

  const header = `${gameName} — ${attendeeStr} signed up`;
  const eventDesc = eventData.description ?? '';

  const full = eventDesc
    ? `${header}\n${eventDesc}${link}`
    : `${header}${link}`;

  if (full.length <= MAX_DESCRIPTION_LENGTH) return full;

  return truncateDescription(header, eventDesc, link);
}

/**
 * Build the Discord Scheduled Event name (ROK-1350). Variety nights get the
 * assigned game appended (`"<title> — <GAME>"`, em-dash matching the
 * description). Returns the bare title when no game is set (covers unset/revert)
 * or when the title already contains the game name (case-insensitive). Truncates
 * to the Discord 100-char cap with an ellipsis.
 */
export function buildScheduledEventName(eventData: ScheduledEventData): string {
  const gameName = eventData.game?.name;
  if (!gameName) return eventData.title;
  if (eventData.title.toLowerCase().includes(gameName.toLowerCase()))
    return eventData.title;

  const combined = `${eventData.title} — ${gameName}`;
  if (combined.length <= MAX_SCHEDULED_EVENT_NAME_LENGTH) return combined;
  return combined.slice(0, MAX_SCHEDULED_EVENT_NAME_LENGTH - 1) + '…';
}

/**
 * Drop a single redundant trailing standalone " Event" word from a name, used
 * for the EPHEMERAL Discord display only (channel + Scheduled-Event line). For an
 * ephemeral event the surface is already an event (a Scheduled Event + auto voice
 * channel), so a title like "HELLCARD Event" reads redundantly. Case-insensitive,
 * word-boundary aware: "HELLCARD Event" → "HELLCARD", "Launch Event" → "Launch",
 * but "Eventful" / "Event Horizon" / "HELLCARDEvent" are left untouched. If the
 * strip would leave the name empty/blank (e.g. "Event"), the original is kept.
 * NOTE: this is NOT applied to `buildScheduledEventName` — non-ephemeral SEs and
 * the adopt/confirm-by-name matching keep the plain stored title.
 */
export function stripTrailingEventWord(name: string): string {
  const stripped = name.replace(/\s+event\s*$/i, '');
  return stripped.trim().length > 0 ? stripped : name;
}

/**
 * Format an event's start time for embedding in a Scheduled Event name, e.g.
 * `"Sun 9:35 PM"`. Mirrors the en-US, hour12 display style the push-content
 * formatter uses (`utils/push-content.ts`), but trimmed to weekday + time so it
 * fits the SE-name cap. When a display timezone is configured it is honored
 * (the same `getDefaultTimezone()` setting the embeds use); otherwise the host's
 * local zone is used. The comma some locales insert between weekday and time is
 * collapsed to a single space to match the `"Sun 9:35 PM"` target.
 */
export function formatStartTimeForName(
  startTime: string,
  timezone?: string | null,
): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  };
  if (timezone) opts.timeZone = timezone;
  return new Date(startTime).toLocaleString('en-US', opts).replace(', ', ' ');
}

/**
 * Build the Scheduled Event name for an ephemeral-voice event, enriched with the
 * formatted start time (`"<base> · Sun 9:35 PM"`). Scoped to ephemeral events:
 * their SE sits at the auto-created `"⏰ <base>"` channel, so without the time
 * suffix the Discord sidebar shows the channel and the SE name as two identical
 * lines. Appending the start time de-dupes the second line. The base is the
 * unchanged `buildScheduledEventName` (game-aware); the result is truncated to
 * the Discord 100-char cap with the same ellipsis pattern.
 */
export function buildScheduledEventNameWithTime(
  eventData: ScheduledEventData,
  timezone?: string | null,
): string {
  const base = stripTrailingEventWord(buildScheduledEventName(eventData));
  const time = formatStartTimeForName(eventData.startTime, timezone);
  const combined = `${base} · ${time}`;
  if (combined.length <= MAX_SCHEDULED_EVENT_NAME_LENGTH) return combined;
  return combined.slice(0, MAX_SCHEDULED_EVENT_NAME_LENGTH - 1) + '…';
}

/**
 * ROK-1352: marker prefixed to ephemeral voice channel names so they're
 * visually distinguishable from permanent channels in the Discord channel
 * list. Native Unicode (renders wherever Discord does); '⏰' connotes the
 * time-limited / transient nature of the channel.
 */
export const EPHEMERAL_CHANNEL_MARKER = '⏰';

/**
 * Build an ephemeral voice channel name: the standard SE name (with the
 * redundant trailing "Event" word dropped for the ephemeral display) and the
 * ephemeral marker prefixed, re-truncated to Discord's 100-char channel cap.
 * The marker + strip live on the ephemeral surfaces only — `buildScheduledEventName`
 * keeps the clean stored title for non-ephemeral SEs and name matching.
 */
export function buildEphemeralChannelName(
  eventData: ScheduledEventData,
): string {
  const base = stripTrailingEventWord(buildScheduledEventName(eventData));
  const withMarker = `${EPHEMERAL_CHANNEL_MARKER} ${base}`;
  if (withMarker.length <= MAX_SCHEDULED_EVENT_NAME_LENGTH) return withMarker;
  return withMarker.slice(0, MAX_SCHEDULED_EVENT_NAME_LENGTH - 1) + '…';
}

/** Format an API error message for logging. */
export function formatApiError(
  op: string,
  eventId: number,
  error: unknown,
): string {
  const msg = error instanceof Error ? error.message : 'Unknown error';
  return `Failed to ${op} scheduled event for event ${eventId}: ${msg}`;
}

/** Check if scheduled event creation should be skipped (ROK-755). Returns reason or null. */
export function getCreateSkipReason(
  eventId: number,
  startTime: string,
  isAdHoc?: boolean,
  isConnected?: boolean,
): string | null {
  if (isAdHoc)
    return `Skipping scheduled event for event ${eventId}: ad-hoc event`;
  if (!isConnected)
    return `Skipping scheduled event for event ${eventId}: bot not connected`;
  if (new Date(startTime).getTime() <= Date.now())
    return `Skipping scheduled event for event ${eventId}: start time in the past`;
  return null;
}

/** Truncate event description to fit within the limit. */
function truncateDescription(
  header: string,
  eventDesc: string,
  link: string,
): string {
  const headerAndLink = `${header}${link}`;
  if (headerAndLink.length >= MAX_DESCRIPTION_LENGTH) {
    return headerAndLink.slice(0, MAX_DESCRIPTION_LENGTH - 3) + '...';
  }

  const available =
    MAX_DESCRIPTION_LENGTH - header.length - 1 - link.length - 3;
  const truncated = available > 0 ? eventDesc.slice(0, available) + '...' : '';
  return truncated ? `${header}\n${truncated}${link}` : `${header}${link}`;
}
