import { z } from 'zod';

// ── Feedback Categories ──────────────────────────────────────────────
export const FeedbackCategorySchema = z.enum([
    'bug',
    'feature',
    'improvement',
    'other',
]);
export type FeedbackCategory = z.infer<typeof FeedbackCategorySchema>;

// ── Create Feedback (POST /feedback) ─────────────────────────────────
export const CreateFeedbackSchema = z.object({
    category: FeedbackCategorySchema,
    message: z
        .string()
        .min(10, 'Feedback must be at least 10 characters')
        .max(2000, 'Feedback must be at most 2000 characters'),
    pageUrl: z.string().url().optional(),
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
