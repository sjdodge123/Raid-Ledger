import type { EventEmitter2 } from '@nestjs/event-emitter';
import {
  STEAM_ACCOUNT_LINKED,
  STEAM_ACCOUNT_UNLINKED,
  type SteamAccountLinkEvent,
} from './steam.constants';

/**
 * ROK-1835: announce a `users.steam_id` change. A replaced or cleared
 * SteamID emits `steam.account-unlinked` FIRST, then a new one emits
 * `steam.account-linked`, so listeners detach before they attach. Re-linking
 * the same SteamID emits only `linked`; clearing nothing emits nothing.
 */
export async function announceSteamLinkChange(
  events: EventEmitter2,
  userId: number,
  previous: string | null,
  next: string | null,
): Promise<void> {
  if (previous !== null && previous !== next) {
    const e: SteamAccountLinkEvent = { userId, steamId64: previous };
    await events.emitAsync(STEAM_ACCOUNT_UNLINKED, e);
  }
  if (next !== null) {
    const e: SteamAccountLinkEvent = { userId, steamId64: next };
    await events.emitAsync(STEAM_ACCOUNT_LINKED, e);
  }
}
