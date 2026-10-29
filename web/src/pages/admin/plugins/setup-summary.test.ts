import { describe, it, expect } from 'vitest';
import type { PluginSetupRequirement, PluginSetupStatus } from '@raid-ledger/contract';
import { setupRowState, summarizeSetup } from './setup-summary';

function req(id: string, required: boolean, check?: string): PluginSetupRequirement {
    const base: PluginSetupRequirement = { id, kind: 'other', title: id, instructions: '1. Do it.', required };
    return check ? { ...base, check } : base;
}

describe('setupRowState', () => {
    it('met → Done (success)', () => {
        expect(setupRowState(req('a', true, 'x.y'), { id: 'a', state: 'met' })).toEqual({ label: 'Done', tone: 'success' });
    });
    it('unmet required → To do (warning)', () => {
        expect(setupRowState(req('a', true, 'x.y'), { id: 'a', state: 'unmet' })).toEqual({ label: 'To do', tone: 'warning' });
    });
    it('unmet optional → neutral, never a warning', () => {
        expect(setupRowState(req('a', false, 'x.y'), { id: 'a', state: 'unmet' }).tone).toBe('neutral');
    });
    it('no check → neutral "Manual step"', () => {
        expect(setupRowState(req('a', true), { id: 'a', state: 'unknown' })).toEqual({ label: 'Manual step', tone: 'neutral' });
    });
    it('a check that has not run (or no status at all) → neutral "Not checked"', () => {
        expect(setupRowState(req('a', true, 'x.y'), { id: 'a', state: 'unknown' })).toEqual({ label: 'Not checked', tone: 'neutral' });
        expect(setupRowState(req('a', true, 'x.y'), undefined)).toEqual({ label: 'Not checked', tone: 'neutral' });
    });
});

describe('summarizeSetup', () => {
    const reqs = [req('a', true, 'x.a'), req('b', true, 'x.b'), req('c', true, 'x.c'), req('d', false, 'x.d'), req('e', false)];

    it('an empty list reads "No setup needed" and stays closed', () => {
        expect(summarizeSetup([], [])).toMatchObject({ label: 'No setup needed', tone: 'success', open: false });
    });

    it('counts only required rows that are unmet — optional unmet rows never count', () => {
        const statuses: PluginSetupStatus[] = [
            { id: 'a', state: 'met' }, { id: 'b', state: 'unmet' }, { id: 'c', state: 'unmet' },
            { id: 'd', state: 'unmet' }, { id: 'e', state: 'unknown' },
        ];
        expect(summarizeSetup(reqs, statuses)).toMatchObject({
            label: '2 steps left', tone: 'warning', open: true, requiredDone: 1, requiredTotal: 3, optional: 2,
        });
    });

    it('one step left is singular', () => {
        const statuses: PluginSetupStatus[] = [{ id: 'a', state: 'met' }, { id: 'b', state: 'met' }, { id: 'c', state: 'unmet' }];
        expect(summarizeSetup(reqs, statuses).label).toBe('1 step left');
    });

    it('reads "Check setup" (neutral, open) when only unknown-with-check required rows remain', () => {
        const statuses: PluginSetupStatus[] = [{ id: 'a', state: 'met' }, { id: 'b', state: 'met' }, { id: 'c', state: 'unknown' }];
        expect(summarizeSetup(reqs, statuses)).toMatchObject({ label: 'Check setup', tone: 'neutral', open: true });
    });

    it('reads "Ready" (closed) when every required row is met', () => {
        const statuses: PluginSetupStatus[] = [{ id: 'a', state: 'met' }, { id: 'b', state: 'met' }, { id: 'c', state: 'met' }];
        expect(summarizeSetup(reqs, statuses)).toMatchObject({ label: 'Ready', tone: 'success', open: false });
    });

    it('a required manual step (no check) does not hold the plugin back from Ready', () => {
        expect(summarizeSetup([req('m', true)], [])).toMatchObject({ label: 'Ready', open: false });
    });
});
