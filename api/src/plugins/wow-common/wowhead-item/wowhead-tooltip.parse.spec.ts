/**
 * ROK-2176: unit tests for the pure Wowhead tooltip HTML parser.
 * Fixtures are tooltip-endpoint captures in `testing/fixtures/wowhead/`.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { ItemTooltipSchema } from '@raid-ledger/contract';
import type { ItemTooltip } from '@raid-ledger/contract';
import type { WowheadEnv } from './wowhead-item.types';
import {
  parseTooltipHtml,
  toStatKey,
  WOWHEAD_TOOLTIP_MAX_BYTES,
} from './wowhead-tooltip.parse';
import { effectToStat, htmlToText } from './wowhead-tooltip.effects';

const FIXTURES = join(__dirname, '..', 'testing', 'fixtures', 'wowhead');

function fixtureHtml(id: number, env: WowheadEnv): string {
  const raw = readFileSync(join(FIXTURES, `item-${id}-env${env}.json`), 'utf8');
  const body: unknown = JSON.parse(raw);
  if (
    typeof body === 'object' &&
    body !== null &&
    'tooltip' in body &&
    typeof body.tooltip === 'string'
  ) {
    return body.tooltip;
  }
  throw new Error(`fixture ${id}/${env} has no tooltip string`);
}

/** Parsed + schema-validated; a null parse fails loudly. */
function parsed(id: number, env: WowheadEnv): ItemTooltip {
  const result = parseTooltipHtml(fixtureHtml(id, env), env);
  if (result === null) throw new Error(`fixture ${id}/${env} parsed to null`);
  return ItemTooltipSchema.parse(result);
}

const flat = (key: string, name: string, value: number) => ({
  key,
  name,
  value,
  unit: 'flat',
});

describe('parseTooltipHtml — fixtures', () => {
  it('17182 Sulfuras: two-hander slot, weapon line, stats, fire resistance', () => {
    const t = parsed(17182, 4);
    expect(t).toMatchObject({
      env: 4,
      slotLabel: 'Two-Hand',
      subclass: 'Mace',
      binding: 'Binds when picked up',
      unique: true,
      requiredLevel: 60,
      armor: null,
      weapon: { damageMin: 223, damageMax: 372, attackSpeed: 3.7, dps: 80.41 },
      setName: null,
      randomEnchant: false,
    });
    expect(t.stats).toEqual([
      flat('STRENGTH', 'Strength', 12),
      flat('STAMINA', 'Stamina', 12),
      flat('FIRE_RESISTANCE', 'Fire Resistance', 30),
    ]);
  });

  it('17182: Chance on hit and a non-whitelisted Equip stay text-only', () => {
    const t = parsed(17182, 4);
    expect(t.effects).toEqual([
      'Chance on hit: Hurls a fiery ball that causes 273 to 333 Fire damage and an additional 75 damage over 10 sec.',
      'Equip: Deals 5 Fire damage to anyone who strikes you with a melee attack.',
    ]);
  });

  it('18821 Quick Strike Ring: Finger, empty subclass → null, crit % + AP', () => {
    const t = parsed(18821, 4);
    expect(t).toMatchObject({
      slotLabel: 'Finger',
      subclass: null,
      unique: true,
      armor: null,
      weapon: null,
    });
    expect(t.stats).toEqual([
      flat('STRENGTH', 'Strength', 5),
      flat('STAMINA', 'Stamina', 8),
      { key: 'CRIT_PCT', name: 'Critical Strike', value: 1, unit: 'percent' },
      flat('ATTACK_POWER', 'Attack Power', 30),
    ]);
  });

  it('16922 env4: armor, two resistances, healing + mp5, set name', () => {
    const t = parsed(16922, 4);
    expect(t).toMatchObject({
      slotLabel: 'Legs',
      subclass: 'Cloth',
      binding: 'Binds when picked up',
      unique: false,
      requiredLevel: 60,
      armor: 101,
      setName: 'Vestments of Transcendence',
    });
    expect(t.stats).toEqual([
      flat('STAMINA', 'Stamina', 16),
      flat('INTELLECT', 'Intellect', 21),
      flat('SPIRIT', 'Spirit', 21),
      flat('ARCANE_RESISTANCE', 'Arcane Resistance', 10),
      flat('SHADOW_RESISTANCE', 'Shadow Resistance', 10),
      flat('HEALING', 'Healing', 46),
      flat('MP5', 'Mana per 5 sec', 7),
    ]);
  });

  it('234819 env16: stat50 is Bonus Armor, never merged into armor', () => {
    const t = parsed(234819, 16);
    expect(t).toMatchObject({ env: 16, armor: 133, unique: true });
    expect(t.stats).toEqual([
      flat('STAMINA', 'Stamina', 30),
      flat('INTELLECT', 'Intellect', 15),
      flat('SPIRIT', 'Spirit', 10),
      flat('BONUS_ARMOR', 'Bonus Armor', 40),
    ]);
  });

  it('15210 Raider Shortsword: <Random enchantment> → flag set, no stats', () => {
    const t = parsed(15210, 4);
    expect(t).toMatchObject({
      slotLabel: 'One-Hand',
      subclass: 'Sword',
      binding: 'Binds when equipped',
      unique: false,
      requiredLevel: 11,
      randomEnchant: true,
      weapon: { damageMin: 11, damageMax: 20, attackSpeed: 1.9, dps: 8.16 },
    });
    expect(t.stats).toEqual([]);
    expect(t.effects).toEqual([]);
  });

  it('18500: hit % from Equip', () => {
    expect(parsed(18500, 4).stats).toEqual([
      flat('AGILITY', 'Agility', 15),
      { key: 'HIT_PCT', name: 'Hit', value: 1, unit: 'percent' },
    ]);
  });

  it('19375: spell power parsed; spell crit stays text-only', () => {
    const t = parsed(19375, 4);
    expect(t.stats.map((s) => s.key)).toEqual([
      'STAMINA',
      'INTELLECT',
      'SPIRIT',
      'SPELL_POWER',
    ]);
    expect(t.stats[3]?.value).toBe(35);
    expect(t.effects).toHaveLength(2);
  });

  it('16866: defense parsed; dodge stays text-only; set name', () => {
    const t = parsed(16866, 4);
    expect(t.stats).toEqual([
      flat('STRENGTH', 'Strength', 15),
      flat('STAMINA', 'Stamina', 35),
      flat('FIRE_RESISTANCE', 'Fire Resistance', 10),
      flat('DEFENSE', 'Defense', 7),
    ]);
    expect(t.setName).toBe('Battlegear of Might');
    expect(t.armor).toBe(608);
  });
});

