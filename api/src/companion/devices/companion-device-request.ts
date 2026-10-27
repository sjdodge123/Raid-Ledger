/**
 * ROK-1955: what `CompanionDeviceGuard` attaches. It lives on its own key
 * (`companionDevice`) and the guard never sets `req.user`, so nothing that
 * reads a session user can mistake a device for a signed-in person (S-6).
 */
import type { Request } from 'express';

/** The authenticated device behind an `rlcd_` bearer. Never the token. */
export interface CompanionDeviceAuth {
  deviceId: number;
  /** Revalidated at commit time by `holdActiveDevice`. */
  tokenHash: string;
  userId: number;
}

/** An Express request after (or before) the device guard ran. */
export type CompanionDeviceRequest = Request & {
  companionDevice?: CompanionDeviceAuth;
};

/** A request the device guard has accepted. */
export type AuthenticatedCompanionDeviceRequest = Request & {
  companionDevice: CompanionDeviceAuth;
};
