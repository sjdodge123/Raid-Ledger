/**
 * ROK-2192 (operator ruling 2026-11-13) — the linked guild's rank-0 member
 * (`viewer.isGuildMaster`, the GUID-linked GM) always opens hub settings and
 * writes the GM-allowed rows; everyone else keeps the ROK-1830 rule.
 */
import { describe, it, expect } from 'vitest';
import type { GuildPage } from '@raid-ledger/contract';
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

describe('canOpenHubSettings — rank-0 GM (ROK-2192)', () => {
    it.each([
        ['the rank-0 GM', GM, true],
        ['a rank-1 member', RANK_1, false],
        ['a non-member', NON_MEMBER, false],
        ['a delegated officer', OFFICER, false],
        ['the Leader / staff', LEADER, true],
    ] as const)('%s', (_label, viewer, expected) => {
        expect(canOpenHubSettings(wowPage(viewer)), `${_label} opens hub settings`).toBe(expected);
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
