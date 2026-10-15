import { describe, it, expect } from 'vitest';
import { GAME_SERVER_STATUS_STALE_MS, type GameServerState, type GameServerStatusDto } from '@raid-ledger/contract';
import { effectiveState, summarizeServerStatuses } from './game-server-status.helpers';

const NOW = Date.parse('2026-10-14T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function status(state: GameServerState, over: Partial<GameServerStatusDto> = {}): GameServerStatusDto {
    return {
        serverKey: 'k1', serverName: 'Valheim Main', gameId: 7, provider: 'pelican',
        state, checkedAt: ago(60_000), ...over,
    };
}

describe('effectiveState (ROK-1776)', () => {
    it('keeps the reported state exactly at the stale threshold', () => {
        expect(effectiveState(status('running', { checkedAt: ago(GAME_SERVER_STATUS_STALE_MS) }), NOW)).toBe('running');
    });

    it('degrades to unknown one ms past the threshold', () => {
        expect(effectiveState(status('running', { checkedAt: ago(GAME_SERVER_STATUS_STALE_MS + 1) }), NOW)).toBe('unknown');
    });
});

describe('summarizeServerStatuses (ROK-1776)', () => {
    it('returns null for no servers', () => {
        expect(summarizeServerStatuses([], NOW)).toBeNull();
    });

    const single: [GameServerState, string, string][] = [
        ['running', 'success', 'Server online'],
        ['starting', 'warning', 'Server starting'],
        ['stopping', 'warning', 'Server stopping'],
        ['offline', 'danger', 'Server offline'],
        ['unknown', 'neutral', 'Server status unknown'],
    ];

    it.each(single)('one %s server → %s "%s"', (state, tone, label) => {
        expect(summarizeServerStatuses([status(state)], NOW)).toMatchObject({ tone, label });
    });

    it('a stale running server reads as unknown', () => {
        const stale = status('running', { checkedAt: ago(GAME_SERVER_STATUS_STALE_MS + 60_000) });
        expect(summarizeServerStatuses([stale], NOW)).toMatchObject({
            tone: 'neutral', label: 'Server status unknown', title: 'Valheim Main: Unknown',
        });
    });

    it('all servers in one state → "3 servers online"', () => {
        const all = ['A', 'B', 'C'].map((n) => status('running', { serverKey: n, serverName: n }));
        expect(summarizeServerStatuses(all, NOW)).toMatchObject({ tone: 'success', label: '3 servers online' });
    });

    it('mixed → worst state with its count, and a per-server title', () => {
        const mixed = [
            status('running', { serverKey: 'a', serverName: 'Alpha' }),
            status('offline', { serverKey: 'b', serverName: 'Bravo' }),
            status('starting', { serverKey: 'c', serverName: 'Charlie' }),
        ];
        expect(summarizeServerStatuses(mixed, NOW)).toEqual({
            tone: 'danger',
            label: '1 of 3 servers offline',
            title: 'Alpha: Online, Bravo: Offline, Charlie: Starting',
            checkedAt: ago(60_000),
        });
    });

    it('ranks unknown below stopping below starting', () => {
        const pair = (a: GameServerState, b: GameServerState) =>
            summarizeServerStatuses([status(a, { serverKey: 'x' }), status(b, { serverKey: 'y' })], NOW)?.label;
        expect(pair('starting', 'stopping')).toBe('1 of 2 servers stopping');
        expect(pair('stopping', 'unknown')).toBe('1 of 2 servers unknown');
        expect(pair('unknown', 'offline')).toBe('1 of 2 servers offline');
    });

    it('reports the oldest checkedAt', () => {
        const rows = [
            status('running', { serverKey: 'a', checkedAt: ago(30_000) }),
            status('running', { serverKey: 'b', checkedAt: ago(180_000) }),
            status('running', { serverKey: 'c', checkedAt: ago(90_000) }),
        ];
        expect(summarizeServerStatuses(rows, NOW)?.checkedAt).toBe(ago(180_000));
    });
});
