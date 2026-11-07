/**
 * ROK-2100 §4 B.2 — when a companion upload is refused with
 * `RULESET_REQUIRED` (export null, no realm-map entry, no Blizzard answer, no
 * realm-name hint), tell the member in-app how to fix it: paste the export
 * once under Characters and pick the ruleset. Reuses the `system` type (F11),
 * deduped per member + character for 7 days (F13) through the atomic
 * `NotificationDedupService` claim (Codex P2: a read-then-create double-sent
 * under concurrent rejected uploads). Never throws — the device still gets
 * its 400 when the notice fails.
 */
import { Injectable, Logger } from '@nestjs/common';
import { NotificationDedupService } from '../../../notifications/notification-dedup.service';
import { NotificationService } from '../../../notifications/notification.service';
import type { AddonImportRulesetDetail } from '../addon-import/addon-import.errors';

export const LEDGERLINK_RULESET_NOTICE_KIND = 'ledgerlink_ruleset_required';
const DAY_MS = 24 * 60 * 60 * 1000;
const DEDUP_TTL_SECONDS = (7 * DAY_MS) / 1000;
const EXPIRY_MS = 14 * DAY_MS;
const CHARACTERS_LINK = '/profile/gaming/characters';

/** The per-member, per-character dedup key (F13). */
export function rulesetNoticeDedupKey(userId: number, guid: string): string {
  return `ledgerlink-ruleset:${userId}:${guid}`;
}

/** Title, message and payload of the notice (§4 B.3, exact copy). */
export interface RulesetNotice {
  title: string;
  message: string;
  payload: Record<string, string | null>;
}

/** The exact §4 B.3 copy; " on {realm}" only when the realm is non-blank. */
export function buildRulesetNotice(d: AddonImportRulesetDetail): RulesetNotice {
  const realm = d.realmName?.trim() ? ` on ${d.realmName}` : '';
  return {
    title: `Pick a ruleset for ${d.characterName}`,
    message:
      `Your companion uploaded ${d.characterName}${realm} but Raid Ledger couldn't tell which ruleset that realm plays (Normal, PvP, RP or RP-PvP). ` +
      'Import it once from Characters → Import from LedgerLink and choose the ruleset — after that, the companion keeps it up to date.',
    payload: {
      kind: LEDGERLINK_RULESET_NOTICE_KIND,
      guid: d.guid,
      characterName: d.characterName,
      realmName: d.realmName,
      link: CHARACTERS_LINK,
    },
  };
}

@Injectable()
export class LedgerlinkRulesetNoticeService {
  private readonly logger = new Logger(LedgerlinkRulesetNoticeService.name);

  constructor(
    private readonly dedup: NotificationDedupService,
    private readonly notifications: NotificationService,
  ) {}

  /** One in-app notice per member + character per 7 days; never throws. */
  async notifyRulesetRequired(
    userId: number,
    detail: AddonImportRulesetDetail,
  ): Promise<void> {
    const key = rulesetNoticeDedupKey(userId, detail.guid);
    try {
      if (await this.dedup.checkAndMarkSent(key, DEDUP_TTL_SECONDS)) return;
    } catch (err: unknown) {
      this.warn(userId, err);
      return;
    }
    if (!(await this.sendNotice(userId, detail)))
      await this.release(userId, key);
  }

  /**
   * Create the notice; false when nothing was stored — in-app `system`
   * notifications disabled (`create` → null) or the insert threw (Codex P2).
   */
  private async sendNotice(
    userId: number,
    detail: AddonImportRulesetDetail,
  ): Promise<boolean> {
    try {
      const created = await this.notifications.create({
        userId,
        type: 'system',
        ...buildRulesetNotice(detail),
        expiresAt: new Date(Date.now() + EXPIRY_MS),
        skipDiscord: true,
      });
      return created !== null;
    } catch (err: unknown) {
      this.warn(userId, err);
      return false;
    }
  }

  /** Give the 7-day claim back so a later upload retries; never throws. */
  private async release(userId: number, key: string): Promise<void> {
    await this.dedup
      .releaseKey(key)
      .catch((e: unknown) => this.warn(userId, e));
  }

  private warn(userId: number, err: unknown): void {
    const why = err instanceof Error ? err.message : 'unknown error';
    this.logger.warn(`ruleset notice failed user=${userId}: ${why}`);
  }
}
