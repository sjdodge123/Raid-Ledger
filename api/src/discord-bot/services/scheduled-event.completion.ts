import { GuildScheduledEventStatus } from 'discord.js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import {
  findCompletionCandidates,
  getScheduledEventId,
  clearScheduledEventId,
} from './scheduled-event.db-helpers';
import { UNKNOWN_SCHEDULED_EVENT } from './scheduled-event.helpers';
import {
  type CompletionProgress,
  discordErrorCode,
  tryCompleteEvent,
} from './scheduled-event.discord-ops';

/**
 * What one completion attempt did (ROK-944 diagnostics). `from`/`to` are the
 * Discord status names before and after; `ok` is true only when the SE ended
 * up Completed. A failure carries the Discord error code (`'timeout'` for a
 * `timedDiscordCall` timeout) and message, or a reason in `errorMessage`.
 */
export interface SECompletionOutcome {
  eventId: number;
  discordEventId: string | null;
  from: string | null;
  to: string | null;
  ok: boolean;
  errorCode?: number | string;
  errorMessage?: string;
}

/** Why a completion pass reached no event at all. */
export type SECompletionSkipReason =
  'bot-not-connected' | 'no-guild' | 'no-candidates';

/** One completion pass: an outcome per candidate, or why there were none. */
export interface SECompletionRun {
  outcomes: SECompletionOutcome[];
  reason?: SECompletionSkipReason;
}

const STATUS_NAMES: Partial<Record<GuildScheduledEventStatus, string>> = {
  [GuildScheduledEventStatus.Scheduled]: 'Scheduled',
  [GuildScheduledEventStatus.Active]: 'Active',
  [GuildScheduledEventStatus.Completed]: 'Completed',
  [GuildScheduledEventStatus.Canceled]: 'Canceled',
};

function statusName(status: GuildScheduledEventStatus | null): string | null {
  if (status === null) return null;
  return STATUS_NAMES[status] ?? String(status);
}

/** Error code + message for an outcome; `'timeout'` for a timed-out call. */
export function describeCompletionError(error: unknown): {
  errorCode?: number | string;
  errorMessage: string;
} {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const code = discordErrorCode(error);
  if (code !== undefined) return { errorCode: code, errorMessage };
  if (errorMessage.startsWith('Discord API timeout')) {
    return { errorCode: 'timeout', errorMessage };
  }
  return { errorMessage };
}

function outcomeOf(
  eventId: number,
  seId: string | null,
  p: CompletionProgress,
): SECompletionOutcome {
  const base = {
    eventId,
    discordEventId: seId,
    from: statusName(p.from),
    to: statusName(p.to),
  };
  if (p.unknownEvent) {
    return {
      ...base,
      ok: false,
      errorCode: UNKNOWN_SCHEDULED_EVENT,
      errorMessage: 'Unknown Scheduled Event (already gone in Discord)',
    };
  }
  return { ...base, ok: p.to === GuildScheduledEventStatus.Completed };
}

/**
 * Complete one event's Discord SE and report the outcome (ROK-577, ROK-944).
 * Behaviour is unchanged from the old void version: the DB binding is
 * cleared after Discord confirms (or says 10070), and any thrown error is
 * handed to `onError` for logging instead of escaping.
 */
export async function completeScheduledEventWithOutcome(
  db: PostgresJsDatabase<typeof schema>,
  client: DiscordBotClientService,
  eventId: number,
  onError: (error: unknown) => void,
): Promise<SECompletionOutcome> {
  const progress: CompletionProgress = { from: null, to: null };
  let seId: string | null = null;
  const fail = (errorMessage: string): SECompletionOutcome => ({
    ...outcomeOf(eventId, seId, progress),
    ok: false,
    errorMessage,
  });
  try {
    if (!client.isConnected()) return fail('bot-not-connected');
    const guild = client.getGuild();
    if (!guild) return fail('no-guild');
    seId = await getScheduledEventId(db, eventId);
    if (!seId) return fail('no-discord-event-id');
    await tryCompleteEvent(guild, eventId, seId, progress);
    await clearScheduledEventId(db, eventId);
    return outcomeOf(eventId, seId, progress);
  } catch (error) {
    onError(error);
    return {
      ...outcomeOf(eventId, seId, progress),
      ok: false,
      ...describeCompletionError(error),
    };
  }
}

/** Steps a completion pass needs from the service. */
export interface CompletionPassDeps {
  db: PostgresJsDatabase<typeof schema>;
  client: DiscordBotClientService;
  completeOne: (eventId: number) => Promise<SECompletionOutcome>;
  afterEach: (eventId: number) => Promise<void>;
}

/** Complete every event past its effective end (ROK-717, ROK-944). */
export async function runCompletionPass(
  deps: CompletionPassDeps,
): Promise<SECompletionRun> {
  if (!deps.client.isConnected()) {
    return { outcomes: [], reason: 'bot-not-connected' };
  }
  if (!deps.client.getGuild()) return { outcomes: [], reason: 'no-guild' };
  const candidates = await findCompletionCandidates(deps.db);
  if (candidates.length === 0) return { outcomes: [], reason: 'no-candidates' };
  const outcomes: SECompletionOutcome[] = [];
  for (const c of candidates) {
    outcomes.push(await deps.completeOne(c.id));
    await deps.afterEach(c.id);
  }
  return { outcomes };
}
