import { z } from 'zod';

/**
 * ROK-2187 — "GG <year>" story cards. Every card in a snapshot is one
 * envelope `{ pluginSlug, cardId, order, payload }`; the payload is stored as
 * opaque JSON and validated per `(pluginSlug, cardId)` at read time, so a card
 * whose payload no longer parses is skipped, never a broken story. Core owns
 * cards 1–12; plugin cards sit between `hubs` and `superlative` by `order`.
 * Product copy says "GG <year>", never "Wrapped".
 */

const count = z.number().int().min(0);
const seconds = z.number().int().min(0);
const ratio = z.number().min(0).max(1);
const isoDateTime = z.iso.datetime({ offset: true });
const nameStr = z.string().min(1).max(120);
const urlOrNull = z.string().max(2048).nullable();

/** Core card ids, in story order (spec §Web "Card order"). */
export const GG_CORE_CARD_IDS = [
  'intro', 'events', 'on-time', 'rhythm', 'hours', 'top-games',
  'new-games', 'voice', 'people', 'hubs', 'superlative', 'summary',
] as const;
export type GgCoreCardId = (typeof GG_CORE_CARD_IDS)[number];

/** Superlative keys the picker can award; `welcome-aboard` = the short GG. */
export const GG_SUPERLATIVE_KEYS = [
  'night-owl', 'always-on-time', 'the-planner', 'explorer',
  'voice-regular', 'regular', 'welcome-aboard',
] as const;
export const GgSuperlativeKeySchema = z.enum(GG_SUPERLATIVE_KEYS);
export type GgSuperlativeKey = z.infer<typeof GgSuperlativeKeySchema>;

/** A YouTube video id as IGDB lists it (top-games trailer card). */
export const GG_YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{6,32}$/;

const gameRef = z.strictObject({
  gameId: z.number().int().positive(),
  name: nameStr,
  coverUrl: urlOrNull.optional(),
});

/** Card 1 — intro. */
export const GgIntroCardSchema = z.strictObject({ memberSince: isoDateTime.nullable().optional() });
/** Card 2 — events signed up / attended / no-shows + "the planner" (metrics 1, 2, 4). */
export const GgEventsCardSchema = z.strictObject({
  signedUp: count,
  attended: count,
  noShows: count,
  excused: count.optional(),
  created: count.optional(),
  firstEventAt: isoDateTime.nullable(),
  lastEventAt: isoDateTime.nullable(),
});
/** Card 3 — always on time (metric 3). */
export const GgOnTimeCardSchema = z.strictObject({ attended: count, onTime: count, onTimeRatio: ratio });
/** Card 4 — busiest month + favourite weekday/hour, community tz (metric 2). */
export const GgRhythmCardSchema = z.strictObject({
  busiestMonth: z.number().int().min(1).max(12),
  busiestMonthEvents: count,
  favouriteWeekday: z.number().int().min(0).max(6),
  favouriteHour: z.number().int().min(0).max(23),
});
/** Card 5 — hours played + night-owl share (metrics 5, 7). */
export const GgHoursCardSchema = z.strictObject({
  totalSeconds: seconds,
  gamesPlayed: count,
  nightOwlShare: ratio.optional(),
});
/** Card 6 — top games + top game per month (metric 5). */
export const GgTopGamesCardSchema = z.strictObject({
  games: z.array(gameRef.extend({
    seconds,
    /** IGDB screenshot URLs (https) for the Ken-Burns backdrop; absent = none stored. */
    screenshots: z.array(z.string().max(2048)).max(4).optional(),
    /** First IGDB-listed YouTube trailer id (visible framed player, Q2); null = none. */
    trailerVideoId: z.string().regex(GG_YOUTUBE_ID_RE).nullable().optional(),
  })).max(5),
  byMonth: z.array(gameRef.extend({ month: z.number().int().min(1).max(12), seconds })).max(12),
});
/** Card 7 — new games tried (metric 6). */
export const GgNewGamesCardSchema = z.strictObject({ count, games: z.array(gameRef).max(10) });
/** Card 8 — event voice time (metric 8). */
export const GgVoiceCardSchema = z.strictObject({ totalSeconds: seconds, sessions: count });
/** Card 9 — top 3 people (metric 9). Owner-only: never reaches the public DTO. */
export const GgPeopleCardSchema = z.strictObject({
  people: z.array(z.strictObject({
    userId: z.number().int().positive(),
    displayName: nameStr,
    avatarUrl: urlOrNull,
    sharedEvents: count,
    sharedVoiceSeconds: seconds,
  })).max(3),
  playedWithCount: count,
});
/** Card 10 — hubs joined / posts / pictures (metric 10). */
export const GgHubsCardSchema = z.strictObject({ joined: count, posts: count, pictures: count });
/** Card 11 — the superlative. */
export const GgSuperlativeCardSchema = z.strictObject({ key: GgSuperlativeKeySchema, value: z.number().optional() });
/** Card 12 — summary (+ the share toggle in the web). */
export const GgSummaryCardSchema = z.strictObject({
  eventsAttended: count,
  hoursPlayedSeconds: seconds,
  topGames: z.array(gameRef).max(3),
  playedWithCount: count,
  superlative: GgSuperlativeKeySchema.nullable(),
});

