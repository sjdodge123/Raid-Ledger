import { Injectable, Logger } from '@nestjs/common';
import { SETTING_KEYS } from '../../drizzle/schema';
import { EventsService } from '../../events/events.service';
import { UsersService } from '../../users/users.service';
import { LlmService } from '../../ai/llm.service';
import { SettingsService } from '../../settings/settings.service';
import { IgdbService } from '../../igdb/igdb.service';
import { LineupsService } from '../../lineups/lineups.service';
import { SchedulingService } from '../../lineups/scheduling/scheduling.service';
import { AnalyticsService } from '../../events/analytics.service';
import { AiChatSessionStore } from './helpers/session-store';
import { AiChatRateLimiter } from './helpers/rate-limiter';
import { resolveTreeNode } from './tree/tree.registry';
import { KEYWORD_MAP } from './ai-chat.constants';
import type { AiChatDeps, TreeSession, TreeResult } from './tree/tree.types';
import {
  buildWelcomeMenu,
  buildNavRow,
  buildButtonRows,
} from './helpers/menu-builders';
import {
  summarizeWithLlm,
  llmClassify,
  buildMenuResponse,
  textResponse,
} from './helpers/llm-helpers';

/** Shape returned by simulate / handleInteraction. */
export interface AiChatResponse {
  content: string;
  embeds: { title: string | null; description: string | null }[];
  components: { customId: string | null; label: string | null }[];
  rows: import('discord.js').ActionRowBuilder<
    import('discord.js').ButtonBuilder
  >[];
}

@Injectable()
export class AiChatService {
  private readonly logger = new Logger(AiChatService.name);
  readonly sessionStore = new AiChatSessionStore();
  private readonly rateLimiter = new AiChatRateLimiter();

