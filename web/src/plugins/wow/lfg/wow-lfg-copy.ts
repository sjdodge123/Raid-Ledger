/**
 * ROK-2352 — copy and links for the WoW LFG group UI, in one place so the
 * tests and the Playwright spec pin the same strings.
 */
import type { LfgGroupSummaryDto } from '@raid-ledger/contract';

export const WOW_LFG_COPY = {
    heading: 'Dungeon and raid groups',
    loading: 'Loading groups…',
    anyLabel: 'Any dungeon',
    dungeons: 'Dungeons',
    raids: 'Raids',
    full: 'Full group',
    looking: (n: number): string => (n === 1 ? '1 looking' : `${n} looking`),
    rolesLegend: 'Your roles',
    rolesRequired: 'Pick at least one role',
    characterLabel: 'Character',
    noCharacter: 'No character',
    instancesLegend: 'Groups to join',
    rosterPreview: 'Roster',
    coverageHeading: 'Role coverage',
    lockInInstance: 'Dungeon or raid',
    lockInNoInstance: 'No instance (generic roster)',
    roleNotSet: 'Role not set',
} as const;

/** A group's display name: the adapter label, "Any dungeon" for `''`. */
export function wowLfgGroupLabel(group: Pick<LfgGroupSummaryDto, 'groupKey' | 'groupLabel'>): string {
    return (group.groupKey ?? '') === '' ? WOW_LFG_COPY.anyLabel : (group.groupLabel ?? group.groupKey ?? '');
}

/**
 * `/lfg/<slug>` for the Any group, `/lfg/<slug>/<encoded key>` otherwise, plus
 * `?hub=<id>` when the page came from a hub, so the hub survives the hop.
 */
export function wowLfgGroupHref(gameSlug: string, groupKey: string, hubId: number | null = null): string {
    const path = groupKey === '' ? `/lfg/${gameSlug}` : `/lfg/${gameSlug}/${encodeURIComponent(groupKey)}`;
    return hubId === null ? path : `${path}?hub=${hubId}`;
}
