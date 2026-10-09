/**
 * ROK-1742 — the api decode path for the additive Forever `char` fields:
 * the `quests.completed` structural-limit exception, snapshot schema 2
 * (`quests`, gear `enchantId`/`gemIds`) and `who.gender` passthrough.
 */
import {
  ADDON_QUESTS_COMPLETED_MAX,
  ADDON_QUESTS_IN_PROGRESS_MAX,
  type AddonCharData,
} from '@raid-ledger/contract';
import { decodeImportString } from './addon-import.decoder';
import { AddonImportError } from './addon-import.errors';
import {
  ADDON_JSON_MAX_ARRAY,
  assertStructuralLimits,
} from './addon-import.limits';
import { parseItemLink, toCharSnapshotData } from './addon-import.sanitize';
import {
  FIXTURE_ITEM_LINK,
  buildCharPayload,
  buildImportString,
} from './testing/addon-fixture.builder';
import {
  FOREVER_ENCHANTED_LINK,
  FOREVER_SOCKETED_LINK,
  buildForeverQuestsPayload,
  buildForeverTalentsPayload,
  buildQuests,
} from './testing/addon-fixture.forever';

const code = (fn: () => unknown): string => {
  try {
    fn();
    return 'ok';
  } catch (err) {
    if (err instanceof AddonImportError) return err.body.code;
    throw err;
  }
};
const ids = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const completedAt = (n: number) => ({
  data: { quests: { completed: ids(n) } },
});

describe('assertStructuralLimits — quests.completed exception', () => {
  it('accepts 2001 completed ids and exactly the cap', () => {
    expect(code(() => assertStructuralLimits(completedAt(2001)))).toBe('ok');
    expect(
      code(() =>
        assertStructuralLimits(completedAt(ADDON_QUESTS_COMPLETED_MAX)),
      ),
    ).toBe('ok');
  });

  it('rejects cap + 1 completed ids', () => {
    expect(
      code(() =>
        assertStructuralLimits(completedAt(ADDON_QUESTS_COMPLETED_MAX + 1)),
      ),
    ).toBe('INVALID_PAYLOAD');
  });

  it.each([
    ['data.gear', { data: { gear: ids(ADDON_JSON_MAX_ARRAY + 1) } }],
    [
      'data.quests.inProgress',
      { data: { quests: { inProgress: ids(ADDON_JSON_MAX_ARRAY + 1) } } },
    ],
    ['a nested look-alike path', { x: completedAt(ADDON_JSON_MAX_ARRAY + 1) }],
    [
      'a dotted look-alike key',
      { data: { 'quests.completed': ids(ADDON_JSON_MAX_ARRAY + 1) } },
    ],
    [
      'a fully dotted root key',
      { 'data.quests.completed': ids(ADDON_JSON_MAX_ARRAY + 1) },
    ],
    [
      'completed inside an array',
      { data: { quests: [{ completed: ids(ADDON_JSON_MAX_ARRAY + 1) }] } },
    ],
  ])('keeps the 2000 cap on %s', (_label, json) => {
    expect(code(() => assertStructuralLimits(json))).toBe('INVALID_PAYLOAD');
  });
});

describe('parseItemLink — enchant + gems (R4)', () => {
  it('reads enchant (field 1) and gems (fields 2-5)', () => {
    expect(parseItemLink(FOREVER_ENCHANTED_LINK)).toEqual({
      itemId: 6120,
      bonusIds: [7890],
      enchantId: 1900,
      gemIds: [2000],
    });
    expect(parseItemLink('|Hitem:6120:1900:2000:::...|h')).toMatchObject({
      enchantId: 1900,
      gemIds: [2000],
    });
  });

  it('omits enchantId when the link has none, keeps the gems', () => {
    const parsed = parseItemLink(FOREVER_SOCKETED_LINK);
    expect(parsed).toEqual({
      itemId: 2105,
      bonusIds: [],
      gemIds: [3000, 3001],
    });
    expect('enchantId' in parsed).toBe(false);
  });

  it('omits both keys on a plain link or junk', () => {
    expect(parseItemLink(FIXTURE_ITEM_LINK)).toEqual({
      itemId: 19019,
      bonusIds: [6646, 7890],
    });
    expect(parseItemLink('|Hitem:5:abc:-1:x|h')).toEqual({
      itemId: 5,
      bonusIds: [],
    });
  });
});

describe('toCharSnapshotData — schema 2', () => {
  const colour = (s: string) => `|cffffd100${s}|r`;

  it('keeps quests with display strings stripped', () => {
    const quests = buildQuests(3);
    quests.inProgress[0]!.title = colour('Ferocitas');
    quests.inProgress[0]!.objectives![0]!.text = colour('Slain: 0/1');
    const data = { ...buildCharPayload().data, quests } as AddonCharData;
    const out = toCharSnapshotData(data);
    expect(out.quests?.completed).toEqual([456, 463, 470]);
    expect(out.quests?.inProgress[0]?.title).toBe('Ferocitas');
    expect(out.quests?.inProgress[0]?.objectives?.[0]?.text).toBe('Slain: 0/1');
  });

  it('omits quests when the export has none', () => {
    const out = toCharSnapshotData(buildCharPayload().data);
    expect('quests' in out).toBe(false);
  });

  it('passes named talent nodes through, name stripped', () => {
    const data = buildForeverTalentsPayload().data;
    data.talents.nodes[0]!.name = colour('Tactical Mastery');
    const node = toCharSnapshotData(data).talents.nodes[0];
    expect(node).toMatchObject({ name: 'Tactical Mastery', spellId: 12295 });
    expect(node).toMatchObject({ tree: 0, row: 0, col: 1, posX: 1980 });
  });
});

describe('decodeImportString — Forever char fields', () => {
  it('passes who.gender through and stores quests at the cap', () => {
    const out = decodeImportString(
      buildImportString(buildForeverQuestsPayload()),
    );
    if (out.payload.section !== 'char') throw new Error('not char');
    expect(out.payload.who.gender).toBe('female');
    expect(out.payload.data.quests?.completed).toHaveLength(
      ADDON_QUESTS_COMPLETED_MAX,
    );
    expect(out.payload.data.gear[0]).toMatchObject({ enchantId: 1900 });
  });

  it('rejects completed over the cap and inProgress over 35', () => {
    const over = buildForeverQuestsPayload(ADDON_QUESTS_COMPLETED_MAX + 1);
    expect(code(() => decodeImportString(buildImportString(over)))).toBe(
      'INVALID_PAYLOAD',
    );
    const log = buildForeverQuestsPayload(40);
    const extra = ADDON_QUESTS_IN_PROGRESS_MAX + 1;
    log.data.quests!.inProgress = ids(extra).map((questId) => ({ questId }));
    expect(code(() => decodeImportString(buildImportString(log)))).toBe(
      'INVALID_PAYLOAD',
    );
  });
});
