/**
 * ROK-1958 — the BG3 seed fixture's pure helpers: every planned save must be
 * a valid `bg3-save` v1 message (the ingest contract), the history must
 * cluster into more than one 20-row History page, and the newest save must
 * be the golden Act 2 party.
 */
import { Bg3SaveMessageSchema } from '@raid-ledger/contract';
import { BG3_SESSION_GAP_MS } from '../plugins/bg3/bg3.constants';
import { slotKeys } from '../plugins/bg3/claims/bg3-party-slot.helpers';
import { clusterSessions } from '../plugins/bg3/history/bg3-sessions.helpers';
import {
  BG3_FIXTURE_PARTY,
  BG3_SEED_CLAIMED_SLOT,
  BG3_SEED_SESSIONS,
  Bg3SeedHubSchema,
  bg3SeedCampaignKey,
  bg3SeedDiscordId,
  bg3SeedUsername,
  planSeedSaves,
  seedSaveMessage,
  variantShape,
} from './demo-test-bg3.helpers';

const NOW = new Date('2026-10-28T12:00:00Z');

function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`missing ${label}`);
  return value;
}

describe('BG3 seed helpers (ROK-1958)', () => {
  const plans = planSeedSaves(NOW);
  const key = bg3SeedCampaignKey('bg3-desktop-w00');

  it('builds only messages the bg3-save v1 contract accepts', () => {
    const failures = plans
      .map((p, i) => Bg3SaveMessageSchema.safeParse(seedSaveMessage(p, i, key)))
      .filter((r) => !r.success)
      .map((r) => JSON.stringify(r.error?.issues));
    expect(failures).toEqual([]);
  });

  it('clusters into more sessions than one 20-row History page', () => {
    const rows = plans.map((p, i) => ({
      id: i + 1,
      savedAt: p.savedAt,
      currentLevel: p.currentLevel,
      partyMaxLevel: p.level,
    }));
    const sessions = clusterSessions(rows, BG3_SESSION_GAP_MS);
    expect(sessions).toHaveLength(BG3_SEED_SESSIONS);
    expect(BG3_SEED_SESSIONS).toBeGreaterThan(20);
  });

  it('keeps every save in the past, oldest first, inside 90-day retention', () => {
    const times = plans.map((p) => p.savedAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(Math.max(...times)).toBeLessThan(NOW.getTime());
    const ninetyDays = 90 * 86_400_000;
    expect(NOW.getTime() - Math.min(...times)).toBeLessThan(ninetyDays);
  });

  it('ends on the golden Act 2 party: 4 heroes + 1 summon at level 8', () => {
    const last = must(plans.at(-1), 'newest plan');
    const msg = seedSaveMessage(last, plans.length - 1, key);
    expect(msg.payload.currentLevel).toBe('SCL_Main_A');
    expect(msg.payload.party).toEqual(BG3_FIXTURE_PARTY);
    expect(msg.payload.party.filter((m) => m.isSummon)).toHaveLength(1);
    expect(must(plans[0], 'oldest plan').level).toBe(3);
  });

  it('claims a slot the party actually has', () => {
    expect(slotKeys(BG3_FIXTURE_PARTY)).toContain(BG3_SEED_CLAIMED_SLOT);
  });

  it('derives stable per-tag ids in the expected shapes', () => {
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(bg3SeedCampaignKey('bg3-desktop-w00')).toBe(key);
    expect(bg3SeedCampaignKey('bg3-mobile-w00')).not.toBe(key);
    const id = bg3SeedDiscordId(bg3SeedUsername('host', 'x'));
    expect(id).toMatch(/^97\d{16}$/);
    expect(bg3SeedUsername('visitor', 'bg3-mobile-w01')).toBe(
      'bg3-visitor-bg3-mobile-w01',
    );
  });

  it('maps each variant to what it seeds', () => {
    expect(variantShape('default')).toEqual({
      campaign: true,
      assignSaves: true,
      claim: true,
      spoilers: false,
    });
    expect(variantShape('spoilers').spoilers).toBe(true);
    expect(variantShape('no-saves')).toMatchObject({
      campaign: true,
      assignSaves: false,
    });
    expect(variantShape('no-campaign')).toMatchObject({
      campaign: false,
      assignSaves: false,
    });
  });

  it('rejects a bad tag or unknown variant', () => {
    expect(Bg3SeedHubSchema.safeParse({ tag: 'Bad Tag' }).success).toBe(false);
    expect(
      Bg3SeedHubSchema.safeParse({ tag: 'ok', variant: 'nope' }).success,
    ).toBe(false);
    expect(Bg3SeedHubSchema.safeParse({ tag: 'ok' }).success).toBe(true);
  });
});
