export const IGDB_SYNC_QUEUE = 'igdb-sync';

export interface IgdbSyncJobData {
  trigger: 'scheduled' | 'config-update' | 'manual';
}
