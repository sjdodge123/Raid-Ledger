/**
 * ROK-2100 §4 B.2/B.3 — the companion's RULESET_REQUIRED notice: exact copy
 * (with and without a realm), in-app `system` type, a 14-day expiry, the
 * 7-day per-character dedup, and it never throws.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../../drizzle/schema';
import type { NotificationService } from '../../../notifications/notification.service';
import type { AddonImportRulesetDetail } from '../addon-import/addon-import.errors';
import {
  LEDGERLINK_RULESET_NOTICE_KIND,
  LedgerlinkRulesetNoticeService,
  buildRulesetNotice,
} from './ledgerlink-ruleset-notice.service';

const NOW = new Date('2026-11-06T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const DETAIL: AddonImportRulesetDetail = {
  characterName: 'Ana',
  realmName: 'CAMWOW US2 Realm 9',
  guid: 'Player-4395-0000BEEF',
};

/** A db whose dedup `select … limit` resolves `rows`. */
function dbReturning(rows: unknown[]) {
  const limit = jest.fn().mockResolvedValue(rows);
  const chain = { from: jest.fn(), where: jest.fn(), limit };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  const db = { select: jest.fn().mockReturnValue(chain) };
  return { db: db as unknown as PostgresJsDatabase<typeof schema>, limit };
}

function serviceWith(
  rows: unknown[],
  create = jest.fn().mockResolvedValue({}),
) {
  const { db, limit } = dbReturning(rows);
  const notifications = { create } as unknown as NotificationService;
  return {
    svc: new LedgerlinkRulesetNoticeService(db, notifications),
    create,
    limit,
  };
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('buildRulesetNotice — copy (§4 B.3)', () => {
  it('names the character and realm', () => {
    expect(buildRulesetNotice(DETAIL)).toEqual({
      title: 'Pick a ruleset for Ana',
      message:
        "Your companion uploaded Ana on CAMWOW US2 Realm 9 but Raid Ledger couldn't tell which ruleset that realm plays (Normal, PvP, RP or RP-PvP). Import it once from Characters → Import from LedgerLink and choose the ruleset — after that, the companion keeps it up to date.",
      payload: {
        kind: LEDGERLINK_RULESET_NOTICE_KIND,
        guid: 'Player-4395-0000BEEF',
        characterName: 'Ana',
        realmName: 'CAMWOW US2 Realm 9',
        link: '/profile/gaming/characters',
      },
    });
  });

  it.each([null, '  '])(
    'omits " on {realm}" when the realm is %p',
    (realmName) => {
      const { message } = buildRulesetNotice({ ...DETAIL, realmName });
      expect(
        message.startsWith('Your companion uploaded Ana but Raid Ledger'),
      ).toBe(true);
    },
  );
});

describe('LedgerlinkRulesetNoticeService.notifyRulesetRequired', () => {
  it('no recent notice → one in-app system notification expiring in 14 days', async () => {
    const { svc, create } = serviceWith([]);
    await svc.notifyRulesetRequired(7, DETAIL);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      userId: 7,
      type: 'system',
      ...buildRulesetNotice(DETAIL),
      expiresAt: new Date(NOW.getTime() + 14 * DAY_MS),
      skipDiscord: true,
    });
  });

  it('a notice for the same character within 7 days → none', async () => {
    const { svc, create, limit } = serviceWith([{ id: 'n1' }]);
    await svc.notifyRulesetRequired(7, DETAIL);
    expect(limit).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  it('a failing insert is logged and swallowed (the device still gets its 400)', async () => {
    const create = jest.fn().mockRejectedValue(new Error('db down'));
    const { svc } = serviceWith([], create);
    await expect(svc.notifyRulesetRequired(7, DETAIL)).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledTimes(1);
  });
});
