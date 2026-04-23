import { z } from 'zod';

/**
 * ROK-567: LLM-Generated Dynamic Discovery Categories
 *
 * Schemas for weekly-generated, admin-reviewed discover rows. The 7-axis
 * `theme_vector` mirrors `player_taste_vectors.vector` + `game_taste_vectors.vector`
 * so cosine distance queries remain meaningful. The axis order is locked to
 * `[co_op, pvp, rpg, survival, strategy, social, mmo]` and must not be remapped.
 */

export const CategoryTypeEnum = z.enum([
    'seasonal',
    'trend',
    'community_pattern',
    'event',
]);

export type CategoryType = z.infer<typeof CategoryTypeEnum>;

export const PopulationStrategyEnum = z.enum(['vector', 'fixed', 'hybrid']);

export type PopulationStrategy = z.infer<typeof PopulationStrategyEnum>;

export const SuggestionStatusEnum = z.enum([
    'pending',
    'approved',
    'rejected',
    'expired',
]);

export type SuggestionStatus = z.infer<typeof SuggestionStatusEnum>;

/**
 * LLM proposal shape. Axis keys are ordered `[co_op, pvp, rpg, survival,
 * strategy, social, mmo]` to match the pgvector(7) column layout; the Zod
 * object preserves declaration order which is how the prompt + parser
 * serialize the vector back to the canonical array form.
 */
export const LlmCategoryProposalSchema = z.object({
    name: z.string().min(1).max(120),
    description: z.string().min(1),
    category_type: CategoryTypeEnum,
    theme_vector: z.object({
        co_op: z.number(),
        pvp: z.number(),
        rpg: z.number(),
        survival: z.number(),
        strategy: z.number(),
        social: z.number(),
        mmo: z.number(),
    }),
    filter_criteria: z
        .object({
            genre_tags: z.array(z.string()).optional(),
        })
        .default({}),
    population_strategy: PopulationStrategyEnum,
    expires_at: z.string().datetime().nullable().optional(),
});

export type LlmCategoryProposalDto = z.infer<typeof LlmCategoryProposalSchema>;

/**
 * Row shape as stored in `discovery_category_suggestions`. `themeVector` is
 * serialized as the 7-element array in locked axis order.
 */
export const DiscoveryCategorySuggestionSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string(),
    categoryType: CategoryTypeEnum,
    themeVector: z.array(z.number()).length(7),
    filterCriteria: z
        .object({
            genre_tags: z.array(z.string()).optional(),
        })
        .default({}),
    candidateGameIds: z.array(z.number().int()),
    status: SuggestionStatusEnum,
    populationStrategy: PopulationStrategyEnum,
    sortOrder: z.number().int(),
    expiresAt: z.string().datetime().nullable(),
    generatedAt: z.string().datetime(),
    reviewedBy: z.number().int().nullable(),
    reviewedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
});

export type DiscoveryCategorySuggestionDto = z.infer<
    typeof DiscoveryCategorySuggestionSchema
>;

export const AdminCategoryListResponseSchema = z.object({
    suggestions: z.array(DiscoveryCategorySuggestionSchema),
});

export type AdminCategoryListResponseDto = z.infer<
    typeof AdminCategoryListResponseSchema
>;

/** Admin edit scope (v1): name + description only. */
export const AdminCategoryPatchSchema = z.object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().min(1).optional(),
    sortOrder: z.number().int().optional(),
});

export type AdminCategoryPatchDto = z.infer<typeof AdminCategoryPatchSchema>;

export const AdminRejectBodySchema = z.object({
    reason: z.string().max(500).optional(),
});

export type AdminRejectBodyDto = z.infer<typeof AdminRejectBodySchema>;
