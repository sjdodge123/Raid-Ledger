/** Pure helpers for the Pelican Servers section (ROK-1094). */
import { describe, it, expect } from 'vitest';
import { PELICAN_SYNC_CODES, type GameServerState, type PelicanSyncResult } from '@raid-ledger/contract';
import { pelicanServerFixture } from '../../../test/mocks/pelican-handlers';
import { applyServerPatch, stateChipView, syncToast, type ChipTone } from './pelican-servers.helpers';

describe('stateChipView', () => {
    const cases: [GameServerState, ChipTone, string][] = [
        ['running', 'success', 'Running'],
        ['starting', 'warning', 'Starting'],
        ['stopping', 'warning', 'Stopping'],
        ['offline', 'danger', 'Offline'],
        ['unknown', 'neutral', 'Unknown'],
    ];
    it.each(cases)('%s → %s tone, label %s, with a title', (state, tone, label) => {
        const view = stateChipView({ state, isSuspended: false });
        expect(view).toMatchObject({ tone, label });
        expect(view.title).not.toBe('');
    });

    it('a suspended server reads Suspended (danger) even though its member state is offline', () => {
        expect(stateChipView({ state: 'offline', isSuspended: true })).toMatchObject({ tone: 'danger', label: 'Suspended' });
        // A stale suspended row (>6 min, `unknown`) shows Unknown — what members see.
        expect(stateChipView({ state: 'unknown', isSuspended: true })).toMatchObject({ tone: 'neutral', label: 'Unknown' });
    });
});

const result = (over: Partial<PelicanSyncResult>): PelicanSyncResult => ({
    code: 'ok', message: 'msg', upserted: 0, markedMissing: 0, restored: 0, status: null, ...over,
});

describe('syncToast', () => {
    it('ok is a success summary with the counts', () => {
        expect(syncToast(result({ upserted: 3, markedMissing: 1, restored: 2 })))
            .toEqual({ tone: 'success', text: 'Synced 3 servers (1 missing from panel, 2 back)' });
        expect(syncToast(result({ upserted: 1 }))).toEqual({ tone: 'success', text: 'Synced 1 server' });
    });

    it('in_progress is info and carries the server message', () => {
        expect(syncToast(result({ code: 'in_progress', message: 'A sync is already running.' })))
            .toEqual({ tone: 'info', text: 'A sync is already running.' });
    });

    it.each(PELICAN_SYNC_CODES.filter((c) => c !== 'ok' && c !== 'in_progress'))('%s is an error toast', (code) => {
        expect(syncToast(result({ code, message: `failed: ${code}` }))).toEqual({ tone: 'error', text: `failed: ${code}` });
    });
});

describe('applyServerPatch', () => {
    it('changes only the patched field', () => {
        expect(applyServerPatch(pelicanServerFixture, { showOnCalendar: false }))
            .toEqual({ ...pelicanServerFixture, showOnCalendar: false });
    });

    it('a game change takes the picked name; clearing it clears the name', () => {
        expect(applyServerPatch(pelicanServerFixture, { gameId: 9 }, 'Rust')).toMatchObject({ gameId: 9, gameName: 'Rust' });
        expect(applyServerPatch(pelicanServerFixture, { gameId: null })).toMatchObject({ gameId: null, gameName: null });
    });
});