describe('effectToStat — whitelist (operator Q3)', () => {
  it.each([
    ['Equip: +30 Attack Power.', 'ATTACK_POWER', 30, 'flat'],
    [
      'Equip: Improves your chance to get a critical strike by 2%.',
      'CRIT_PCT',
      2,
      'percent',
    ],
    ['Equip: Improves your chance to hit by 1%.', 'HIT_PCT', 1, 'percent'],
    [
      'Equip: Increases damage and healing done by magical spells and effects by up to 35.',
      'SPELL_POWER',
      35,
      'flat',
    ],
    [
      'Equip: Increases healing done by spells and effects by up to 46.',
      'HEALING',
      46,
      'flat',
    ],
    ['Equip: Restores 7 mana per 5 sec.', 'MP5', 7, 'flat'],
    ['Equip: Increased Defense +7.', 'DEFENSE', 7, 'flat'],
  ])('%s → %s', (line, key, value, unit) => {
    expect(effectToStat(line)).toMatchObject({ key, value, unit });
  });

  it.each([
    'Use: +30 Attack Power.',
    'Chance on hit: Improves your chance to hit by 1%.',
    'Equip: Improves your chance to get a critical strike with spells by 2%.',
    'Equip: Improves your chance to hit with spells by 1%.',
    'Equip: Increases your chance to dodge an attack by 1%.',
  ])('%s → null (not a whitelisted Equip line)', (line) => {
    expect(effectToStat(line)).toBeNull();
  });
});

describe('parseTooltipHtml — unusable input', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
    ['an object', { tooltip: '<!--ilvl-->10' }],
    ['an empty string', ''],
    [
      'HTML without an ilvl marker',
      '<table><tr><td><b>Thing</b></td></tr></table>',
    ],
  ])('%s → null', (_label, input) => {
    expect(parseTooltipHtml(input, 4)).toBeNull();
  });

  it('HTML over 64 KB → null even with an ilvl marker', () => {
    const html = `<!--ilvl-->10${'x'.repeat(WOWHEAD_TOOLTIP_MAX_BYTES)}`;
    expect(parseTooltipHtml(html, 4)).toBeNull();
  });

  it('only the ilvl marker → every field null/empty, schema-valid, env kept', () => {
    const t = parseTooltipHtml('<!--ilvl-->10', 16);
    expect(ItemTooltipSchema.parse(t)).toEqual({
      env: 16,
      slotLabel: null,
      subclass: null,
      binding: null,
      unique: false,
      requiredLevel: null,
      armor: null,
      weapon: null,
      stats: [],
      effects: [],
      setName: null,
      randomEnchant: false,
    });
  });

  it('truncated fixture HTML does not throw and stays schema-valid', () => {
    const html = fixtureHtml(17182, 4);
    for (const cut of [200, 600, 900, 1400]) {
      const t = parseTooltipHtml(html.slice(0, cut), 4);
      expect(() => ItemTooltipSchema.parse(t)).not.toThrow();
    }
  });

  it('a weapon line without dps → weapon null', () => {
    const html = '<!--ilvl-->10<!--dmg-->1 - 2 Damage <!--spd-->2.00';
    expect(parseTooltipHtml(html, 4)?.weapon).toBeNull();
  });
});

describe('helpers', () => {
  it('toStatKey derives UPPER_SNAKE from the display name (L4)', () => {
    expect(toStatKey('Fire Resistance')).toBe('FIRE_RESISTANCE');
    expect(toStatKey(' Bonus Armor ')).toBe('BONUS_ARMOR');
    expect(toStatKey('Mana per 5 sec.')).toBe('MANA_PER_5_SEC');
  });

  it('htmlToText strips tags/comments and decodes entities', () => {
    expect(
      htmlToText(
        '<!--x--><a href="/y">&lt;A&gt; &amp; &quot;B&quot; &#39;C&#39;</a>',
      ),
    ).toBe('<A> & "B" \'C\'');
  });
});
