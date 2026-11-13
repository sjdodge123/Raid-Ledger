import { z } from 'zod';
import { WowRosterRaidProgressBossSchema } from './wow-roster-raid-progress.schema.js';

/**
 * ROK-1789 Part B — the WoW: Forever guild Progression tab
 * (`GET /plugins/wow/guilds/:id/progression`, members + staff only, B10).
 * WoW-plugin owned; NOT LedgerLink wire format. Two halves: boss progress
 * grouped per raid instance (B1–B3, Q-B11/Q-B12) and a 30-day activity feed
 * (B5–B8) whose milestone rows group (Q-B13) and whose bulk joins collapse
 * into one roster-import row (Q-B14).
 */

const count = z.number().int().nonnegative();
const iso = z.iso.datetime({ offset: true });
const name = z.string().max(128);

/** Most instance sections one page carries. No boss cap: this is the see-all page. */
export const WOW_PROGRESSION_INSTANCES_MAX = 30;

/** A widget boss row plus the boss table's `order` (null when no boss row matched). */
export const WowProgressionBossSchema = WowRosterRaidProgressBossSchema.extend({
  order: z.number().int().nullable(),
});
export type WowProgressionBossDto = z.infer<typeof WowProgressionBossSchema>;

/** `j:<journalId>`, `m:<mapId>` (no Journal id known, Q-B12) or `other`. */
export const WOW_PROGRESSION_INSTANCE_KEY = /^(?:j:\d+|m:\d+|other)$/;

export const WowProgressionInstanceSchema = z
  .object({
    /** Stable React key; see `WOW_PROGRESSION_INSTANCE_KEY`. */
    key: z.string().regex(WOW_PROGRESSION_INSTANCE_KEY),
    /** "Molten Core", "Instance <mapId>" (Q-B12) or "Other bosses". */
    name,
    /** Distinct encounters with at least one kill, any difficulty. */
    bossesDown: count,
    /** Boss rows for the Journal id (forever, else classic — Q-B11); null ⇒ "N/?" (B2). */
    bossTotal: count.nullable(),
    /** B3: true only when this instance's bosses span more than one difficulty. */
    showDifficulty: z.boolean(),
    latestKill: z.object({ name, at: iso }).strict().nullable(),
    /** Ordered by `order`, then the widget's boss order. */
    bosses: z.array(WowProgressionBossSchema),
  })
  .strict();
export type WowProgressionInstanceDto = z.infer<typeof WowProgressionInstanceSchema>;

export const WowGuildProgressionSchema = z
  .object({
    /** Most recent `lastPullAt` first; the `other` bucket last. */
    instances: z.array(WowProgressionInstanceSchema).max(WOW_PROGRESSION_INSTANCES_MAX),
    /** Pulls after the near-duplicate collapse. */
    pullCount: count,
    lastPullAt: iso.nullable(),
  })
  .strict();
export type WowGuildProgressionDto = z.infer<typeof WowGuildProgressionSchema>;

/** B7: feed window, server cap, and the rows the web shows before "Show all". */
export const GUILD_ACTIVITY_WINDOW_DAYS = 30;
export const GUILD_ACTIVITY_MAX = 200;
export const GUILD_ACTIVITY_PAGE = 25;
/** Q-B13: same-day, same-months milestones group into one row from this many (">3"). */
export const GUILD_MILESTONE_GROUP_MIN = 4;
/** Q-B14: joins sharing one exact `created_at` collapse into a roster import from this many. */
export const GUILD_ROSTER_IMPORT_MIN = 10;
/** Most names a grouped row carries; `count` is always the full total. */
export const GUILD_ACTIVITY_NAMES_MAX = 20;

export const GUILD_ACTIVITY_KINDS = [
  'first_kill',
  'new_member',
  'roster_import',
  'event',
  'ding',
  'milestone',
] as const;
export type WowGuildActivityKind = (typeof GUILD_ACTIVITY_KINDS)[number];

