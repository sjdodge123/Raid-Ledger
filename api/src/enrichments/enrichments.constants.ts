export const ENRICHMENT_QUEUE = 'enrichments';

export interface EnrichCharacterJobData {
  characterId: string;
  enricherKey: string;
  gameSlug: string;
}

export interface EnrichEventJobData {
  eventId: string;
  enricherKey: string;
  gameSlug: string;
}

export type EnrichmentJobData = EnrichCharacterJobData | EnrichEventJobData;
