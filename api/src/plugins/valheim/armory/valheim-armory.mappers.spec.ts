/**
 * ROK-1835 L2 — pure importer mappers against every golden fixture: payload
 * re-validation (kind / key-column drift → failure detail, never payload
 * text), profile / map / catalogue row values, known-list truncation.
 */
import {
  ValheimCharacterMessageSchema,
  ValheimItemsMessageSchema,
  ValheimMapMessageSchema,
} from '@raid-ledger/contract';
import { loadValheimFixture } from '../link/ingest/valheim-link-ingest.testing';
import { valheimSnapshotRow } from '../link/ingest/valheim-link-snapshot.helpers';
import {
  ARMORY_KNOWN_LIST_MAX,
  capKnownList,
  toCatalogValues,
  toMapValues,
  toProfileValues,
  validateSnapshotPayload,
  type ArmorySnapshot,
} from './valheim-armory.mappers';

const SERVER = 7;

function snapshotOf(name: string, id = 11): ArmorySnapshot {
  const msg = loadValheimFixture(name);
  const row = valheimSnapshotRow(SERVER, msg as never);
  return {
    id,
    pelicanServerId: SERVER,
    kind: row.kind,
    steamId: row.steamId ?? null,
    playerId: row.playerId ?? null,
    worldUid: row.worldUid ?? null,
    receivedAt: '2026-10-17 20:16:00.123456+00',
    payload: msg,
  };
}

function valid(snap: ArmorySnapshot) {
  const res = validateSnapshotPayload(snap);
  if (!res.ok) throw new Error(`expected valid: ${res.detail}`);
  return res.message;
}

describe('validateSnapshotPayload', () => {
  it.each([
    'character-vanilla',
    'character-eaqs',
    'map-personal',
    'map-shared-layer',
    'items-atlas',
    'items-file-icons',
  ])('accepts the %s fixture', (name) => {
    expect(validateSnapshotPayload(snapshotOf(name)).ok).toBe(true);
  });

  it('fails with issue paths and codes, never payload text', () => {
    const snap = snapshotOf('character-vanilla');
    snap.payload = { ...snap.payload, character: { name: 'SecretName' } };
    const res = validateSnapshotPayload(snap);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.detail).toMatch(/^invalid:character\.\w+:\w+/);
    expect(res.detail).not.toContain('SecretName');
    expect(res.detail.length).toBeLessThanOrEqual(200);
  });

  it('fails when the row kind disagrees with the payload kind', () => {
    const snap = { ...snapshotOf('character-vanilla'), kind: 'map' };
    expect(validateSnapshotPayload(snap)).toEqual({
      ok: false,
      detail: 'invalid:kind_mismatch',
    });
  });

  it('fails when a key column disagrees with the payload identity', () => {
    const snap = { ...snapshotOf('map-personal'), playerId: '1' };
    expect(validateSnapshotPayload(snap)).toEqual({
      ok: false,
      detail: 'invalid:key_mismatch',
    });
  });
});

describe('toProfileValues', () => {
  it.each(['character-vanilla', 'character-eaqs'])(
    'maps the %s sheet verbatim with identity + traceability',
    (name) => {
      const snap = snapshotOf(name);
      const msg = ValheimCharacterMessageSchema.parse(snap.payload);
      const { values, truncated } = toProfileValues(snap, msg);
      expect(truncated).toEqual([]);
      expect(values).toMatchObject({
        pelicanServerId: SERVER,
        steamId: msg.character.steamId,
        playerId: msg.character.playerId,
        worldUid: msg.character.worldUid,
        worldName: msg.character.worldName,
        name: msg.character.name,
        gameVersion: msg.gameVersion,
        modVersion: msg.modVersion,
        capturedAt: new Date(msg.capturedAt),
        equipment: msg.equipment,
        inventory: msg.inventory,
        skills: msg.skills,
        trophies: msg.trophies,
        knownItems: msg.knownItems,
        knownRecipes: msg.knownRecipes,
        sourceSnapshotId: snap.id,
      });
      expect(values).not.toHaveProperty('claimedBy');
    },
  );

  it('truncates an over-long known list and names it', () => {
    const snap = snapshotOf('character-vanilla');
    const msg = ValheimCharacterMessageSchema.parse(snap.payload);
    const long = Array.from({ length: ARMORY_KNOWN_LIST_MAX + 5 }, (_, i) =>
      `Item${i}`,
    );
    const { values, truncated } = toProfileValues(snap, {
      ...msg,
      knownRecipes: long,
    });
    expect(values.knownRecipes).toHaveLength(ARMORY_KNOWN_LIST_MAX);
    expect(truncated).toEqual(['knownRecipes']);
  });
});

