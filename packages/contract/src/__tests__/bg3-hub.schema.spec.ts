/**
 * ROK-1957 §3 — BG3 plugin contract: the hub declaration + setup (D-16/D-17),
 * the claim slot key (D-10), the snapshot union, and the write bodies.
 */
import { describe, expect, it } from 'vitest';
import {
  BG3_CAMPAIGN_NAME_MAX,
  BG3_GAME_SLUG,
  BG3_GAME_SLUGS,
  Bg3ClaimBodySchema,
  Bg3CreateCampaignBodySchema,
  Bg3DefaultCampaignBodySchema,
  Bg3HubSettingsBodySchema,
  Bg3MySaveSchema,
  Bg3PartySlotSchema,
  Bg3SlotKeySchema,
  Bg3SnapshotResponseSchema,
  Bg3UpdateCampaignBodySchema,
  isBg3GameSlug,
} from '../bg3-hub.schema.js';
import { PluginHubManifestSchema } from '../plugin-hub-manifest.schema.js';
import { BG3_HUB_MANIFEST, hubManifestProblems } from '../plugin-hub-manifests.js';

const tav = {
  origin: 'Generic',
  race: 'Elf_WoodElf',
  level: 8,
  xpLevel: 5630,
  xpTotal: 35630,
  classes: [{ main: 'Barbarian', sub: 'BerserkerPath' }],
  isSummon: false,
};
const summon = { ...tav, origin: 'DogFamiliar_Scratch_Summon', race: 'Beast', level: 1, xpLevel: 0, xpTotal: 0, classes: [], isSummon: true };
const claim = { userId: 7, displayName: 'Jake', avatarUrl: null };

const snapshot = {
  empty: false,
  campaignId: 1,
  saveId: 42,
  saveName: 'Act 2 — Last Light',
  savedAt: '2026-10-27T21:00:00Z',
  receivedAt: '2026-10-27T21:00:05Z',
  uploaderUserId: 7,
  area: 'SCL_Main_A',
  difficulty: 'DifficultyHard',
  ruleset: null,
  gameVersion: '4.1.1.6072089',
  platform: 'Steam',
  party: [
    { ...tav, slotKey: 'Generic:Elf_WoodElf:1', claim },
    { ...summon, slotKey: null, claim: null },
  ],
  thumbnailUrl: '/api/plugins/bg3/saves/42/thumbnail',
  spoilersHidden: false,
};

const messages = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  (r.error?.issues ?? []).map((i) => i.message);

describe('BG3_HUB_MANIFEST (D-16 / D-17)', () => {
  it('parses unchanged and has no problems', () => {
    expect(PluginHubManifestSchema.parse(BG3_HUB_MANIFEST)).toEqual(BG3_HUB_MANIFEST);
    expect(hubManifestProblems({ bg3: BG3_HUB_MANIFEST })).toEqual([]);
  });

  it('declares the ingest source and the retention job, no widgets or tabs, scoped to BG3', () => {
    expect(BG3_HUB_MANIFEST.behaviours.map((b) => `${b.kind}/${b.id}`)).toEqual([
      'ingest-source/bg3-save',
      'scheduled-job/Bg3HistoryRetentionCron_prune',
    ]);
    expect([BG3_HUB_MANIFEST.widgets, BG3_HUB_MANIFEST.tabs]).toEqual([[], []]);
    expect(BG3_HUB_MANIFEST.gameSlugs).toEqual([...BG3_GAME_SLUGS]);
  });

  it('ROK-2038: the canonical slug is the seeded one; both known slugs match', () => {
    expect(BG3_GAME_SLUG).toBe('baldurs-gate-iii');
    expect(['baldurs-gate-iii', 'baldurs-gate-3'].map(isBg3GameSlug)).toEqual([true, true]);
    expect(['valheim', '', null, undefined].map(isBg3GameSlug)).toEqual([false, false, false, false]);
  });

  it('setup: two required per-hub requirements on community hubs, without a check', () => {
    expect(
      BG3_HUB_MANIFEST.setup.requirements.map((r) => ({
        id: r.id,
        kind: r.kind,
        required: r.required,
        appliesTo: r.appliesTo,
        hasCheck: 'check' in r,
      })),
    ).toEqual([
      { id: 'upload-saves', kind: 'companion_app', required: true, appliesTo: ['game_community'], hasCheck: false },
      { id: 'bind-campaign', kind: 'other', required: true, appliesTo: ['game_community'], hasCheck: false },
    ]);
  });
});

