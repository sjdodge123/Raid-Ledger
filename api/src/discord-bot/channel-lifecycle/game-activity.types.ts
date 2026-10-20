import type {
  BindingLifecycleState,
  GameActivitySignalKind,
} from '@raid-ledger/contract';
import type { ArchivedOverwrites } from '../../drizzle/schema/channel-bindings';
import type { GameActivitySignal } from './game-activity.signals';

/** ROK-1430 — shapes produced by `selectGameLifecycleActivity`. */

/** The game-announcements binding the lifecycle may manage (never a series row, D12/X11). */
export interface LifecycleCandidateBinding {
  id: string;
  guildId: string;
  channelId: string;
  lifecycleState: BindingLifecycleState;
  autoManaged: boolean;
  pinned: boolean;
  archivedAt: Date | null;
  restoreParentId: string | null;
  /** D6: the overwrite bits the archive added (null = not recorded). */
  archivedOverwrites: ArchivedOverwrites | null;
}

/** One signal kind's contribution for a game. */
export interface GameSignalSummary {
  kind: GameActivitySignalKind;
  itemCount: number;
  lastActivityAt: Date;
}

/** One game's derived lifecycle input. */
export interface GameLifecycleActivityRow {
  gameId: number;
  gameName: string;
  gameSlug: string;
  signals: GameSignalSummary[];
  itemCount: number;
  lastActivityAt: Date | null;
  /** An active community hub holds the channel open (D8) — false until L11. */
  hubHold: boolean;
  /** A hub of this game has no channel and wants the managed one (D7) — false until L8. */
  hubNeedsLink: boolean;
  suppressed: boolean;
  binding: LifecycleCandidateBinding | null;
}

/** Options for `selectGameLifecycleActivity`. */
export interface GameLifecycleActivityOptions {
  now: Date;
  windowDays: number;
  /** Defaults to the live `SIGNAL_REGISTRY`. */
  signals?: readonly GameActivitySignal[];
  /** Scope bindings + suppressions to the bot's guild. */
  guildId?: string;
  /** Restrict to these games (per-game nudge). */
  gameIds?: readonly number[];
  /** HUB-HOLD SEAM (L11/M7): games an active community hub holds open. */
  hubHoldGameIds?: ReadonlySet<number>;
  /** HUB-LINK SEAM (L8): games with a hub whose channel is NULL. */
  hubNeedsLinkGameIds?: ReadonlySet<number>;
}
