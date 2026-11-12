/**
 * ROK-1927 — WoW: Forever attunement fixtures (roster-insights `attunements`
 * section). The default is the spec §9 mockup sample: a 30-member Horde-heavy
 * roster with Molten Core 12/30 (6 in progress), Onyxia's Lair 5/30 (9),
 * Blackwing Lair 2/30 (4), and Naxxramas untracked. Molten Core and Onyxia
 * are split into faction variants so grouping is exercised by default.
 */
import type {
    WowCharacterAttunementDto, WowRosterAttunementDto, WowRosterAttunementMemberDto, WowRosterAttunementsDto,
} from '@raid-ledger/contract';

type Counts = WowRosterAttunementDto['counts'];

function counts(done: number, inProgress: number, notStarted: number, noData = 0): Counts {
    return { done, inProgress, notStarted, noData };
}

/** One attunement definition; `key` doubles as `groupKey` unless given. */
export function buildAttunementDef(
    key: string, overrides: Partial<WowRosterAttunementDto> = {},
): WowRosterAttunementDto {
    return {
        key, groupKey: key, instance: 'Molten Core', faction: 'both', trackable: true,
        untrackedReason: null, steps: ['Attunement to the Core'], counts: counts(0, 0, 0), ...overrides,
    };
}

/** One roster member with addon quest data captured two days ago. */
export function buildAttunementMember(
    overrides: Partial<WowRosterAttunementMemberDto> = {},
): WowRosterAttunementMemberDto {
    return {
        rowKey: '00000000-0000-4000-8000-000000000001', name: 'Brakkor',
        characterId: '00000000-0000-4000-8000-000000000001', cls: 'warrior', level: 60,
        asOf: daysAgo(2), source: 'addon', results: [], ...overrides,
    };
}

/** An ISO timestamp `days` days before now. */
export function daysAgo(days: number): string {
    return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** The mockup F1 definitions (faction variants split). */
export function sampleAttunementDefs(): WowRosterAttunementDto[] {
    return [
        buildAttunementDef('mc-horde', { groupKey: 'mc', faction: 'horde', counts: counts(8, 4, 6) }),
        buildAttunementDef('mc-alliance', { groupKey: 'mc', faction: 'alliance', counts: counts(4, 2, 6) }),
        buildAttunementDef('ony-horde', { groupKey: 'onyxia', instance: "Onyxia's Lair", faction: 'horde', counts: counts(4, 6, 8) }),
        buildAttunementDef('ony-alliance', { groupKey: 'onyxia', instance: "Onyxia's Lair", faction: 'alliance', counts: counts(1, 3, 8) }),
        buildAttunementDef('bwl', { instance: 'Blackwing Lair', counts: counts(2, 4, 24) }),
        buildAttunementDef('naxx', {
            instance: 'Naxxramas', trackable: false, untrackedReason: 'needs reputation data',
            steps: ['Honored with the Argent Dawn'],
        }),
    ];
}

/** The full `attunements` section (mockup F1), freshest data two days old. */
export function buildAttunementsSection(overrides: Partial<WowRosterAttunementsDto> = {}): WowRosterAttunementsDto {
    const asOf = daysAgo(2);
    return {
        attunements: sampleAttunementDefs(),
        members: [buildAttunementMember({ asOf })],
        oldestAsOf: asOf,
        ...overrides,
    };
}

/** The own-view (§5.3) Onyxia checklist: 4 of 7 steps done, step 5 next. */
export function buildCharacterAttunement(
    overrides: Partial<WowCharacterAttunementDto> = {},
): WowCharacterAttunementDto {
    const labels = [
        "Warlord's Command", "Eitrigg's Wisdom", 'For The Horde!', 'The Champion of the Horde',
        'What the Wind Carries', 'Oculus Illusions', 'Blood of the Black Dragon Champion',
    ];
    return {
        key: 'ony-horde', groupKey: 'onyxia', instance: "Onyxia's Lair", state: 'in_progress',
        belowLevel: false, requiredLevel: null, nextStep: 'What the Wind Carries',
        steps: labels.map((label, i) => ({ label, done: i < 4 })), ...overrides,
    };
}
