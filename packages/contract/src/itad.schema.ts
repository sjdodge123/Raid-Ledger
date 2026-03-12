import { z } from 'zod';

// ==========================================
// ITAD Integration (ROK-772)
// ==========================================

/**
 * Admin ITAD configuration status.
 */
export const ItadConfigStatusSchema = z.object({
  configured: z.boolean(),
});

export type ItadConfigStatusDto = z.infer<typeof ItadConfigStatusSchema>;

// ==========================================
// ITAD Pricing (ROK-419)
// ==========================================

/** Deal quality indicator for price comparison */
export const DealQualitySchema = z.enum(['great', 'good', 'modest']).nullable();
export type DealQuality = z.infer<typeof DealQualitySchema>;

/** Individual store price entry */
export const ItadStorePriceSchema = z.object({
  shop: z.string(),
  url: z.string(),
  price: z.number(),
  regularPrice: z.number(),
  discount: z.number(),
});

export type ItadStorePriceDto = z.infer<typeof ItadStorePriceSchema>;

/** Historical low price entry */
export const ItadHistoryLowSchema = z.object({
  price: z.number(),
  shop: z.string(),
  date: z.string(),
});

export type ItadHistoryLowDto = z.infer<typeof ItadHistoryLowSchema>;

/** Composite pricing response for a game */
export const ItadGamePricingSchema = z.object({
  currentBest: ItadStorePriceSchema.nullable(),
  stores: z.array(ItadStorePriceSchema),
  historyLow: ItadHistoryLowSchema.nullable(),
  dealQuality: DealQualitySchema,
  currency: z.string(),
});

export type ItadGamePricingDto = z.infer<typeof ItadGamePricingSchema>;
