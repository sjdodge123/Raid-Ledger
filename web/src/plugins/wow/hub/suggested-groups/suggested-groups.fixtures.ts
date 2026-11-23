/**
 * ROK-2212 — suggested-groups test fixtures + MSW handler (shared by the
 * widget, card and planner-section specs). Every payload is parsed through the
 * real `SuggestedGroupsSchema`, so a fixture that drifts from the wire fails.
 */
import { http, HttpResponse } from 'msw';
import {
    SuggestedGroupsSchema, type SuggestedGroupDto, type SuggestedGroupMemberDto, type SuggestedGroupsDto,
} from '@raid-ledger/contract';

export const SG_UUID_TANK = '11111111-1111-4111-8111-111111111111';
export const SG_UUID_HEAL = '22222222-2222-4222-8222-222222222222';
export const SG_UUID_DPS = '33333333-3333-4333-8333-333333333333';

type Role = SuggestedGroupMemberDto['role'];

/** A claimed member (key = characterId). */
export function claimed(characterId: string, name: string, role: Role, level: number, userId: number | null): SuggestedGroupMemberDto {
    return { key: characterId, characterId, memberId: null, userId, name, class: 'Warrior', level, role };
}

/** An unclaimed roster row (key = `m<memberId>`, no owner). */
export function unclaimed(memberId: number, name: string, role: Role, level: number): SuggestedGroupMemberDto {
    return { key: `m${memberId}`, characterId: null, memberId, userId: null, name, class: 'Mage', level, role };
}

/** A group in one dungeon: 3 claimed (users 1–3) + 2 unclaimed roster rows. */
export function group(id: number, name: string, overrides: Partial<SuggestedGroupDto> = {}): SuggestedGroupDto {
    return {
        instance: { id, name, minimumLevel: 18, maximumLevel: 28 },
        members: [
            claimed(SG_UUID_TANK, 'Tankard', 'tank', 22, 1),
            claimed(SG_UUID_HEAL, 'Mendy', 'healer', 23, 2),
            claimed(SG_UUID_DPS, 'Stabby', 'dps', 24, 3),
            unclaimed(41, 'Frosty', 'dps', 21),
            unclaimed(42, 'Pyro', 'dps', 25),
        ],
        levelSpread: 4,
        sharedQuests: 2,
        ...overrides,
    };
}

/** Three groups in three dungeons + pool counts. */
export const SUGGESTED_GROUPS_FIXTURE: SuggestedGroupsDto = SuggestedGroupsSchema.parse({
    groups: [group(101, 'Shadowfang Keep'), group(102, 'Blackfathom Deeps', { sharedQuests: null }), group(103, 'The Stockade')],
    pool: { tank: 2, healer: 3, dps: 9, unclaimed: 4, skippedNoRole: 1, skippedNoLevel: 2 },
    generatedAt: '2026-11-17T12:00:00.000Z',
});

/** The fixture as a visitor receives it: every owner masked. */
export function visitorFixture(): SuggestedGroupsDto {
    return SuggestedGroupsSchema.parse({
        ...SUGGESTED_GROUPS_FIXTURE,
        groups: SUGGESTED_GROUPS_FIXTURE.groups.map((g) => ({ ...g, members: g.members.map((m) => ({ ...m, userId: null })) })),
    });
}

export const SUGGESTED_GROUPS_URL = 'http://localhost:3000/plugins/wow/guilds/:id/suggested-groups';

/** MSW handler answering every scope with `body`. */
export function suggestedGroupsHandler(body: SuggestedGroupsDto = SUGGESTED_GROUPS_FIXTURE): ReturnType<typeof http.get> {
    return http.get(SUGGESTED_GROUPS_URL, () => HttpResponse.json(body));
}
