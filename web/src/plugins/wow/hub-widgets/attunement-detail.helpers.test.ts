/**
 * ROK-1927 (W13) — the Attunements detail's pure helpers: tracked-only tabs
 * with faction variants merged (AC5, AC8), the done → in progress → not
 * started → no data sort, step/next-step text, the no-data reasons (AC3, AC4),
 * the below-level note (AC6) and a stale capture (§7).
 */
import { describe, it, expect } from 'vitest';
import type { WowAttunementResultDto } from '@raid-ledger/contract';
import {
    buildAttunementDef, buildAttunementMember, daysAgo, sampleAttunementDefs,
} from '../../../test/factories/forever-attunements';
import { attunementRows, attunementTabs, belowLevelNote } from './attunement-detail.helpers';

function result(key: string, overrides: Partial<WowAttunementResultDto> = {}): WowAttunementResultDto {
    return { key, state: 'not_started', noDataReason: null, stepsDone: 0, nextStep: 'Step one', belowLevel: false, ...overrides };
}

const ONY_STEPS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'];

function onyTab() {
    const defs = [
        buildAttunementDef('ony-horde', { groupKey: 'onyxia', instance: "Onyxia's Lair", faction: 'horde', steps: ONY_STEPS }),
        buildAttunementDef('ony-alliance', { groupKey: 'onyxia', instance: "Onyxia's Lair", faction: 'alliance', steps: ['a1', 'a2'] }),
    ];
    const tab = attunementTabs(defs)[0];
    if (tab === undefined) throw new Error('expected an Onyxia tab');
    return tab;
}

describe('attunementTabs', () => {
    it('gives one tab per tracked group and none to an untracked attunement', () => {
        const tabs = attunementTabs(sampleAttunementDefs());
        expect(tabs.map((t) => [t.groupKey, t.instance])).toEqual([
            ['mc', 'Molten Core'], ['onyxia', "Onyxia's Lair"], ['bwl', 'Blackwing Lair'],
        ]);
        expect([...(tabs[1]?.defs.keys() ?? [])]).toEqual(['ony-horde', 'ony-alliance']);
    });
});