const base = { id: z.string().min(1).max(128), at: iso };
const who = { characterName: name, characterId: z.uuid().nullable() };
/** Every member's name, lead first, capped; `count` = the real total. */
const group = (min: number) => ({
  count: z.number().int().min(min),
  names: z.array(name).min(1).max(GUILD_ACTIVITY_NAMES_MAX),
});

/** `kill:<encounterId>:<difficultyId>` — first kill per (encounter, difficulty), Q-B18. */
export const WowActivityFirstKillSchema = z
  .object({ kind: z.literal('first_kill'), ...base, bossName: name, difficultyLabel: z.string().max(64).nullable(), instanceName: name.nullable() })
  .strict();
/** `join:<memberId>`; founding (first-batch) members never appear (B6). */
export const WowActivityNewMemberSchema = z
  .object({ kind: z.literal('new_member'), ...base, ...who, className: z.string().max(64).nullable() })
  .strict();
/** `import:<created_at iso>` — ≥10 joins sharing one `created_at` (Q-B14). */
export const WowActivityRosterImportSchema = z
  .object({ kind: z.literal('roster_import'), ...base, ...group(GUILD_ROSTER_IMPORT_MIN) })
  .strict();
/** `event:<eventId>` — an ended, non-cancelled guild-tagged event. */
export const WowActivityEventSchema = z
  .object({ kind: z.literal('event'), ...base, eventId: z.number().int().positive(), title: z.string().max(200) })
  .strict();
/** `ding:<eventRowId>`. */
export const WowActivityDingSchema = z
  .object({ kind: z.literal('ding'), ...base, ...who, toLevel: z.number().int().positive() })
  .strict();
/**
 * `ms:<memberId>:<months>` for one member, `ms:<yyyy-mm-dd>:<months>` for a
 * grouped row (Q-B13). Single: `count: 1`, `names: [characterName]`. Grouped:
 * `characterName`/`characterId` = the lead member ("Thalia and 48 others").
 */
export const WowActivityMilestoneSchema = z
  .object({
    kind: z.literal('milestone'),
    ...base,
    ...who,
    months: z.union([z.literal(1), z.literal(6), z.literal(12)]),
    ...group(1),
  })
  .strict();

/** One feed row. Grouped rows must not carry more names than `count`. */
export const WowGuildActivityEntrySchema = z
  .discriminatedUnion('kind', [
    WowActivityFirstKillSchema,
    WowActivityNewMemberSchema,
    WowActivityRosterImportSchema,
    WowActivityEventSchema,
    WowActivityDingSchema,
    WowActivityMilestoneSchema,
  ])
  .refine((e) => !('names' in e) || e.names.length <= e.count, {
    message: 'names cannot outnumber count',
    path: ['names'],
  });
export type WowGuildActivityEntryDto = z.infer<typeof WowGuildActivityEntrySchema>;
/** The feed row of one kind, e.g. `WowGuildActivityEntryOf<'milestone'>`. */
export type WowGuildActivityEntryOf<K extends WowGuildActivityKind> = Extract<
  WowGuildActivityEntryDto,
  { kind: K }
>;

export const WowGuildActivitySchema = z
  .object({
    /** Newest first (`at` desc, then `id`). */
    entries: z.array(WowGuildActivityEntrySchema).max(GUILD_ACTIVITY_MAX),
    windowDays: z.literal(GUILD_ACTIVITY_WINDOW_DAYS),
  })
  .strict();
export type WowGuildActivityDto = z.infer<typeof WowGuildActivitySchema>;

/** The `GET /plugins/wow/guilds/:id/progression` response. */
export const WowGuildProgressionPageSchema = z
  .object({ progression: WowGuildProgressionSchema, activity: WowGuildActivitySchema })
  .strict();
export type WowGuildProgressionPageDto = z.infer<typeof WowGuildProgressionPageSchema>;
