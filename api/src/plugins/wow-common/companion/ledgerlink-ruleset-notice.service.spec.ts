/**
 * ROK-2100 §4 B.2/B.3 — the companion's RULESET_REQUIRED notice: exact copy
 * (with and without a realm), in-app `system` type, a 14-day expiry, the
 * 7-day per-character dedup (an atomic `NotificationDedupService` claim), and
 * it never throws.
 */
import type { NotificationDedupService } from '../../../notifications/notification-dedup.service';
import type { NotificationService } from '../../../notifications/notification.service';
import type { AddonImportRulesetDetail } from '../addon-import/addon-import.errors';
import {
  LEDGERLINK_RULESET_NOTICE_KIND,
  LedgerlinkRulesetNoticeService,
  buildRulesetNotice,
  rulesetNoticeDedupKey,
} from './ledgerlink-ruleset-notice.service';

const NOW = new Date('2026-11-06T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const DETAIL: AddonImportRulesetDetail = {
  characterName: 'Ana',
  realmName: 'CAMWOW US2 Realm 9',
  guid: 'Player-4395-0000BEEF',
};

const KEY = rulesetNoticeDedupKey(7, DETAIL.guid);
const SEVEN_DAYS_S = 7 * 24 * 60 * 60;

/**
 * A dedup double with the real claim semantics: the first claim of a key
 * wins (false = send), every later one loses (true = skip) — the
 * `ON CONFLICT DO NOTHING` insert the real service makes.
 */
function atomicDedup() {
  const claimed = new Set<string>();
  return {
    checkAndMarkSent: jest.fn((key: string) => {
      const taken = claimed.has(key);
      claimed.add(key);
      return Promise.resolve(taken);
    }),
    releaseKey: jest.fn((key: string) => {
      claimed.delete(key);
      return Promise.resolve();
    }),
  };
}

function serviceWith(create = jest.fn().mockResolvedValue({})) {
  const dedup = atomicDedup();
  const notifications = { create } as unknown as NotificationService;
  return {
    svc: new LedgerlinkRulesetNoticeService(
      dedup as unknown as NotificationDedupService,
      notifications,
    ),
    create,
    dedup,
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
    const { svc, create, dedup } = serviceWith();
    await svc.notifyRulesetRequired(7, DETAIL);
    expect(dedup.checkAndMarkSent).toHaveBeenCalledWith(
      'ledgerlink-ruleset:7:Player-4395-0000BEEF',
      SEVEN_DAYS_S,
    );
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
    const { svc, create } = serviceWith();
    await svc.notifyRulesetRequired(7, DETAIL);
    await svc.notifyRulesetRequired(7, DETAIL);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('two concurrent rejected uploads → exactly one notification (Codex P2)', async () => {
    const { svc, create } = serviceWith();
    await Promise.all([
      svc.notifyRulesetRequired(7, DETAIL),
      svc.notifyRulesetRequired(7, DETAIL),
    ]);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('another character of the same member is not deduped', async () => {
    const { svc, create } = serviceWith();
    await svc.notifyRulesetRequired(7, DETAIL);
    await svc.notifyRulesetRequired(7, {
      ...DETAIL,
      guid: 'Player-4395-0000CAFE',
    });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('a failing insert is logged, swallowed, and gives the claim back', async () => {
    const create = jest.fn().mockRejectedValue(new Error('db down'));
    const { svc, dedup } = serviceWith(create);
    await expect(svc.notifyRulesetRequired(7, DETAIL)).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledTimes(1);
    expect(dedup.releaseKey).toHaveBeenCalledWith(KEY);
  });

  it('a failing dedup claim is swallowed and sends nothing', async () => {
    const { svc, create, dedup } = serviceWith();
    dedup.checkAndMarkSent.mockRejectedValueOnce(new Error('redis down'));
    await expect(svc.notifyRulesetRequired(7, DETAIL)).resolves.toBeUndefined();
    expect(create).not.toHaveBeenCalled();
  });
});
