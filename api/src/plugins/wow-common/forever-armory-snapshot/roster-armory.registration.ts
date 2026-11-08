/**
 * ROK-2133 — the roster Armory pass's Nest classes, spread into
 * `WowCommonModule` (keeps that module under the 300-line limit).
 */
import { RosterArmoryService } from './roster-armory.service';

/** Hourly roster Armory pass + the Sync now follow-up pass. */
export const PROVIDERS = [RosterArmoryService];
