/**
 * ROK-1835 L4 — read mappers build every response key explicitly, so a
 * SteamID64 (or any other stored column) cannot leak into a member response
 * via an object spread. Each output is locked against its contract schema.
 */
import {
  ValheimCharacterDetailSchema,
  ValheimCharacterSummarySchema,
  ValheimMapMetaSchema,
} from '@raid-ledger/contract';
import {
  toAdminSummary,
  toDetail,
  toMapMeta,
  toSummary,
  type ArmoryDetailReadRow,
  type ArmoryMapReadRow,
} from './valheim-armory-read.mappers';
import { loadValheimFixture } from '../../link/ingest/valheim-link-ingest.testing';

const STEAM = '76561198000000001';
const AT = new Date('2026-10-18T12:00:00.000Z');
/** The sheet columns exactly as the importer stores them from the fixture. */
const SHEET = loadValheimFixture('character-vanilla') as Pick<
  ArmoryDetailReadRow,
  'equipment' | 'inventory' | 'skills' | 'trophies'
>;

function row(over: Partial<ArmoryDetailReadRow> = {}): ArmoryDetailReadRow {
  return {
    id: 7,
    pelicanServerId: 3,
    serverName: 'Valheim One',
    name: 'Ragnar',
    worldName: 'Midgard',
    steamId: STEAM,
    claimSource: 'auto',
    capturedAt: AT,
    gameVersion: '0.219.16',
    ownerId: 11,
    ownerUsername: 'viking',
    ownerAvatar: null,
    ownerDiscordId: null,
    equipment: SHEET.equipment,
    inventory: SHEET.inventory,
    skills: SHEET.skills,
    trophies: SHEET.trophies,
    deathCount: null,
    ...over,
  };
}

const mapRow = (over: Partial<ArmoryMapReadRow> = {}): ArmoryMapReadRow => ({
  id: 5,
  worldUid: '1234567890123',
  textureSize: 2048,
  pixelSizeMetres: 12,
  pins: [],
  hasSharedExplored: false,
  baseMapSha256: 'a'.repeat(64),
  baseMapWidth: 2048,
  baseMapHeight: 2048,
  baseMapReady: true,
  capturedAt: AT,
  ...over,
});

describe('valheim armory read mappers (ROK-1835 L4)', () => {
  it('summary carries the owner and never the SteamID64', () => {
    const out = toSummary(row());
    expect(JSON.stringify(out)).not.toContain(STEAM);
    expect(out).not.toHaveProperty('steamId');
    expect(out.claimedBy).toEqual({
      id: 11,
      username: 'viking',
      avatar: null,
      discordId: null,
    });
    expect(out.capturedAt).toBe(AT.toISOString());
    expect(ValheimCharacterSummarySchema.parse(out)).toEqual(out);
  });

  it('summary of an unclaimed character has a null owner', () => {
    const out = toSummary(
      row({ ownerId: null, ownerUsername: null, claimSource: null }),
    );
    expect(out.claimedBy).toBeNull();
    expect(out.claimSource).toBeNull();
  });

  it('detail adds the sheet and map refs without the SteamID64', () => {
    const maps = [{ id: 5, worldUid: '1234567890123', capturedAt: AT }];
    const out = toDetail(row(), maps);
    expect(JSON.stringify(out)).not.toContain(STEAM);
    expect(out.maps).toEqual([
      { id: 5, worldUid: '1234567890123', capturedAt: AT.toISOString() },
    ]);
    expect(ValheimCharacterDetailSchema.parse(out)).toEqual(out);
  });

  it('admin summary is the only shape that includes steamId64', () => {
    expect(toAdminSummary(row()).steamId64).toBe(STEAM);
  });

  it('map meta reports the base-map ref with read-time readiness', () => {
    const out = toMapMeta(mapRow({ baseMapReady: false }));
    expect(out.baseMap).toEqual({
      sha256: 'a'.repeat(64),
      width: 2048,
      height: 2048,
      ready: false,
    });
    expect(ValheimMapMetaSchema.parse(out)).toEqual(out);
  });

  it('map meta has a null base map when the map carries no reference', () => {
    const out = toMapMeta(mapRow({ baseMapSha256: null }));
    expect(out.baseMap).toBeNull();
  });

  it('detail carries the lifetime deathCount (ROK-1931 Q2 = A), null when never reported', () => {
    const out = toDetail(row({ deathCount: 57 }), []);
    expect(out.deathCount).toBe(57);
    expect(ValheimCharacterDetailSchema.parse(out)).toEqual(out);
    expect(toDetail(row(), []).deathCount).toBeNull();
  });

  it("map meta adds the character's reported deaths as Death pins, minus one near its own (ROK-1931 D8)", () => {
    const own = {
      type: 'Death',
      label: 'here',
      x: 10,
      z: 10,
      checked: true,
      shared: false,
    };
    const out = toMapMeta(mapRow({ pins: [own] }), [
      { x: 13, z: 14, reportedAt: AT }, // exactly 5 m from `own` → dropped
      { x: -40, z: 2.5, reportedAt: AT },
    ]);
    expect(out.pins).toEqual([
      own,
      {
        type: 'Death',
        label: '',
        x: -40,
        z: 2.5,
        checked: false,
        shared: false,
        diedAt: AT.toISOString(),
      },
    ]);
    expect(ValheimMapMetaSchema.parse(out)).toEqual(out);
    expect(JSON.stringify(out)).not.toContain(STEAM);
  });
});
