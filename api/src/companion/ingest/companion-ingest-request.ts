/**
 * ROK-1956 D-17: what `CompanionIngestAuthGuard` attaches — one normalised
 * principal for both auth paths. Its own key (`companionIngest`); the device
 * path never sets `req.user` (S-6). Never carries a token.
 */
import type { CompanionDeviceRequest } from '../devices/companion-device-request';

/** Which credential authenticated the request. */
export type CompanionIngestVia = 'device' | 'session';

/** The authenticated ingest principal. */
export interface CompanionIngestAuth {
  userId: number;
  via: CompanionIngestVia;
  /** Set on the device path only. */
  deviceId: number | null;
  /** Device path only — revalidated at commit by `holdActiveDevice`. */
  tokenHash: string | null;
}

/** An Express request before (or after) the ingest auth guard ran. */
export type CompanionIngestRequest = CompanionDeviceRequest & {
  companionIngest?: CompanionIngestAuth;
};

/** A request the ingest auth guard has accepted. */
export type AuthenticatedCompanionIngestRequest = CompanionIngestRequest & {
  companionIngest: CompanionIngestAuth;
};
