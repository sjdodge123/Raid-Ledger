/**
 * ROK-1595 L2 — the pure read-rule mapping: mode ↔ K2 switches (F-2: both
 * off = read off for the connection), the writes a choice needs, the picker's
 * checked set and its hidden dedicated calendar, and the status line.
 */
import { describe, it, expect } from 'vitest';
import { providerCalendarsFixture, readConnectionFixture } from '../../../test/mocks/calendar-sync-handlers';
import { checkedIds, enabledTargets, modeOf, pickable, readChangeFor, readGranted, readableConnections, switchesOf } from './use-read-rules';
import { readStatusLine } from './calendar-sync.copy';
import { syncedAgo } from '../../../lib/synced-ago';

describe('switchesOf / modeOf', () => {
    it.each([
        ['both', { days: true, hours: true }],
        ['days', { days: true, hours: false }],
        ['hours', { days: false, hours: true }],
    ] as const)('mode %s with read on → %o, and back', (mode, switches) => {
        expect(switchesOf(mode, true)).toEqual(switches);
        expect(modeOf(switches)).toBe(mode);
    });

    it('read off on the connection shows both switches off whatever the mode', () => {
        expect(switchesOf('both', false)).toEqual({ days: false, hours: false });
    });

    it('F-2: both switches off means reading off (null), not a mode', () => {
        expect(modeOf({ days: false, hours: false })).toBeNull();
    });
});

describe('readChangeFor', () => {
    it('F-2: turning the last switch off PATCHes enabled:false and leaves the mode alone', () => {
        expect(readChangeFor(null, 'days', true)).toEqual({ enabled: false });
    });
    it('a mode change while reading is on is a PUT only', () => {
        expect(readChangeFor('hours', 'both', true)).toEqual({ mode: 'hours' });
    });
    it('turning a switch on while reading is off PATCHes enabled:true, then PUTs the new mode', () => {
        expect(readChangeFor('days', 'both', false)).toEqual({ enabled: true, mode: 'days' });
    });
    it('turning reading on in the stored mode needs no PUT', () => {
        expect(readChangeFor('both', 'both', false)).toEqual({ enabled: true });
    });
    it('nothing to do when off stays off', () => {
        expect(readChangeFor(null, 'both', false)).toEqual({});
    });
});

describe('picker helpers', () => {
    it('hides the dedicated Raid Ledger calendar', () => {
        expect(pickable(providerCalendarsFixture).map((c) => c.name)).toEqual(['raider@example.com', 'Work']);
    });
    it('empty calendarIds → the primary calendar is the checked one', () => {
        expect(checkedIds([], providerCalendarsFixture)).toEqual(['primary']);
    });
    it('a stored list is used as is', () => {
        expect(checkedIds(['work@group.calendar.google.com'], providerCalendarsFixture)).toEqual(['work@group.calendar.google.com']);
    });
});

describe('readGranted / status line', () => {
    it('readAccess missing or errorCode read_scopes → not granted', () => {
        expect(readGranted({ readAccess: 'missing', errorCode: null })).toBe(false);
        expect(readGranted({ readAccess: 'granted', errorCode: 'read_scopes' })).toBe(false);
        expect(readGranted({ readAccess: 'granted', errorCode: null })).toBe(true);
    });

    const now = Date.parse('2026-10-12T09:04:30.000Z');
    it('phone: "Synced 4 min ago · 1 calendar" (empty ids count as primary)', () => {
        expect(readStatusLine(readConnectionFixture, false, now)).toBe('Synced 4 min ago · 1 calendar');
    });
    it('desktop drops the count (K4)', () => {
        expect(readStatusLine(readConnectionFixture, true, now)).toBe('Synced 4 min ago');
    });
    it('needs_reconnect → the reconnect line', () => {
        expect(readStatusLine({ ...readConnectionFixture, status: 'needs_reconnect' }, false, now)).toBe('Access was revoked · reconnect');
    });
    it('never synced → the ROK-1594 "Connected · <email>" line', () => {
        expect(readStatusLine({ ...readConnectionFixture, lastSyncedAt: null }, false, now)).toBe('Connected · raider@example.com');
    });
    it('syncedAgo buckets', () => {
        const at = '2026-10-12T09:00:00.000Z';
        expect(syncedAgo(at, Date.parse(at) + 20_000)).toBe('just now');
        expect(syncedAgo(at, Date.parse(at) + 3 * 3_600_000)).toBe('3 h ago');
        expect(syncedAgo(at, Date.parse(at) + 26 * 3_600_000)).toBe('1 day ago');
    });
});

describe('readableConnections / enabledTargets (review r2: the mode spans every account)', () => {
    const off = { ...readConnectionFixture, id: 2, read: { enabled: false, calendarIds: [] } };
    const writeOnly = { ...readConnectionFixture, id: 3, readAccess: 'missing' as const };
    const leaving = { ...readConnectionFixture, id: 4, status: 'disconnecting' as const };
    const broken = { ...readConnectionFixture, id: 5, status: 'needs_reconnect' as const };
    it('keeps every account that can read, broken ones included; drops write-only and disconnecting', () => {
        const ids = readableConnections([readConnectionFixture, off, writeOnly, leaving, broken]).map((c) => c.id);
        expect(ids).toEqual([readConnectionFixture.id, 2, 5]);
    });
    it('on/off touches only the accounts not already there', () => {
        expect(enabledTargets([readConnectionFixture, off], false).map((c) => c.id)).toEqual([readConnectionFixture.id]);
        expect(enabledTargets([readConnectionFixture, off], true).map((c) => c.id)).toEqual([2]);
    });
});
