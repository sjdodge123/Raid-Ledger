/**
 * ROK-2192 (operator ruling 2026-11-13) — the linked guild's rank-0 member
 * (`viewer.isGuildMaster`, the GUID-linked GM) opens hub settings where the
 * hub module says a GM has something to write (`topRankOpensSettings`) and
 * writes the GM-allowed rows; everyone else keeps the ROK-1830 rule.
 */
import { describe, it, expect } from 'vitest';
import type { GuildPage } from '@raid-ledger/contract';
import type { HubModule } from '../../../plugins/hub-module';
import { canOpenHubSettings, canUseHubChannelPicker, canWriteHubSettings } from './settings-access';

type Viewer = GuildPage['viewer'];

function wowPage(viewer: Viewer): GuildPage {
    return {
        guild: { id: 7, gameId: 3, kind: 'wow_guild', name: 'Ye Olde Guild', region: 'us', realmSlug: null, realmName: null, faction: null, memberCount: 4, lastSnapshotAt: null, gameSlug: 'world-of-warcraft-forever' },
        importedBy: null,
        viewer,
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
}

const GM: Viewer = { role: 'member', canEdit: false, canManageEditors: false, isGuildMaster: true };
const RANK_1: Viewer = { role: 'member', canEdit: false, canManageEditors: false };
const NON_MEMBER: Viewer = { role: 'visitor', canEdit: false, canManageEditors: false };
const OFFICER: Viewer = { role: 'officer', canEdit: true, canManageEditors: false };
const LEADER: Viewer = { role: 'leader', canEdit: true, canManageEditors: true };

type TopRankHook = Pick<HubModule, 'topRankOpensSettings'>;
const GM_WRITES_HERE: TopRankHook = { topRankOpensSettings: () => true };
const GM_WRITES_NOTHING: TopRankHook = { topRankOpensSettings: () => false };
const NO_HOOK: TopRankHook = {};

describe('canOpenHubSettings — rank-0 GM (ROK-2192)', () => {
    it.each([
        ['the rank-0 GM', GM, true],
        ['a rank-1 member', RANK_1, false],
        ['a non-member', NON_MEMBER, false],
        ['a delegated officer', OFFICER, false],
        ['the Leader / staff', LEADER, true],
    ] as const)('%s, where the module lets a GM write', (_label, viewer, expected) => {
        expect(canOpenHubSettings(wowPage(viewer), GM_WRITES_HERE), `${_label} opens hub settings`).toBe(expected);
    });

    it.each([
        ['no module', undefined],
        ['a module without the hook', NO_HOOK],
        ['a module whose hook says no', GM_WRITES_NOTHING],
    ] as const)('gives the GM no settings entry with %s', (_label, mod) => {
        expect(canOpenHubSettings(wowPage(GM), mod), `GM with ${_label} must not open an empty sheet`).toBe(false);
        expect(canOpenHubSettings(wowPage(LEADER), mod), `the Leader still opens settings with ${_label}`).toBe(true);
    });

    it('hands the hook the page it is asked about', () => {
        const seen: GuildPage[] = [];
        const page = wowPage(GM);
        canOpenHubSettings(page, { topRankOpensSettings: (p) => { seen.push(p); return true; } });
        expect(seen).toEqual([page]);
    });

    it('never hands the GM the Leader-only channel picker', () => {
        expect(canUseHubChannelPicker(wowPage(GM))).toBe(false);
    });
});

describe('canWriteHubSettings (ROK-2192)', () => {
    it.each([
        ['the rank-0 GM', GM, true],
        ['an officer', OFFICER, true],
        ['a rank-1 member', RANK_1, false],
        ['a non-member', NON_MEMBER, false],
    ] as const)('%s', (_label, viewer, expected) => {
        expect(canWriteHubSettings(viewer), `${_label} writes GM-allowed settings`).toBe(expected);
    });
});
