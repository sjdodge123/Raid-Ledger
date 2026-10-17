export const IGDB_SYNC_QUEUE = 'igdb-sync';

/** Delay for on-demand re-enrichment jobs (5 minutes). */
export const REENRICH_DELAY_MS = 300_000;

export type IgdbSyncJobData =
  | { trigger: 'scheduled' | 'config-update' | 'manual' }
  | { trigger: 'reenrich-game'; gameId: number };
