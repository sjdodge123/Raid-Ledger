/**
 * ROK-1953 §3.1 — the hub Steam stats read shape (C1–C5). A masked hidden
 * achievement carries only its global %, so a viewer who has not earned it
 * never receives its name.
 */
import { describe, expect, it } from 'vitest';
import { HUB_PLUGIN_MANIFESTS, hubManifestProblems } from '../plugin-hub-manifests.js';
import { PluginSetupSchema } from '../plugin-setup.schema.js';
import { CORE_SETUP } from '../plugin-setup-requirements.js';
import {
  SteamAchievementViewSchema,
  SteamHubStatsResponseSchema,
  type SteamHubStatsResponse,
  type SteamHubUnlock,
} from '../steam-app-stats.schema.js';

const full = {
  masked: false,
  apiName: 'ACH_FIRST_BLOOD',
  name: 'First Blood',
  description: null,
  hidden: true,
  globalPct: 3.2,
} as const;
const unlock: SteamHubUnlock = {
  userId: 7,
  unlockedAt: '2026-10-24T20:00:00.000Z',
  achievement: { masked: true, globalPct: 3.2 },
};
const available: SteamHubStatsResponse = {
  available: true,
  appId: 1086940,
  totalAchievements: 54,
  viewer: { status: 'ok' },
  members: [
    {
      userId: 7,
      displayName: 'Astarion',
      avatarUrl: null,
      status: 'ok',
      unlockedCount: 12,
      playtimeMinutes: 6000,
      fetchedAt: '2026-10-25T04:30:00.000Z',
    },
  ],
  recentUnlocks: [unlock],
  rarestUnlock: { ...unlock, achievement: full },
  refreshedAt: '2026-10-25T04:30:00.000Z',
};

describe('SteamAchievementViewSchema (§3.1)', () => {
  it('C1: rejects a masked achievement that also carries its name', () => {
    const leak = { masked: true, globalPct: 3.2, name: 'First Blood' };
    expect(SteamAchievementViewSchema.safeParse(leak).success).toBe(false);
  });

  it('C2: round-trips a full achievement unchanged', () => {
    expect(SteamAchievementViewSchema.parse(full)).toEqual(full);
  });
});

describe('SteamHubStatsResponseSchema (§3.1)', () => {
  it('C2: round-trips an available response unchanged', () => {
    expect(SteamHubStatsResponseSchema.parse(available)).toEqual(available);
  });

  it('C3: rejects more than 8 recent unlocks', () => {
    const nine = { ...available, recentUnlocks: Array.from({ length: 9 }, () => unlock) };
    expect(SteamHubStatsResponseSchema.safeParse(nine).success).toBe(false);
  });

  it('C4: an unavailable response carries nothing else', () => {
    expect(SteamHubStatsResponseSchema.parse({ available: false })).toEqual({ available: false });
    const extra = { available: false, appId: 1 };
    expect(SteamHubStatsResponseSchema.safeParse(extra).success).toBe(false);
  });

  it('rejects an unknown member status', () => {
    const bad = { ...available, viewer: { status: 'banned' } };
    expect(SteamHubStatsResponseSchema.safeParse(bad).success).toBe(false);
  });
});

describe('Core setup (§3.2, D7)', () => {
  it('C5: Core declares the two optional Steam requirements and the manifests stay valid', () => {
    expect(PluginSetupSchema.parse(CORE_SETUP)).toEqual(CORE_SETUP);
    expect(CORE_SETUP.requirements.map((r) => [r.id, r.kind, r.required])).toEqual([
      ['steam-api-key', 'admin_setting', false],
      ['player-steam-link', 'steam_link', false],
    ]);
    expect(hubManifestProblems(HUB_PLUGIN_MANIFESTS)).toEqual([]);
  });
});
