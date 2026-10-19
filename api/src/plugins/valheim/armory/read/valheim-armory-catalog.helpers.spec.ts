/**
 * ROK-1836 D4 (Codex P2) — the catalogue lookup is an own-property check:
 * a sheet prefab named after an `Object.prototype` member reads as "not in
 * catalogue" (D7 fallback), never an inherited value that 500s the detail.
 */
import type { ValheimCatalogEntry } from '@raid-ledger/contract';
import {
  projectCatalog,
  type ArmoryCatalogProjection,
  type ArmoryCatalogReadRow,
} from './valheim-armory-catalog.helpers';

const SWORD: ValheimCatalogEntry = {
  name: 'Iron sword',
  category: 'OneHandedWeapon',
  icon: { kind: 'atlas', x: 0, y: 0, w: 64, h: 64 },
};

function catalog(
  items: ArmoryCatalogReadRow['items'] = {},
): ArmoryCatalogReadRow {
  return {
    items: {
      SwordIron: {
        name: 'Iron sword',
        category: 'OneHandedWeapon',
        maxStack: 1,
        maxQuality: 4,
        variants: 0,
        icon: { kind: 'atlas', x: 0, y: 0, w: 64, h: 64 },
      },
      ...items,
    },
    atlasSha256: null,
    atlasWidth: null,
    atlasHeight: null,
    atlasReady: false,
  };
}

describe('projectCatalog own-property lookup', () => {
  it('treats constructor / toString / __proto__ as not in the catalogue', () => {
    const prefabs = ['SwordIron', '__proto__', 'constructor', 'toString'];
    let out: ArmoryCatalogProjection | 'threw';
    try {
      out = projectCatalog(prefabs, catalog());
    } catch {
      out = 'threw';
    }
    expect(out).toEqual({ items: { SwordIron: SWORD }, atlas: null });
  });

  it('keeps a catalogue entry the catalogue really owns under such a name', () => {
    const own = JSON.parse(
      '{"__proto__":{"name":"Odd","category":"Misc","maxStack":1,"maxQuality":1,"variants":0,"icon":null}}',
    ) as ArmoryCatalogReadRow['items'];
    const out = projectCatalog(['__proto__'], catalog(own));
    expect(Object.keys(out.items)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(out.items)).toBe(Object.prototype);
  });
});
