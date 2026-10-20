import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  LIFECYCLE_DEFAULTS,
  UpdateChannelLifecycleSettingsSchema,
  type ChannelLifecycleSettingsDto,
  type GameLifecycleActivityListDto,
  type LifecycleSuppressionListDto,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { SettingsService } from '../../settings/settings.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { ensureCategory } from './channel-lifecycle.discord-ops';
import { deleteSuppression, type LifecycleDb } from './channel-lifecycle.store';
import {
  isListed,
  selectSuppressions,
  toActivityDto,
} from './channel-lifecycle-admin.helpers';
import { selectGameLifecycleActivity } from './game-activity.queries';
import {
  CHANNEL_LIFECYCLE_HUB_LINKER,
  type HubLinker,
} from './channel-lifecycle.types';

/** 400 text when `enabled: true` cannot resolve an Archived category (D5). */
export const ENABLE_REFUSED =
  'Choose or allow an Archived category before enabling';

type CategoryIds = Pick<
  ChannelLifecycleSettingsDto,
  'gamesCategoryId' | 'archiveCategoryId'
>;

/**
 * ROK-1432 — the admin surface of channel lifecycle (spec ROK-1428 §2.3):
 * settings with the enable guard, the activity table, suppressions.
 */
@Injectable()
export class ChannelLifecycleAdminService {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: LifecycleDb,
    private readonly settings: SettingsService,
    private readonly client: DiscordBotClientService,
    @Optional()
    @Inject(CHANNEL_LIFECYCLE_HUB_LINKER)
    private readonly hubLinker?: HubLinker,
  ) {}

  /** Current settings (defaults when unset). */
  getSettings(): Promise<ChannelLifecycleSettingsDto> {
    return this.settings.getChannelLifecycleSettings();
  }

  /**
   * Validate + apply a partial update. Flipping `enabled` true first finds or
   * creates the Games + Archived categories and persists their ids.
   *
   * @throws BadRequestException on an invalid body or {@link ENABLE_REFUSED}
   */
  async updateSettings(body: unknown): Promise<ChannelLifecycleSettingsDto> {
    const parsed = UpdateChannelLifecycleSettingsSchema.safeParse(body);
    if (!parsed.success) {
      const text = parsed.error.issues.map((i) => i.message).join('; ');
      throw new BadRequestException(`Validation failed: ${text}`);
    }
    const patch = parsed.data;
    if (patch.enabled !== true) {
      return this.settings.setChannelLifecycleSettings(patch);
    }
    const current = await this.settings.getChannelLifecycleSettings();
    const ids = await this.resolveForEnable({
      gamesCategoryId: patch.gamesCategoryId ?? current.gamesCategoryId,
      archiveCategoryId: patch.archiveCategoryId ?? current.archiveCategoryId,
    });
    return this.settings.setChannelLifecycleSettings({ ...patch, ...ids });
  }

  /** D5 find-or-create; Archived is mandatory, Games is best-effort. */
  private async resolveForEnable(s: CategoryIds): Promise<CategoryIds> {
    const guild = this.client.getGuild();
    if (!this.client.isConnected() || !guild) {
      throw new BadRequestException(ENABLE_REFUSED);
    }
    const resolve = (id: string | null, name: string) =>
      ensureCategory(guild, { id, name, needsRoom: false }).catch(() => null);
    const archive = await resolve(
      s.archiveCategoryId,
      LIFECYCLE_DEFAULTS.archiveCategoryName,
    );
    if (!archive) throw new BadRequestException(ENABLE_REFUSED);
    const games = await resolve(
      s.gamesCategoryId,
      LIFECYCLE_DEFAULTS.gamesCategoryName,
    );
    return {
      gamesCategoryId: games?.id ?? s.gamesCategoryId,
      archiveCategoryId: archive.id,
    };
  }

  /** The derived activity table; `all` also lists rows with nothing going on. */
  async activity(all: boolean): Promise<GameLifecycleActivityListDto> {
    const settings = await this.settings.getChannelLifecycleSettings();
    const now = new Date();
    const guildId = this.client.getGuildId();
    const rows = await selectGameLifecycleActivity(this.db, {
      now,
      windowDays: settings.recentActivityDays,
      // Same hub-link input as `reconcile`, so the preview shows `link_hub`.
      hubNeedsLinkGameIds:
        (await this.hubLinker?.hubNeedsLinkGameIds?.()) ?? new Set<number>(),
      ...(guildId ? { guildId } : {}),
    });
    const items = rows
      .filter((r) => all || isListed(r))
      .map((r) => toActivityDto(r, settings));
    const windowDays = settings.recentActivityDays;
    return { items, windowDays, generatedAt: now.toISOString() };
  }

  /** The bot guild's suppressions (empty when the bot has no guild). */
  async suppressions(): Promise<LifecycleSuppressionListDto> {
    const guildId = this.client.getGuildId();
    if (!guildId) return { items: [] };
    return { items: await selectSuppressions(this.db, guildId) };
  }

  /**
   * "Recreate": clear a game's suppression so the next reconcile may create.
   *
   * @throws NotFoundException when the game has no suppression
   */
  async clearSuppression(gameId: number): Promise<void> {
    const guildId = this.client.getGuildId();
    const removed = guildId
      ? await deleteSuppression(this.db, guildId, gameId)
      : false;
    if (!removed) throw new NotFoundException('Suppression not found');
  }
}
