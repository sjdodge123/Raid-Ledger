import type { ResolvedWowFacts } from '../../facts/wow-fact.types';

/**
 * ROK-1913 (epic ROK-1905 H5) — one roster row as the roster-insights
 * aggregation sees it: the `guild_members` identity (name, link, owner, main
 * flag, rank) plus the facts `WowFactsService` resolved for it. Every value
 * the widgets show comes from `facts`; identity never carries a fact.
 */
export interface InsightRow {
  name: string;
  characterId: string | null;
  /** Owner of the linked character; null when unlinked. */
  userId: number | null;
  isMain: boolean;
  rankIndex: number | null;
  /** ROK-1916 — online in the latest guild export; null = never reported. */
  onlineAtExport: boolean | null;
  /** ROK-1916 — whole days offline before that export (verbatim wire value). */
  lastOnlineDays: number | null;
  /** Null when the resolver dropped the row (truncated). */
  facts: ResolvedWowFacts | null;
}

/** Who is asking: members/staff see professions, visitors never do. */
export type InsightsAudience = 'member' | 'visitor';
