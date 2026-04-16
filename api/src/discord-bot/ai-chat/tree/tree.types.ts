import type { Logger } from '@nestjs/common';
import type { EventsService } from '../../../events/events.service';
import type { UsersService } from '../../../users/users.service';
import type { LlmService } from '../../../ai/llm.service';
import type { SettingsService } from '../../../settings/settings.service';
import type { IgdbService } from '../../../igdb/igdb.service';
import type { LineupsService } from '../../../lineups/lineups.service';
import type { AnalyticsService } from '../../../events/analytics.service';

/** Result returned by every tree handler. */
export interface TreeResult {
  /** Pre-fetched data as a string for the LLM to summarize. */
  data: string | null;
  /** Message shown when data is empty (skips LLM call). */
  emptyMessage: string | null;
  /** Buttons to display alongside the response. */
  buttons: ButtonDef[];
  /** Whether this node is a leaf (triggers LLM summarization). */
  isLeaf: boolean;
  /** System prompt hint for LLM context. */
  systemHint?: string;
}

/** Minimal button definition for menu builders. */
export interface ButtonDef {
  customId: string;
  label: string;
  style?: 'primary' | 'secondary' | 'success' | 'danger' | 'link';
  url?: string;
}

/** In-memory session for a single user's tree navigation. */
export interface TreeSession {
  /** Current tree path (e.g. 'events', 'events:this-week'). */
  currentPath: string;
  /** Whether the user is an operator/admin. */
  isOperator: boolean;
  /** Linked RL user ID (null if unlinked). */
  userId: number | null;
  /** Timestamp of last interaction for TTL expiry. */
  lastActiveAt: number;
}

/** Shared dependency bag for tree handlers. */
export interface AiChatDeps {
  logger: Logger;
  eventsService: EventsService;
  usersService: UsersService;
  llmService: LlmService;
  settingsService: SettingsService;
  igdbService: IgdbService;
  lineupsService: LineupsService;
  analyticsService: AnalyticsService;
  clientUrl: string | null;
}

/** Handler function signature for tree branches. */
export type TreeHandler = (
  path: string,
  deps: AiChatDeps,
  session: TreeSession,
) => Promise<TreeResult>;

/** Registry entry for a tree node. */
export interface TreeNodeEntry {
  handler: TreeHandler;
  isLeaf: boolean;
  requiresAuth: boolean;
  operatorOnly: boolean;
}