describe('Bg3SlotKeySchema (D-10 origin:race:ordinal)', () => {
  it.each(['Generic:Human:1', 'Generic:Elf_WoodElf:2', 'Shadowheart:HalfElf:16'])('accepts %s', (key) => {
    expect(Bg3SlotKeySchema.safeParse(key).success).toBe(true);
  });

  it.each(['Generic:Human:0', 'Generic:Human:17', 'Generic:Human', 'Generic:Human:01', 'a:b:1:2', 'Gen-eric:Human:1'])(
    'rejects %s',
    (key) => {
      expect(messages(Bg3SlotKeySchema.safeParse(key))).toEqual(['Invalid party slot']);
    },
  );
});

describe('Bg3PartySlotSchema', () => {
  it('is a bg3-save party member plus slotKey and claim (summon slot null)', () => {
    expect(Bg3PartySlotSchema.safeParse({ ...tav, slotKey: 'Generic:Elf_WoodElf:1', claim }).success).toBe(true);
    expect(Bg3PartySlotSchema.safeParse({ ...summon, slotKey: null, claim: null }).success).toBe(true);
  });

  it('rejects an unknown key (strict) and a missing claim', () => {
    expect(Bg3PartySlotSchema.safeParse({ ...tav, slotKey: null, claim: null, name: 'Tav' }).success).toBe(false);
    expect(Bg3PartySlotSchema.safeParse({ ...tav, slotKey: null }).success).toBe(false);
  });
});

describe('Bg3SnapshotResponseSchema (union on `empty`)', () => {
  it('accepts a snapshot, a spoiler-hidden snapshot and an empty campaign', () => {
    expect(Bg3SnapshotResponseSchema.parse(snapshot)).toEqual(snapshot);
    const hidden = { ...snapshot, area: null, thumbnailUrl: null, spoilersHidden: true };
    expect(Bg3SnapshotResponseSchema.parse(hidden)).toEqual(hidden);
    expect(Bg3SnapshotResponseSchema.parse({ empty: true, campaignId: 1 })).toEqual({ empty: true, campaignId: 1 });
  });

  it('rejects an empty marker carrying save fields, and a snapshot without the marker', () => {
    expect(Bg3SnapshotResponseSchema.safeParse({ empty: true, campaignId: 1, saveId: 42 }).success).toBe(false);
    const { empty: _drop, ...noMarker } = snapshot;
    expect(Bg3SnapshotResponseSchema.safeParse(noMarker).success).toBe(false);
  });
});

describe('Bg3MySaveSchema', () => {
  const save = {
    id: 42,
    saveName: 'Quicksave',
    savedAt: '2026-10-27T21:00:00Z',
    campaignKey: 'a'.repeat(64),
    campaignKeySource: 'save-folder',
    campaignId: null,
    area: 'SCL_Main_A',
    thumbnailUrl: null,
  };

  it('accepts an unassigned save and rejects a non-hex campaign key', () => {
    expect(Bg3MySaveSchema.safeParse(save).success).toBe(true);
    expect(Bg3MySaveSchema.safeParse({ ...save, campaignKey: 'Z'.repeat(64) }).success).toBe(false);
  });
});

describe('write bodies', () => {
  it('campaign name: 1..64 display-safe characters', () => {
    expect(Bg3CreateCampaignBodySchema.safeParse({ name: 'Tadpole Trouble' }).success).toBe(true);
    expect(Bg3CreateCampaignBodySchema.safeParse({ name: 'x'.repeat(BG3_CAMPAIGN_NAME_MAX + 1) }).success).toBe(false);
    expect(Bg3CreateCampaignBodySchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(Bg3CreateCampaignBodySchema.safeParse({ name: 'line\nbreak' }).success).toBe(false);
  });

  it('update campaign and hub settings need at least one field', () => {
    expect(messages(Bg3UpdateCampaignBodySchema.safeParse({}))).toEqual(['Change at least one field']);
    expect(messages(Bg3HubSettingsBodySchema.safeParse({}))).toEqual(['Change at least one field']);
    expect(Bg3UpdateCampaignBodySchema.safeParse({ hostUserId: 3 }).success).toBe(true);
    expect(Bg3HubSettingsBodySchema.safeParse({ activeCampaignId: null }).success).toBe(true);
    expect(Bg3HubSettingsBodySchema.safeParse({ hideLocationAndScreenshots: true }).success).toBe(true);
  });

  it('rejects unknown keys, and accepts a null default campaign', () => {
    expect(Bg3UpdateCampaignBodySchema.safeParse({ name: 'A', isActive: true }).success).toBe(false);
    expect(Bg3DefaultCampaignBodySchema.parse({ campaignId: null })).toEqual({ campaignId: null });
    expect(Bg3ClaimBodySchema.safeParse({ slotKey: 'Generic:Human:1', userId: 9 }).success).toBe(false);
  });
});
