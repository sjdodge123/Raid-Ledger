export const STEAM_SYNC_QUEUE = 'steam-sync';

export interface SteamSyncJobData {
  trigger: 'scheduled' | 'manual';
  userId?: number;
}