describe('attunementRows', () => {
    it('sorts done, in progress, not started, no data, then by name, across faction variants', () => {
        const members = [
            buildAttunementMember({ rowKey: 'z', name: 'Zinny', characterId: null, results: [result('ony-horde', { state: 'no_data', noDataReason: 'not_claimed', nextStep: null })] }),
            buildAttunementMember({ rowKey: 'm', name: 'Mogrash', results: [result('ony-horde')] }),
            buildAttunementMember({ rowKey: 'v', name: 'Velisha', results: [result('ony-alliance', { state: 'in_progress', stepsDone: 1, nextStep: 'a2' })] }),
            buildAttunementMember({ rowKey: 'b', name: 'Brakkor', results: [result('ony-horde', { state: 'done', stepsDone: 7, nextStep: null })] }),
            buildAttunementMember({ rowKey: 'x', name: 'Other', results: [result('bwl', { state: 'done' })] }),
        ];
        const rows = attunementRows(onyTab(), members);
        expect(rows.map((r) => r.name)).toEqual(['Brakkor', 'Velisha', 'Mogrash', 'Zinny']);
        expect(rows.map((r) => r.steps)).toEqual(['7/7', '1/2', '0/7', '—']);
        expect(rows.map((r) => r.label)).toEqual(['Attuned', 'In progress', 'Not started', 'No data']);
        expect(rows.map((r) => r.tone)).toEqual(['success', 'warning', 'neutral', 'neutral']);
        expect(rows.map((r) => r.next)).toEqual(['—', 'a2', 'Step one', 'Not claimed']);
    });

    it('titles a no-data chip with its reason, never a colour alone', () => {
        const members = [
            buildAttunementMember({ rowKey: 'a', name: 'A', results: [result('ony-horde', { state: 'no_data', noDataReason: 'no_quest_data', nextStep: null })] }),
            buildAttunementMember({ rowKey: 'b', name: 'B', results: [result('ony-horde', { state: 'no_data', noDataReason: 'truncated', nextStep: null })] }),
            buildAttunementMember({ rowKey: 'c', name: 'C', characterId: null, results: [result('ony-horde', { state: 'no_data', noDataReason: 'not_claimed', nextStep: null })] }),
        ];
        expect(attunementRows(onyTab(), members).map((r) => r.title)).toEqual([
            'No quest data shared', 'Quest list too long to read', 'Not claimed by a member',
        ]);
    });

    it('marks a quest-log-only start, the below-level note and a stale capture', () => {
        const now = Date.now();
        const members = [
            buildAttunementMember({ rowKey: 't', name: 'Thundrel', results: [result('ony-horde', { state: 'in_progress', nextStep: 'For The Horde!' })] }),
            buildAttunementMember({ rowKey: 'm', name: 'Mogrash', level: 52, asOf: daysAgo(20), results: [result('ony-horde', { belowLevel: true })] }),
        ];
        const [thundrel, mogrash] = attunementRows(onyTab(), members, now);
        // In progress with nothing done: the api's nextStep is the logged step (Codex P2).
        expect(thundrel?.next).toBe('For The Horde! (in quest log)');
        expect(thundrel?.levelNote).toBeNull();
        expect(thundrel?.stale).toBe(false);
        expect(mogrash?.levelNote).toBe('Level 52 — below the required level');
        expect(mogrash?.stale).toBe(true);
        expect(mogrash?.asOf).toMatch(/^as of 20 days ago$/);
    });

    it('says which level the chain needs when the api sends requiredLevel (ROK-1927 P5-web)', () => {
        const members = [
            buildAttunementMember({ rowKey: 'm', name: 'Mogrash', level: 52, results: [result('ony-horde', { belowLevel: true, requiredLevel: 55 })] }),
        ];
        expect(attunementRows(onyTab(), members)[0]?.levelNote).toBe('Level 52 — needs 55');
    });
});

describe('the "(in quest log)" annotation (Codex P2)', () => {
    it('marks a log-only start only on a one-step chain, where the logged quest IS the next step', () => {
        const tab = attunementTabs([buildAttunementDef('mc-horde', { groupKey: 'mc' })])[0];
        if (tab === undefined) throw new Error('expected a Molten Core tab');
        const members = [
            buildAttunementMember({ rowKey: 't', name: 'Thundrel', results: [result('mc-horde', { state: 'in_progress', nextStep: 'Attunement to the Core' })] }),
        ];
        expect(attunementRows(tab, members)[0]?.next).toBe('Attunement to the Core (in quest log)');
    });

    it('marks the logged step of a 7-step chain, which the api sends as nextStep', () => {
        const members = [
            buildAttunementMember({ rowKey: 't', name: 'Thundrel', results: [result('ony-horde', { state: 'in_progress', stepsDone: 0, nextStep: 's3' })] }),
        ];
        expect(attunementRows(onyTab(), members)[0]?.next, 'a log-only start in a 7-step chain names the logged step').toBe('s3 (in quest log)');
    });

    it('makes no quest-log claim once a step is done', () => {
        const members = [
            buildAttunementMember({ rowKey: 't', name: 'Thundrel', results: [result('ony-horde', { state: 'in_progress', stepsDone: 2, nextStep: 's3' })] }),
        ];
        expect(attunementRows(onyTab(), members)[0]?.next).toBe('s3');
    });
});

describe('belowLevelNote', () => {
    it('names the level and the gate, falls back without a gate, and drops the level when unknown', () => {
        expect(belowLevelNote(52, 55)).toBe('Level 52 — needs 55');
        expect(belowLevelNote(52, null)).toBe('Level 52 — below the required level');
        expect(belowLevelNote(null, 55)).toBe('Needs level 55');
        expect(belowLevelNote(null, null)).toBeNull();
    });
});
