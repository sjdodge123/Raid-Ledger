import { Injectable } from '@nestjs/common';
import type { HubPostRelayChannel } from '@raid-ledger/contract';
import type { HubPostRecord } from './hub-posts.queries';

/** Where `relay` sends: only built when `availability` said `ok`. */
export interface HubPostRelayTarget {
  guildId: number;
  guildName: string;
  channelId: string;
}

/** What one relay attempt produced (the create flow adds the other two). */
export type HubPostRelaySendOutcome = 'sent' | 'failed';

/**
 * ROK-1868 — the Discord relay SEAM used by `HubPostsService`.
 *
 * L3a ships this as a STUB (no channel is ever available, nothing is sent),
 * so every `POST …/posts` with `relayToDiscord: true` answers `unavailable`.
 * L3b replaces the bodies — keep the method signatures:
 *
 * - `availability(guildId)` (D8) never throws; it maps the hub's bound
 *   channel to the composer's `HubPostRelayChannel` state.
 * - `relay(record, target)` sends the embed, calls `setRelay` on success and
 *   classifies errors itself (warn vs Sentry); it resolves, never rejects.
 *   The caller bounds it at 5 s and treats a timeout as `failed`.
 * - `unrelay(channelId, messageId)` is best-effort (caller fires and forgets).
 * - `discordGuildId()` feeds the relay `messageUrl` in `toHubPost`.
 */
@Injectable()
export class HubPostRelayService {
  /** Relay channel state for a hub (stub: always `unset`). */
  availability(guildId: number): Promise<HubPostRelayChannel> {
    void guildId;
    return Promise.resolve({ state: 'unset' });
  }

  /** Send one post to the bound channel (stub: never called — `unset`). */
  relay(
    record: HubPostRecord,
    target: HubPostRelayTarget,
  ): Promise<HubPostRelaySendOutcome> {
    void record;
    void target;
    return Promise.resolve('failed');
  }

  /** Delete a relayed message, best effort (stub: no-op). */
  unrelay(channelId: string, messageId: string): Promise<void> {
    void channelId;
    void messageId;
    return Promise.resolve();
  }

  /** The bot's Discord guild id, for message URLs (stub: unknown). */
  discordGuildId(): string | null {
    return null;
  }
}
