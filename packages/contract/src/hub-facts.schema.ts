import { z } from "zod";

/**
 * ROK-1906 (epic ROK-1905) — where a hub widget's fact came from, and how
 * fresh it is. Every widget footer shows "via <source> · as of <asOf>".
 * Precedence is decided server-side; see the WoW fact-source resolver.
 */
export const HubFactSourceSchema = z.enum([
  "blizzard",
  "addon",
  "roster",
  "manual",
]);
export type HubFactSource = z.infer<typeof HubFactSourceSchema>;

export const HubFactFreshnessSchema = z
  .object({
    source: HubFactSourceSchema,
    /** Oldest timestamp that fed the value; null = unknown. */
    asOf: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();
export type HubFactFreshness = z.infer<typeof HubFactFreshnessSchema>;
