import { z } from 'zod';

// ── Feedback Categories ──────────────────────────────────────────────
export const FeedbackCategorySchema = z.enum([
    'bug',
    'feature',
    'improvement',
    'other',
]);
export type FeedbackCategory = z.infer<typeof FeedbackCategorySchema>;

// ── Screenshot limits (ROK-1313) ─────────────────────────────────────
/** Max length of `screenshotBase64` (encoded characters). */
export const FEEDBACK_SCREENSHOT_MAX_BASE64_CHARS = 5_000_000;
/** Largest decoded file (bytes) whose base64 encoding fits the cap above. */
export const FEEDBACK_SCREENSHOT_MAX_BYTES = 3_750_000;

// ── Client context sent with every submission (ROK-1313) ─────────────
export const FeedbackClientContextSchema = z.object({
    viewport: z.object({
        w: z.number().int().nonnegative(),
        h: z.number().int().nonnegative(),
    }),
    userAgent: z.string().max(1000),
    appVersion: z.string().max(100),
});
export type FeedbackClientContext = z.infer<typeof FeedbackClientContextSchema>;

// ── Create Feedback (POST /feedback) ─────────────────────────────────
export const CreateFeedbackSchema = z.object({
    category: FeedbackCategorySchema,
    message: z
        .string()
        .min(10, 'Feedback must be at least 10 characters')
        .max(2000, 'Feedback must be at most 2000 characters'),
    pageUrl: z.string().url().optional(),
    /** Base64-encoded PNG or JPEG screenshot (data URL prefix stripped) */
    screenshotBase64: z
        .string()
        .max(FEEDBACK_SCREENSHOT_MAX_BASE64_CHARS)
        .optional(),
    /** Browser console logs captured for bug reports */
    clientLogs: z.string().max(50_000).optional(),
    /** Viewport, user agent and app version at submit time (ROK-1313) */
    clientContext: FeedbackClientContextSchema.optional(),
});
export type CreateFeedbackDto = z.infer<typeof CreateFeedbackSchema>;

// ── Single Feedback Response ─────────────────────────────────────────
export const FeedbackResponseSchema = z.object({
    id: z.number(),
    category: FeedbackCategorySchema,
    message: z.string(),
    pageUrl: z.string().nullable(),
    githubIssueUrl: z.string().nullable(),
    createdAt: z.string(),
});
export type FeedbackResponseDto = z.infer<typeof FeedbackResponseSchema>;

// ── Admin: Feedback List Item (includes user info) ───────────────────
export const FeedbackListItemSchema = FeedbackResponseSchema.extend({
    userId: z.number(),
    username: z.string(),
});
export type FeedbackListItemDto = z.infer<typeof FeedbackListItemSchema>;

// ── Admin: Paginated Feedback List ───────────────────────────────────
export const FeedbackListResponseSchema = z.object({
    data: z.array(FeedbackListItemSchema),
    meta: z.object({
        total: z.number(),
        page: z.number(),
        limit: z.number(),
    }),
});
export type FeedbackListResponseDto = z.infer<typeof FeedbackListResponseSchema>;
