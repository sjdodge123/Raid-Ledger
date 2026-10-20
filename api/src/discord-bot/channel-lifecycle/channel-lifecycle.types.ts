import type { Guild } from 'discord.js';
import type {
  ChannelLifecycleSettingsDto,
  LifecycleAction,
} from '@raid-ledger/contract';
import type { ChannelBindingsService } from '../services/channel-bindings.service';
import type { GameLifecycleActivityRow } from './game-activity.types';
import type { LifecycleDb } from './channel-lifecycle.store';

/** ROK-1431 — shared shapes for the reconcile loop (spec ROK-1428 §2.5). */

/** DI token for the hub auto-link seam (D7); L8 provides the real linker. */
export const CHANNEL_LIFECYCLE_HUB_LINKER = Symbol(
  'CHANNEL_LIFECYCLE_HUB_LINKER',
);

/** Links a game's channel-less hubs to its managed channel; returns how many. */
export interface HubLinker {
  /** `db` = the reconcile lock's tx (Codex r3); defaults to the pool. */
  linkHubsForGame(
    gameId: number,
    channelId: string,
    db?: LifecycleDb,
  ): Promise<number>;
  /** Games with an eligible hub that has no channel yet (L8); absent ⇒ none. */
  hubNeedsLinkGameIds?(db?: LifecycleDb): Promise<ReadonlySet<number>>;
}

/** The default seam until L8: links nothing. */
export const NOOP_HUB_LINKER: HubLinker = {
  linkHubsForGame: (): Promise<number> => Promise.resolve(0),
};

/** What a reconcile was started by (logging + Sentry context only). */
export type ReconcileTrigger = 'cron' | 'manual' | 'nudge';

/** Options for `ChannelLifecycleService.reconcile`. */
export interface ReconcileOptions {
  dryRun: boolean;
  trigger: ReconcileTrigger;
  /** Restrict to these games (per-game nudge, L5b). */
  gameIds?: readonly number[];
}

/** One game the plan acts on. */
export interface PlannedGame {
  row: GameLifecycleActivityRow;
  action: LifecycleAction;
  reason: string;
}

/** Resolved Games / Archived category ids for this tick. */
export interface ReconcileCategories {
  gamesId: string | null;
  archiveId: string | null;
}

/** Everything a per-action executor needs. */
export interface ApplyContext {
  guild: Guild;
  db: LifecycleDb;
  bindings: ChannelBindingsService;
  settings: ChannelLifecycleSettingsDto;
  categories: ReconcileCategories;
  hubLinker: HubLinker;
  clientUrl: string;
  now: Date;
}

/** The outcome of running one planned game. */
export interface ItemOutcome {
  outcome: 'done' | 'failed' | 'deferred' | 'planned';
  detail: string | null;
  linkedHubs?: number;
  /** A permission error: stop the tick (D14). */
  stop?: boolean;
  /** The guild is at its channel cap (30013): defer the tick's other creates. */
  stopCreates?: boolean;
}
