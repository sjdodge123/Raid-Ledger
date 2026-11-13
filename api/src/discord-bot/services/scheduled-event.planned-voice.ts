/**
 * Planned temporary voice channel → Discord Scheduled Event location
 * (operator ruling 2026-11-13).
 *
 * While an event's ephemeral voice channel is PLANNED (not created yet), its
 * Scheduled Event is a location-type (External) event whose location is the
 * planned channel's name — never the game's default voice channel. Once
 * `EphemeralVoiceScheduler` creates the channel, the repoint edit turns the SE
 * into a Voice event in that channel. Not planned → a Voice SE exactly as before.
 */
import { GuildScheduledEventEntityType } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  hasVoiceOverride,
  resolvePlannedVoiceForEvent,
  type PlannedVoiceEventFields,
  type PlannedVoiceSettingsSource,
  type VoiceOverrideChecker,
} from './planned-ephemeral-voice.helpers';
import { resolveVoiceForCreate } from './scheduled-event.db-helpers';
import { parseEventTimestampUtc } from './scheduled-event.revalidate';
import type { ScheduledEventData } from './scheduled-event.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Discord caps an External SE's `entity_metadata.location` at 100 chars. */
export const SE_LOCATION_MAX_LENGTH = 100;

/** Where an SE takes place: a voice channel id, or a planned-channel location. */
export type SEPlace = string | { location: string };

/** The entity fields of an SE create for a place. */
export type SECreateEntity =
  | { entityType: GuildScheduledEventEntityType.Voice; channel: string }
  | {
      entityType: GuildScheduledEventEntityType.External;
      entityMetadata: { location: string };
    };

/** The entity fields of an SE edit (empty when no place resolved). */
export interface SEEditEntity {
  entityType?: GuildScheduledEventEntityType;
  channel?: string | null;
  entityMetadata?: { location: string };
}

export function seCreateEntity(place: SEPlace): SECreateEntity {
  if (typeof place === 'string')
    return { entityType: GuildScheduledEventEntityType.Voice, channel: place };
  return {
    entityType: GuildScheduledEventEntityType.External,
    entityMetadata: { location: place.location },
  };
}

/**
 * Edits always state the entity type with the channel, so an External
 * (planned) SE flips to Voice the moment a channel resolves — the repoint after
 * the temporary channel is created — and back to External when planned again
 * (External requires a null channel; `scheduledEndTime` is always sent).
 */
export function seEditEntity(place: SEPlace | null): SEEditEntity {
  if (place === null) return {};
  if (typeof place === 'string')
    return { entityType: GuildScheduledEventEntityType.Voice, channel: place };
  return {
    entityType: GuildScheduledEventEntityType.External,
    channel: null,
    entityMetadata: { location: place.location },
  };
}

async function readPlannedVoiceRow(db: Db, eventId: number) {
  const [row] = await db
    .select({
      ephemeralVoiceEnabled: schema.events.ephemeralVoiceEnabled,
      ephemeralVoiceChannelId: schema.events.ephemeralVoiceChannelId,
      cancelledAt: schema.events.cancelledAt,
      reschedulingPollId: schema.events.reschedulingPollId,
      notificationChannelOverride: schema.events.notificationChannelOverride,
      gameId: schema.events.gameId,
    })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return row ?? null;
}

/** A game's name by id (null when unset or missing). */
export async function readGameName(
  db: Db,
  gameId: number | null | undefined,
): Promise<string | null> {
  if (!gameId) return null;
  const [game] = await db
    .select({ name: schema.games.name })
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1);
  return game?.name ?? null;
}

/**
 * The game name the planned channel is named after. A reconciliation
 * candidate carries `gameId` but no `game`, and `EphemeralVoiceService` names
 * the real channel from the game row — so read it rather than drop it.
 */
async function plannedGameName(
  db: Db,
  eventData: ScheduledEventData,
  gameId: number | null | undefined,
): Promise<string | null> {
  if (eventData.game) return eventData.game.name;
  return readGameName(db, gameId);
}

/** What the planned SE decision needs besides the row. */
export interface PlannedSEDeps {
  settings: PlannedVoiceSettingsSource;
  /** Owns override voice-ness — a voice override is never "planned". */
  channelResolver: VoiceOverrideChecker;
}

/**
 * The planned temporary channel's name as an SE location, or null when no
 * temporary channel is pending (gate off, live channel exists, a voice
 * override wins, cancelled, rescheduling, or already started).
 */
export async function plannedSELocation(
  db: Db,
  deps: PlannedSEDeps,
  eventId: number,
  eventData: ScheduledEventData,
  now: Date = new Date(),
): Promise<string | null> {
  const row = await readPlannedVoiceRow(db, eventId);
  if (!row) return null;
  const override = row.notificationChannelOverride ?? null;
  const fields: PlannedVoiceEventFields = {
    eventOverride: row.ephemeralVoiceEnabled ?? null,
    liveChannelId: row.ephemeralVoiceChannelId ?? null,
    voiceOverride: hasVoiceOverride(deps.channelResolver, override),
    cancelled: row.cancelledAt != null,
    rescheduling: row.reschedulingPollId != null,
    startTime: parseEventTimestampUtc(eventData.startTime),
    title: eventData.title,
    gameName: await plannedGameName(db, eventData, row.gameId),
  };
  const planned = await resolvePlannedVoiceForEvent(deps.settings, fields, now);
  return planned ? planned.name.slice(0, SE_LOCATION_MAX_LENGTH) : null;
}

/** The inputs `resolveCreatePlace` reads off the create preamble. */
export interface CreatePlaceInputs {
  gameId?: number | null;
  voiceChannelOverride?: string | null;
  channelResolver: Parameters<typeof resolveVoiceForCreate>[4] &
    VoiceOverrideChecker;
  /** Absent → never planned (the pre-2026-11-13 behaviour). */
  plannedVoiceSettings?: PlannedVoiceSettingsSource;
}

/** A planned location wins; otherwise the voice channel as before (or null). */
export async function resolveCreatePlace(
  db: Db,
  eventId: number,
  eventData: ScheduledEventData,
  inputs: CreatePlaceInputs,
): Promise<SEPlace | null> {
  if (inputs.plannedVoiceSettings) {
    const deps = {
      settings: inputs.plannedVoiceSettings,
      channelResolver: inputs.channelResolver,
    };
    const location = await plannedSELocation(db, deps, eventId, eventData);
    if (location) return { location };
  }
  return resolveVoiceForCreate(
    db,
    eventId,
    inputs.gameId,
    inputs.voiceChannelOverride,
    inputs.channelResolver,
  );
}

/** The resolver slice the start-time re-place needs. */
export type StartVoiceResolver = Parameters<typeof resolveVoiceForCreate>[4];

/**
 * The voice channel an already-started event's SE belongs in: the live
 * temporary channel, else the override / default binding — the same fallback
 * `resolveCreatePlace` takes once `plannedSELocation` stops planning (start
 * passed). Null when none resolves (the SE then stays External).
 */
export async function resolveStartVoiceChannel(
  db: Db,
  eventId: number,
  channelResolver: StartVoiceResolver,
): Promise<string | null> {
  const row = await readPlannedVoiceRow(db, eventId);
  if (!row) return null;
  return resolveVoiceForCreate(
    db,
    eventId,
    row.gameId,
    row.notificationChannelOverride,
    channelResolver,
  );
}