describe('capKnownList', () => {
  it('keeps a list at the cap untouched', () => {
    const list = Array.from({ length: ARMORY_KNOWN_LIST_MAX }, () => 'X');
    expect(capKnownList(list)).toEqual({ list, truncated: false });
  });
});

describe('toMapValues', () => {
  it('maps a personal map: grid, fog verbatim, base-map ref', () => {
    const snap = snapshotOf('map-personal');
    const msg = ValheimMapMessageSchema.parse(snap.payload);
    const values = toMapValues(snap, msg, 42);
    expect(values).toMatchObject({
      pelicanServerId: SERVER,
      steamId: msg.character.steamId,
      playerId: msg.character.playerId,
      worldUid: msg.character.worldUid,
      profileId: 42,
      textureSize: msg.grid.textureSize,
      pixelSizeMetres: msg.grid.pixelSizeMetres,
      explored: msg.explored,
      sharedExplored: msg.sharedExplored,
      pins: msg.pins,
      baseMapSha256: msg.baseMap?.sha256 ?? null,
      baseMapWidth: msg.baseMap?.width ?? null,
      baseMapHeight: msg.baseMap?.height ?? null,
      capturedAt: new Date(msg.capturedAt),
      sourceSnapshotId: snap.id,
    });
  });

  it('keeps the shared cartography layer when present', () => {
    const snap = snapshotOf('map-shared-layer');
    const msg = ValheimMapMessageSchema.parse(snap.payload);
    expect(msg.sharedExplored).not.toBeNull();
    expect(toMapValues(snap, msg, null).sharedExplored).toEqual(
      msg.sharedExplored,
    );
  });
});

describe('toCatalogValues', () => {
  it('keys an atlas catalogue by prefab with atlas rects', () => {
    const snap = snapshotOf('items-atlas');
    const msg = ValheimItemsMessageSchema.parse(snap.payload);
    const values = toCatalogValues(snap, msg);
    expect(Object.keys(values.items).sort()).toEqual(
      msg.items.map((i) => i.prefab).sort(),
    );
    expect(values.atlasSha256).toBe(msg.atlas?.sha256);
    const first = msg.items[0];
    if (!first) throw new Error('fixture has no items');
    expect(values.items[first.prefab]).toEqual({
      name: first.name,
      category: first.category,
      maxStack: first.maxStack,
      maxQuality: first.maxQuality,
      variants: first.variants,
      icon: first.icon,
    });
  });

  it('keeps a file icon sha256 (or null) and the file name as metadata', () => {
    const snap = snapshotOf('items-file-icons');
    const values = toCatalogValues(
      snap,
      ValheimItemsMessageSchema.parse(snap.payload),
    );
    expect(values.atlasSha256).toBeNull();
    expect(values.items['SwordIron']?.icon).toEqual({
      kind: 'file',
      file: 'SwordIron.png',
      sha256: 'c'.repeat(64),
    });
    expect(values.items['FixtureModdedAxe']?.icon).toEqual({
      kind: 'file',
      file: 'FixtureModdedAxe.png',
      sha256: null,
    });
    expect(values.items['FixtureNoIcon']?.icon).toBeNull();
  });
});
