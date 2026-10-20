/**
 * ROK-1854 L2 — recipe-set mappers against the golden `recipes-vanilla` and
 * `recipes-processing` fixtures: row counts, wire identity (`recipeId` = id,
 * `ord` = index), raw jsonb requirement lists, atlas columns null vs set.
 */
import {
  ValheimRecipesMessageSchema,
  type ValheimRecipesMessage,
} from '@raid-ledger/contract';
import { loadValheimFixture } from '../link/ingest/valheim-link-ingest.testing';
import type { ArmorySnapshot } from './valheim-armory.mappers';
import {
  toPieceRows,
  toProcessorRows,
  toProcessRows,
  toRecipeRows,
  toRecipeSetValues,
  toStationRows,
} from './valheim-recipes.mappers';

const SERVER = 7;
const SET = 42;

function load(name: string): ValheimRecipesMessage {
  return ValheimRecipesMessageSchema.parse(loadValheimFixture(name));
}

function snapshotOf(msg: ValheimRecipesMessage, id = 11): ArmorySnapshot {
  return {
    id,
    pelicanServerId: SERVER,
    kind: 'recipes',
    steamId: null,
    playerId: null,
    worldUid: null,
    receivedAt: '2026-10-20 20:16:00.123456+00',
    payload: msg,
  };
}

describe('toRecipeSetValues', () => {
  it('keys the set by server + gameVersion with null atlas columns when the export has no atlas', () => {
    const msg = load('recipes-vanilla');
    expect(toRecipeSetValues(snapshotOf(msg), msg)).toEqual({
      pelicanServerId: SERVER,
      gameVersion: msg.gameVersion,
      locale: msg.locale,
      capturedAt: new Date(msg.capturedAt),
      atlasSha256: null,
      atlasWidth: null,
      atlasHeight: null,
      sourceSnapshotId: 11,
    });
  });

  it('copies the atlas sha256 and dimensions when the export carries one', () => {
    const msg = load('recipes-processing');
    const values = toRecipeSetValues(snapshotOf(msg), msg);
    expect(values.atlasSha256).toBe('d'.repeat(64));
    expect(values.atlasWidth).toBe(256);
    expect(values.atlasHeight).toBe(256);
  });
});

describe('child row mappers on recipes-vanilla', () => {
  const msg = load('recipes-vanilla');

  it('maps one row per wire entry, all under the set id', () => {
    const all = [
      ...toStationRows(SET, msg),
      ...toRecipeRows(SET, msg),
      ...toPieceRows(SET, msg),
      ...toProcessorRows(SET, msg),
      ...toProcessRows(SET, msg),
    ];
    expect(toStationRows(SET, msg)).toHaveLength(2);
    expect(toRecipeRows(SET, msg)).toHaveLength(2);
    expect(toPieceRows(SET, msg)).toHaveLength(1);
    expect(toProcessorRows(SET, msg)).toHaveLength(1);
    expect(toProcessRows(SET, msg)).toHaveLength(1);
    expect(new Set(all.map((r) => r.setId))).toEqual(new Set([SET]));
  });

  it('keys recipes by the wire id and carries the raw resources', () => {
    const rows = toRecipeRows(SET, msg);
    expect(rows.map((r) => r.recipeId)).toEqual(msg.recipes.map((r) => r.id));
    expect(rows[0]).toMatchObject({
      recipeId: 'Recipe_SwordIron',
      result: 'SwordIron',
      formula: msg.recipes[0]?.formula,
      resources: msg.recipes[0]?.resources,
    });
    expect(rows[0]?.resources).toHaveLength(3);
  });

  it('defaults an absent station upgrader flag to false', () => {
    expect(msg.stations.map((s) => s.upgrader)).toEqual([undefined, undefined]);
    expect(toStationRows(SET, msg).map((s) => s.upgrader)).toEqual([
      false,
      false,
    ]);
  });

  it('flattens the process output and carries raw inputs', () => {
    expect(toProcessRows(SET, msg)).toEqual([
      expect.objectContaining({
        ord: 0,
        processor: 'smelter',
        outputPrefab: 'Iron',
        inputs: [{ prefab: 'IronScrap', amount: 1 }],
      }),
    ]);
  });
});

describe('child row mappers on recipes-processing', () => {
  const msg = load('recipes-processing');

  it('numbers processes by wire index and keeps the obliterator null seconds', () => {
    const rows = toProcessRows(SET, msg);
    expect(rows.map((r) => r.ord)).toEqual([0, 1, 2]);
    expect(rows.map((r) => r.processor)).toEqual(
      msg.processes.map((p) => p.processor),
    );
    expect(rows[2]).toMatchObject({ outputPrefab: 'Coal', seconds: null });
    expect(rows[2]?.inputs).toEqual(msg.processes[2]?.inputs);
  });

  it('carries processor default results and piece icons/resources raw', () => {
    const processors = toProcessorRows(SET, msg);
    expect(processors.map((p) => p.type)).toEqual([
      'fermenter',
      'cooking',
      'incinerator',
    ]);
    expect(processors[2]?.defaultResult).toEqual({
      prefab: 'Coal',
      perInputs: 1,
    });
    expect(processors[0]?.defaultResult).toBeNull();
    const pieces = toPieceRows(SET, msg);
    expect(pieces.map((p) => p.icon)).toEqual(msg.pieces.map((p) => p.icon));
    expect(pieces[1]?.resources).toEqual(msg.pieces[1]?.resources);
    expect(pieces[1]?.resources).toHaveLength(3);
  });
});