/** Valheim plugin card — deaths + skill gains on claimed characters (metric 11). */
export const GgValheimCardSchema = z.strictObject({
  characters: count,
  deaths: count,
  skillGains: z.array(z.strictObject({ skill: nameStr, gained: z.number().min(0) })).max(20),
});
/** WoW plugin card (api folder `wow-common`, plugin id `blizzard`) — levels dinged (metric 12, Q7). */
export const GgWowLevelsCardSchema = z.strictObject({
  totalDings: count,
  characters: z.array(z.strictObject({
    name: nameStr,
    className: nameStr.nullable().optional(),
    fromLevel: z.number().int().min(0).max(100).nullable().optional(),
    maxLevel: z.number().int().min(1).max(100),
    dings: count,
  })).max(20),
});

/** Payload schema of every known card, keyed `<pluginSlug>:<cardId>`. */
export const GG_CARD_PAYLOAD_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  'core:intro': GgIntroCardSchema,
  'core:events': GgEventsCardSchema,
  'core:on-time': GgOnTimeCardSchema,
  'core:rhythm': GgRhythmCardSchema,
  'core:hours': GgHoursCardSchema,
  'core:top-games': GgTopGamesCardSchema,
  'core:new-games': GgNewGamesCardSchema,
  'core:voice': GgVoiceCardSchema,
  'core:people': GgPeopleCardSchema,
  'core:hubs': GgHubsCardSchema,
  'core:superlative': GgSuperlativeCardSchema,
  'core:summary': GgSummaryCardSchema,
  'valheim:valheim-year': GgValheimCardSchema,
  'blizzard:wow-levels': GgWowLevelsCardSchema,
};

const cardId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,59}$/, 'Invalid card id');

/** One stored card. `payload` stays opaque here — see `parseGgCardPayload`. */
export const GgCardEnvelopeSchema = z.strictObject({
  pluginSlug: cardId,
  cardId,
  order: z.number().int().min(0).max(10_000),
  payload: z.unknown(),
});
export type GgCardEnvelope = z.infer<typeof GgCardEnvelopeSchema>;

/**
 * The card's payload parsed with its own schema, or `null` when the card is
 * unknown or its payload does not parse (the web skips that card).
 */
export function parseGgCardPayload(card: GgCardEnvelope): unknown {
  const schema = GG_CARD_PAYLOAD_SCHEMAS[`${card.pluginSlug}:${card.cardId}`];
  if (schema === undefined) return null;
  const parsed = schema.safeParse(card.payload);
  return parsed.success ? parsed.data : null;
}

export type GgEventsCard = z.infer<typeof GgEventsCardSchema>;
export type GgHoursCard = z.infer<typeof GgHoursCardSchema>;
export type GgTopGamesCard = z.infer<typeof GgTopGamesCardSchema>;
export type GgNewGamesCard = z.infer<typeof GgNewGamesCardSchema>;
export type GgIntroCard = z.infer<typeof GgIntroCardSchema>;
export type GgSummaryCard = z.infer<typeof GgSummaryCardSchema>;
export type GgPeopleCard = z.infer<typeof GgPeopleCardSchema>;
export type GgValheimCard = z.infer<typeof GgValheimCardSchema>;
export type GgWowLevelsCard = z.infer<typeof GgWowLevelsCardSchema>;
