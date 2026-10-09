/**
 * ROK-1742 — additive LedgerLink v1 `char` fields: `who.gender`, named and
 * positioned talent nodes, `data.quests`. Every new key is optional (an
 * export without them still parses) and every new object stays `.strict()`.
 */
import { describe, it, expect } from 'vitest';
import {
    ADDON_QUEST_OBJECTIVES_MAX,
    ADDON_QUESTS_COMPLETED_MAX,
    ADDON_QUESTS_IN_PROGRESS_MAX,
    AddonExportSchema,
} from '../index.js';

const who = {
    guid: 'Player-1234-0ABCDEF0',
    fullName: 'Ana Forever',
    raw: { getUnitName: 'Ana Forever' },
    ruleset: 'normal',
    class: 'WARRIOR',
    race: 'NightElf',
    gender: 'male',
    level: 8,
    faction: 'Alliance',
};
const node = {
    nodeId: 105926, rank: 1, entryId: 130656, name: 'Improved Intercept', spellId: 20504,
    maxRanks: 2, tree: 0, row: 3, col: 2, posX: 6820, posY: 4530,
};
const objective = { text: '2/3 Nightsaber Fang', done: false, have: 2, need: 3 };
const quests = {
    completed: [456, 457, 458, 459],
    inProgress: [{ questId: 488, title: 'Zenn\'s Bidding', objectives: [objective] }, { questId: 489 }],
};
const charExport = {
    schema: 1,
    addonVersion: '0.2.0',
    client: { interface: 16001, build: '1.60.1.70009', locale: 'enUS', region: 1 },
    exportedAt: 1_790_000_000,
    who,
    section: 'char',
    data: { gear: [], talents: { nodes: [node] }, lockouts: [], quests },
};
type Mut = (d: typeof charExport.data) => unknown;
const withData = (f: Mut) => ({ ...charExport, data: f(structuredClone(charExport.data)) });
const ok = (v: unknown) => AddonExportSchema.safeParse(v).success;
const ids = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('ROK-1742 — new fields accepted', () => {
    it('parses an export carrying every new key unchanged', () => {
        expect(AddonExportSchema.parse(charExport)).toEqual(charExport);
    });

    it('still parses an export with none of the new keys (additive)', () => {
        const { gender: _g, ...oldWho } = who;
        const old = { ...charExport, who: oldWho, data: { gear: [], talents: { nodes: [{ nodeId: 1, rank: 1 }] }, lockouts: [] } };
        expect(ok(old)).toBe(true);
    });

    it.each(['male', 'female'])('accepts gender %s', (gender) => {
        expect(ok({ ...charExport, who: { ...who, gender } })).toBe(true);
    });

    it('accepts empty quest arrays and exactly the caps', () => {
        expect(ok(withData((d) => ({ ...d, quests: { completed: [], inProgress: [] } })))).toBe(true);
        const atCap = { completed: ids(ADDON_QUESTS_COMPLETED_MAX), inProgress: Array(ADDON_QUESTS_IN_PROGRESS_MAX).fill({ questId: 1, objectives: Array(ADDON_QUEST_OBJECTIVES_MAX).fill(objective) }) };
        expect(ok(withData((d) => ({ ...d, quests: atCap })))).toBe(true);
    });

    it('pins the ruled caps (Lead rulings 2026-10-09)', () => {
        expect([ADDON_QUESTS_COMPLETED_MAX, ADDON_QUESTS_IN_PROGRESS_MAX, ADDON_QUEST_OBJECTIVES_MAX]).toEqual([10_000, 35, 10]);
    });
});

describe('ROK-1742 — new fields rejected', () => {
    it.each(['unknown', 'Male', 2, null])('rejects gender %s', (gender) => {
        expect(ok({ ...charExport, who: { ...who, gender } })).toBe(false);
    });

    it.each([
        ['completed over the cap', (d) => ({ ...d, quests: { ...quests, completed: ids(ADDON_QUESTS_COMPLETED_MAX + 1) } })],
        ['inProgress over the cap', (d) => ({ ...d, quests: { ...quests, inProgress: Array(ADDON_QUESTS_IN_PROGRESS_MAX + 1).fill({ questId: 1 }) } })],
        ['11 objectives', (d) => ({ ...d, quests: { ...quests, inProgress: [{ questId: 1, objectives: Array(ADDON_QUEST_OBJECTIVES_MAX + 1).fill(objective) }] } })],
        ['an unknown key under quests', (d) => ({ ...d, quests: { ...quests, abandoned: [] } })],
        ['an unknown key on an in-progress quest', (d) => ({ ...d, quests: { ...quests, inProgress: [{ questId: 1, zone: 'x' }] } })],
        ['an unknown key on an objective', (d) => ({ ...d, quests: { ...quests, inProgress: [{ questId: 1, objectives: [{ ...objective, type: 'monster' }] }] } })],
        ['quests without inProgress', (d) => ({ ...d, quests: { completed: [] } })],
        ['an objective text of 129 chars', (d) => ({ ...d, quests: { ...quests, inProgress: [{ questId: 1, objectives: [{ ...objective, text: 'x'.repeat(129) }] }] } })],
        ['tree 3', (d) => ({ ...d, talents: { nodes: [{ ...node, tree: 3 }] } })],
        ['row 10', (d) => ({ ...d, talents: { nodes: [{ ...node, row: 10 }] } })],
        ['col 4', (d) => ({ ...d, talents: { nodes: [{ ...node, col: 4 }] } })],
        ['spellId 0', (d) => ({ ...d, talents: { nodes: [{ ...node, spellId: 0 }] } })],
        ['a negative posX', (d) => ({ ...d, talents: { nodes: [{ ...node, posX: -1 }] } })],
        ['a 65-char node name', (d) => ({ ...d, talents: { nodes: [{ ...node, name: 'x'.repeat(65) }] } })],
        ['an unknown talent node key', (d) => ({ ...d, talents: { nodes: [{ ...node, icon: 1 }] } })],
    ] as [string, Mut][])('rejects %s', (_case, mut) => {
        expect(ok(withData(mut))).toBe(false);
    });
});