  constructor(
    private readonly eventsService: EventsService,
    private readonly usersService: UsersService,
    private readonly llmService: LlmService,
    private readonly settingsService: SettingsService,
    private readonly igdbService: IgdbService,
    private readonly lineupsService: LineupsService,
    private readonly schedulingService: SchedulingService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  onModuleInit(): void {
    this.sessionStore.start();
  }

  onModuleDestroy(): void {
    this.sessionStore.stop();
  }

  /** Check if AI chat feature is enabled. */
  async isEnabled(): Promise<boolean> {
    const val = await this.settingsService.get(SETTING_KEYS.AI_CHAT_ENABLED);
    return val === 'true';
  }

  /** Main entry point for handling a simulated interaction. */
  async handleInteraction(
    discordUserId: string,
    text?: string,
    buttonId?: string,
  ): Promise<AiChatResponse | null> {
    if (!(await this.isEnabled())) return null;
    if (this.rateLimiter.isLimited(discordUserId)) {
      return textResponse('You are being rate limited. Try again later.');
    }
    const path = await this.resolvePath(discordUserId, text, buttonId);
    return this.executePath(discordUserId, path);
  }

  /** Resolve button/text to a tree path. */
  private async resolvePath(
    discordUserId: string,
    text?: string,
    buttonId?: string,
  ): Promise<string | null> {
    if (buttonId) return this.resolveButtonPath(discordUserId, buttonId);
    if (text) {
      const contextPath = this.resolveSessionTextInput(discordUserId, text);
      if (contextPath) return contextPath;
      return this.classifyFreeText(text, discordUserId);
    }
    return null;
  }

  /** Check if the active session expects text input. */
  private resolveSessionTextInput(
    discordUserId: string,
    text: string,
  ): string | null {
    const session = this.sessionStore.get(discordUserId);
    if (!session) return null;
    const path = session.currentPath;
    if (path === 'events:search') return `events:search:${text}`;
    if (path === 'game-library:search') return `game-library:search:${text}`;
    return null;
  }

  /** Resolve a button ID to a path, handling back/home. */
  private resolveButtonPath(
    discordUserId: string,
    buttonId: string,
  ): string | null {
    const path = buttonId.startsWith('ai:') ? buttonId.slice(3) : buttonId;
    if (path === 'home') {
      this.sessionStore.clear(discordUserId);
      return null;
    }
    if (path === 'back') return this.resolveBackPath(discordUserId);
    return path;
  }

  /** Go back to the parent path. */
  private resolveBackPath(discordUserId: string): string | null {
    const session = this.sessionStore.get(discordUserId);
    if (!session) return null;
    const parts = session.currentPath.split(':');
    if (parts.length <= 1) return null;
    return parts.slice(0, -1).join(':');
  }

  /** Classify free-text input into a tree path. */
  private async classifyFreeText(
    text: string,
    discordUserId: string,
  ): Promise<string | null> {
    const lower = text.toLowerCase().trim();
    const keywordMatch = KEYWORD_MAP[lower];
    if (keywordMatch) return keywordMatch;
    if (lower.split(/\s+/).length < 3) return null;
    this.rateLimiter.record(discordUserId);
    return llmClassify(this.llmService, text);
  }

  /** Execute a resolved path or show the welcome menu. */
  private async executePath(
    discordUserId: string,
    path: string | null,
  ): Promise<AiChatResponse> {
    if (!path) return this.showWelcomeMenu(discordUserId);
    const node = resolveTreeNode(path);
    if (!node) return this.showWelcomeMenu(discordUserId);
    const session = await this.ensureSession(discordUserId);
    if (node.operatorOnly && !session.isOperator) {
      return this.showWelcomeMenu(discordUserId);
    }
    session.currentPath = path;
    this.sessionStore.set(discordUserId, session);
    const deps = this.buildDeps();
    const result = await node.handler(path, deps, session);
    return this.buildResponse(result, discordUserId);
  }

  /** Build the welcome menu response. */
  private async showWelcomeMenu(
    discordUserId: string,
  ): Promise<AiChatResponse> {
    const session = await this.ensureSession(discordUserId);
    session.currentPath = '';
    this.sessionStore.set(discordUserId, session);
    const rows = buildWelcomeMenu(session.isOperator);
    return buildMenuResponse('How can I help you today?', rows);
  }

  /** Ensure a session exists for the user. */
  private async ensureSession(discordUserId: string): Promise<TreeSession> {
    const existing = this.sessionStore.get(discordUserId);
    if (existing) {
      this.sessionStore.touch(discordUserId);
      return existing;
    }
    const user = await this.usersService.findByDiscordId(discordUserId);
    const session: TreeSession = {
      currentPath: '',
      isOperator: user?.role === 'admin' || user?.role === 'operator',
      userId: user?.id ?? null,
      lastActiveAt: Date.now(),
    };
    this.sessionStore.set(discordUserId, session);
    return session;
  }

  /** Build response from a tree result. */
  private async buildResponse(
    result: TreeResult,
    discordUserId: string,
  ): Promise<AiChatResponse> {
    const navRow = buildNavRow();
    const content = await this.resolveContent(result, discordUserId);
    const buttonRows =
      result.buttons.length > 0 ? buildButtonRows(result.buttons) : [];
    return buildMenuResponse(content, [...buttonRows, navRow]);
  }

  /** Resolve content from a tree result (LLM or static). */
  private async resolveContent(
    result: TreeResult,
    discordUserId: string,
  ): Promise<string> {
    if (result.emptyMessage) return result.emptyMessage;
    if (!result.data) return 'No information available.';
    if (!result.isLeaf) return result.data;
    this.rateLimiter.record(discordUserId);
    return summarizeWithLlm(
      this.llmService,
      this.logger,
      result.data,
      result.systemHint,
    );
  }

  /** Build the dependency bag for tree handlers. */
  private buildDeps(): AiChatDeps {
    return {
      logger: this.logger,
      eventsService: this.eventsService,
      usersService: this.usersService,
      llmService: this.llmService,
      settingsService: this.settingsService,
      igdbService: this.igdbService,
      lineupsService: this.lineupsService,
      schedulingService: this.schedulingService,
      analyticsService: this.analyticsService,
      clientUrl: process.env.CLIENT_URL ?? null,
    };
  }
}
