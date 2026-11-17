/** ROK-2212 — suggested-group links (W2 / W3 / W4 helpers): one format, the planner's own. */
import { describe, it, expect } from 'vitest';
import { claimed, group, SG_UUID_DPS, SG_UUID_HEAL, SG_UUID_TANK, unclaimed } from './suggested-groups.fixtures';
import { inviteNote, plannerHref, pollMemberNames, pollMemberUserIds, scheduleHref } from './suggested-groups-links';

const PAGE = { guild: { id: 7, gameId: 3 } } as const;

describe('scheduleHref (W2)', () => {
    it('pre-fills the dungeon and invites only the claimed members', () => {
        expect(scheduleHref(group(101, 'Shadowfang Keep'), PAGE))
            .toBe(`/events/new?gameId=3&guildId=7&contentInstanceIds=101&inviteCharacterIds=${SG_UUID_TANK},${SG_UUID_HEAL},${SG_UUID_DPS}`);
    });

    it('drops the invite param when no member is claimed', () => {
        const g = group(101, 'SFK', {
            members: [unclaimed(1, 'A', 'tank', 20), unclaimed(2, 'B', 'healer', 20), unclaimed(3, 'C', 'dps', 20), unclaimed(4, 'D', 'dps', 20), unclaimed(5, 'E', 'dps', 20)],
        });
        expect(scheduleHref(g, PAGE))
            .toBe('/events/new?gameId=3&guildId=7&contentInstanceIds=101');
    });
});

describe('inviteNote (W2 copy)', () => {
    it.each([[5, null], [3, 'Invites 3 of 5'], [1, 'Invites 1 of 5'], [0, 'Invites no one yet']])('%i claimed → %s', (n, note) => {
        expect(inviteNote(n)).toBe(note);
    });
});

describe('plannerHref (W3)', () => {
    it('carries the dungeon and all 5 tokens in slot order, unclaimed as m<memberId>', () => {
        expect(plannerHref(group(101, 'Shadowfang Keep'), 7))
            .toBe(`/hubs/7?d=101&c=${SG_UUID_TANK},${SG_UUID_HEAL},${SG_UUID_DPS},m41,m42#dungeon-planner`);
    });
});

describe('pollMemberUserIds (W4)', () => {
    it('keeps only distinct non-null owners', () => {
        expect(pollMemberUserIds(group(101, 'SFK'))).toEqual([1, 2, 3]);
        const g = group(101, 'SFK', {
            members: [claimed(SG_UUID_TANK, 'T', 'tank', 20, 9), claimed(SG_UUID_HEAL, 'H', 'healer', 20, 9), unclaimed(3, 'C', 'dps', 20), unclaimed(4, 'D', 'dps', 20), unclaimed(5, 'E', 'dps', 20)],
        });
        expect(pollMemberUserIds(g)).toEqual([9]);
    });
});

describe('pollMemberNames (ROK-2256)', () => {
    it('names each owner once, by their first claimed character; unclaimed rows are skipped', () => {
        const g = group(101, 'SFK', {
            members: [claimed(SG_UUID_TANK, 'Tanky', 'tank', 20, 9), claimed(SG_UUID_HEAL, 'Healy', 'healer', 20, 9), claimed(SG_UUID_DPS, 'Stabby', 'dps', 20, 4), unclaimed(4, 'D', 'dps', 20), unclaimed(5, 'E', 'dps', 20)],
        });
        expect(pollMemberNames(g)).toEqual([{ id: 9, username: 'Tanky' }, { id: 4, username: 'Stabby' }]);
    });
});
