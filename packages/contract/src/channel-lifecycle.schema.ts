import { z } from 'zod';
import { BindingLifecycleStateEnum } from './channel-bindings.schema.js';

/**
 * ROK-1428 — Discord channel lifecycle automation: a game whose activity
 * (events, polls, event plans, lineup votes, hub activity) crosses the create
 * threshold gets a text channel; a quiet game's channel is archived; it comes
 * back on the next activity. Additive, admin-only surface.
 */

/** Defaults shared by the api settings and the admin form placeholders. */
export const LIFECYCLE_DEFAULTS = {
    recentActivityDays: 30,
    createThreshold: 2,
    maxChangesPerTick: 10,
    gamesCategoryName: 'Games',
    archiveCategoryName: 'Archived',
} as const;

const isoDate = z.string().datetime({ offset: true });

export const ChannelLifecycleSettingsSchema = z.object({
    enabled: z.boolean(),
    /** Activity window in days: an item inside it counts; 7–180. */
    recentActivityDays: z.number().int().min(7).max(180),
    /** Items inside the window before a channel is created; floor 2 (never on a single poll). */
    createThreshold: z.number().int().min(2).max(10),
    gamesCategoryId: z.string().nullable(),
    archiveCategoryId: z.string().nullable(),
    /** Also deny ViewChannel on archive (not just SendMessages). */
    hideOnArchive: z.boolean(),
    maxChangesPerTick: z.number().int().min(1).max(25),
    lastRunAt: isoDate.nullable(),
    lastRunError: z.string().nullable(),
});
export type ChannelLifecycleSettingsDto = z.infer<typeof ChannelLifecycleSettingsSchema>;

export const UpdateChannelLifecycleSettingsSchema = z
    .object({
        enabled: z.boolean().optional(),
        recentActivityDays: z.number().int().min(7).max(180).optional(),
        createThreshold: z.number().int().min(2).max(10).optional(),
        gamesCategoryId: z.string().nullable().optional(),
        archiveCategoryId: z.string().nullable().optional(),
        hideOnArchive: z.boolean().optional(),
        maxChangesPerTick: z.number().int().min(1).max(25).optional(),
    })
    .strict();
export type UpdateChannelLifecycleSettingsDto = z.infer<typeof UpdateChannelLifecycleSettingsSchema>;

export const GameActivitySignalKindSchema = z.enum(['event', 'poll', 'event_plan', 'lineup_vote', 'hub']);
export type GameActivitySignalKind = z.infer<typeof GameActivitySignalKindSchema>;

export const GameActivitySignalSchema = z.object({
    kind: GameActivitySignalKindSchema,
    /** Items inside the window (a poll with any number of votes is one item). */
    itemCount: z.number().int().min(0),
    lastActivityAt: isoDate,
});
export type GameActivitySignalDto = z.infer<typeof GameActivitySignalSchema>;

export const LifecycleActionSchema = z.enum(['create', 'unarchive', 'archive', 'link_hub', 'none']);
export type LifecycleAction = z.infer<typeof LifecycleActionSchema>;

export const GameLifecycleBindingSchema = z.object({
    id: z.string().uuid(),
    channelId: z.string(),
    lifecycleState: BindingLifecycleStateEnum,
    autoManaged: z.boolean(),
    pinned: z.boolean(),
});

export const GameLifecycleActivitySchema = z.object({
    gameId: z.number().int(),
    gameName: z.string(),
    gameSlug: z.string(),
    signals: z.array(GameActivitySignalSchema),
    itemCount: z.number().int().min(0),
    lastActivityAt: isoDate.nullable(),
    /** An active community hub holds the channel open (ROK-1873). */
    hubHold: z.boolean(),
    /** A hand-deleted or unbound managed channel is never recreated until cleared. */
    suppressed: z.boolean(),
    binding: GameLifecycleBindingSchema.nullable(),
    action: LifecycleActionSchema,
    reason: z.string(),
});
export type GameLifecycleActivityDto = z.infer<typeof GameLifecycleActivitySchema>;

export const GameLifecycleActivityListSchema = z.object({
    items: z.array(GameLifecycleActivitySchema),
    windowDays: z.number().int(),
    generatedAt: isoDate,
});
export type GameLifecycleActivityListDto = z.infer<typeof GameLifecycleActivityListSchema>;

export const ReconcileStopReasonSchema = z.enum(['permissions', 'disabled', 'offline', 'no-archive-category']);

export const ReconcileItemSchema = z.object({
    gameId: z.number().int(),
    gameName: z.string(),
    action: LifecycleActionSchema,
    outcome: z.enum(['done', 'planned', 'failed', 'deferred']),
    detail: z.string().nullable(),
});

export const ReconcileResultSchema = z.object({
    dryRun: z.boolean(),
    created: z.number().int(),
    unarchived: z.number().int(),
    archived: z.number().int(),
    linkedHubs: z.number().int(),
    skipped: z.number().int(),
    failed: z.number().int(),
    deferred: z.number().int(),
    stoppedReason: ReconcileStopReasonSchema.nullable(),
    items: z.array(ReconcileItemSchema),
});
export type ReconcileResultDto = z.infer<typeof ReconcileResultSchema>;

export const LifecycleSuppressionSchema = z.object({
    gameId: z.number().int(),
    gameName: z.string(),
    reason: z.enum(['deleted', 'unbound']),
    createdAt: isoDate,
});
export type LifecycleSuppressionDto = z.infer<typeof LifecycleSuppressionSchema>;

export const LifecycleSuppressionListSchema = z.object({
    items: z.array(LifecycleSuppressionSchema),
});
export type LifecycleSuppressionListDto = z.infer<typeof LifecycleSuppressionListSchema>;
