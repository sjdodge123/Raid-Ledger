import { describe, expect, it } from 'vitest';
import type {
    GameServerCalendarItemDto,
    GameServerMarkerItemDto,
    GameServerStatusDto,
    GameServerWindowItemDto,
} from '@raid-ledger/contract';
import { GameServerEffectSchema, GameServerStateSchema } from '@raid-ledger/contract';
import {
    EFFECT_LABELS,
    NOT_CHECKED_LINE,
    STATE_LABELS,
    formatLocalTime,
    isServerItemVisible,
    liveLine,
    markerTitle,
    toPelicanLayerItems,
} from './pelican-calendar-items.helpers';

const base = { serverKey: 'srv-1', serverName: 'Valheim Dedicated', gameId: 7, provider: 'pelican' };
const windowItem: GameServerWindowItemDto = {
    kind: 'window', ...base, start: '2026-10-14T22:00:00Z', end: '2026-10-15T06:00:00Z', label: 'up', source: 'schedule',
};
const markerItem: GameServerMarkerItemDto = {
    kind: 'marker', ...base, at: '2026-10-15T08:05:00Z', effect: 'restart', label: 'Nightly restart',
};
const NOW = Date.parse('2026-10-15T09:00:00Z');
const status = (over: Partial<GameServerStatusDto> = {}): GameServerStatusDto => ({
    ...base, state: 'running', checkedAt: '2026-10-15T08:58:00Z', ...over,
});
const slugs = new Map([[7, 'valheim']]);

function run(items: GameServerCalendarItemDto[], selectedGames?: ReadonlySet<string>, statuses = [status()]) {
    return toPelicanLayerItems({ items, statuses, slugById: slugs, selectedGames, tz: 'UTC', now: NOW });
}

describe('liveLine', () => {
    it('reads "Online · checked 2 min ago" for a running server checked 2 minutes ago', () => {
        expect(liveLine(status(), NOW)).toBe('Online · checked 2 min ago');
    });
    it('reads "just now" under one minute (59s)', () => {
        expect(liveLine(status({ checkedAt: '2026-10-15T08:59:01Z' }), NOW)).toBe('Online · checked just now');
    });
    it('reads "Status not checked yet" without a status row', () => {
        expect(liveLine(undefined, NOW)).toBe(NOT_CHECKED_LINE);
        expect(NOT_CHECKED_LINE).toBe('Status not checked yet');
    });
    it('uses the state label for non-running states', () => {
        expect(liveLine(status({ state: 'offline' }), NOW)).toBe('Offline · checked 2 min ago');
    });
});

describe('labels (spec Q6)', () => {
    it('has a label for every GameServerEffect; mixed → "Scheduled task"', () => {
        for (const effect of GameServerEffectSchema.options) expect(EFFECT_LABELS[effect]).toMatch(/\S/);
        expect(EFFECT_LABELS.mixed).toBe('Scheduled task');
    });
    it('has a label for every GameServerState; running → "Online"', () => {
        for (const state of GameServerStateSchema.options) expect(STATE_LABELS[state]).toMatch(/\S/);
        expect(STATE_LABELS.running).toBe('Online');
    });
});

describe('markerTitle / formatLocalTime', () => {
    it('formats in UTC', () => {
        expect(markerTitle(markerItem, 'UTC')).toBe('Restart · Valheim Dedicated · 8:05 AM');
    });
    it('formats in America/New_York (EDT, UTC-4)', () => {
        expect(markerTitle(markerItem, 'America/New_York')).toBe('Restart · Valheim Dedicated · 4:05 AM');
    });
    it('uses a plain space before AM/PM (smoke regex)', () => {
        expect(formatLocalTime('2026-10-14T22:00:00Z', 'UTC')).toMatch(/^\d{1,2}:\d{2} [AP]M$/);
    });
});

describe('isServerItemVisible (game filter, spec Q5)', () => {
    it('shows everything when no filter is set', () => {
        expect(isServerItemVisible(999, slugs, undefined)).toBe(true);
    });
    it('shows a selected game and hides a deselected one', () => {
        expect(isServerItemVisible(7, slugs, new Set(['valheim']))).toBe(true);
        expect(isServerItemVisible(7, slugs, new Set(['wow']))).toBe(false);
    });
    it('hides a game missing from the registry while a filter is active', () => {
        expect(isServerItemVisible(999, slugs, new Set(['valheim']))).toBe(false);
    });
});

describe('toPelicanLayerItems', () => {
    it('maps a window to a host window with the band label and an aria sentence', () => {
        expect(run([windowItem])).toEqual([{
            kind: 'window', id: 'pelican\u0000srv-1:w:2026-10-14T22:00:00Z',
            start: windowItem.start, end: windowItem.end,
            label: 'Server up · Valheim Dedicated',
            ariaLabel: 'Server up · Valheim Dedicated, 10:00 PM to 6:00 AM',
        }]);
    });
    it('maps a marker with its title and the joined live state', () => {
        const [m] = run([markerItem]);
        expect(m).toMatchObject({
            kind: 'marker', at: markerItem.at, glyph: 'power',
            tip: { title: 'Restart · Valheim Dedicated · 8:05 AM', detail: 'Online · checked 2 min ago' },
        });
    });
    it('joins status on provider + serverKey, not serverKey alone', () => {
        const other = status({ provider: 'other', state: 'offline' });
        const [m] = run([markerItem], undefined, [other]);
        expect(m?.kind === 'marker' ? m.tip.detail : '').toBe(NOT_CHECKED_LINE);
    });
    it('drops items whose game is deselected', () => {
        expect(run([windowItem, markerItem], new Set(['wow']))).toEqual([]);
        expect(run([windowItem, markerItem], new Set(['valheim']))).toHaveLength(2);
    });
});
