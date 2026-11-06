/**
 * ROK-2100 §4 B.2 — when a companion upload is refused with
 * `RULESET_REQUIRED` (export null, no realm-map entry, no Blizzard answer, no
 * realm-name hint), tell the member in-app how to fix it: paste the export
 * once under Characters and pick the ruleset. Reuses the `system` type (F11),
 * deduped per member + character for 7 days (F13). Never throws — the device
 * still gets its 400 when the notice fails.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { NotificationService } from '../../../notifications/notification.service';
import type { AddonImportRulesetDetail } from '../addon-import/addon-import.errors';

export const LEDGERLINK_RULESET_NOTICE_KIND = 'ledgerlink_ruleset_required';
const DAY_MS = 24 * 60 * 60 * 1000;
const DEDUP_MS = 7 * DAY_MS;
const EXPIRY_MS = 14 * DAY_MS;
const CHARACTERS_LINK = '/profile/gaming/characters';

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
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly notifications: NotificationService,
  ) {}

  /** One in-app notice per member + character per 7 days; never throws. */
  async notifyRulesetRequired(
    userId: number,
    detail: AddonImportRulesetDetail,
  ): Promise<void> {
    try {
      const now = Date.now();
      const since = new Date(now - DEDUP_MS);
      if (await this.recentlyNotified(userId, detail.guid, since)) return;
      await this.notifications.create({
        userId,
        type: 'system',
        ...buildRulesetNotice(detail),
        expiresAt: new Date(now + EXPIRY_MS),
        skipDiscord: true,
      });
    } catch (err: unknown) {
      const why = err instanceof Error ? err.message : 'unknown error';
      this.logger.warn(`ruleset notice failed user=${userId}: ${why}`);
    }
  }

  private async recentlyNotified(
    userId: number,
    guid: string,
    since: Date,
  ): Promise<boolean> {
    const n = schema.notifications;
    const rows = await this.db
      .select({ id: n.id })
      .from(n)
      .where(
        and(
          eq(n.userId, userId),
          eq(n.type, 'system'),
          sql`${n.payload}->>'kind' = ${LEDGERLINK_RULESET_NOTICE_KIND}`,
          sql`${n.payload}->>'guid' = ${guid}`,
          gt(n.createdAt, since),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
}
