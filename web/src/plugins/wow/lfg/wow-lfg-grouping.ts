/**
 * ROK-2352 — the WoW `lfg-grouping` registration (manifest behaviour
 * `wow-instance-lfg`): one LFG group per dungeon / raid on all six WoW slugs.
 * `MemberBadges` is not registered yet — `LfgMemberDto` carries no per-member
 * WoW detail on the wire (see HANDOVER L9).
 */
import type { LfgGrouping } from '../../lfg-grouping';
import { LfgHubPicker } from './lfg-hub-picker';
import { WowLfgGroupSections } from './wow-lfg-group-sections';
import { WowLfgRaiseHandFields } from './wow-lfg-raise-hand-fields';
import { WowLfgLockInFields } from './wow-lfg-lock-in-fields';

/** Mirrors `api/src/plugins/wow-common/manifest.ts::ALL_WOW_GAME_SLUGS`. */
export const WOW_LFG_GAME_SLUGS: readonly string[] = [
    'world-of-warcraft',
    'world-of-warcraft-classic',
    'world-of-warcraft-burning-crusade-classic-anniversary-edition',
    'world-of-warcraft-burning-crusade-classic',
    'world-of-warcraft-wrath-of-the-lich-king',
    'world-of-warcraft-forever',
];

export const wowLfgGrouping: LfgGrouping = {
    id: 'wow-instance-lfg',
    gameSlugs: WOW_LFG_GAME_SLUGS,
    HeaderControls: LfgHubPicker,
    GroupSections: WowLfgGroupSections,
    RaiseHandFields: WowLfgRaiseHandFields,
    LockInFields: WowLfgLockInFields,
};
