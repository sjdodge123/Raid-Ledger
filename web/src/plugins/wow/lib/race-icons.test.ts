import { describe, expect, it } from 'vitest';
import { getRaceIconUrl } from './race-icons';

const BASE = 'https://wow.zamimg.com/images/wow/icons/large';

describe('getRaceIconUrl (ROK-1747)', () => {
    it('maps Armory display names and addon tokens to the same icon', () => {
        expect(getRaceIconUrl('Night Elf', 'female')).toBe(`${BASE}/race_nightelf_female.jpg`);
        expect(getRaceIconUrl('NightElf', 'female')).toBe(`${BASE}/race_nightelf_female.jpg`);
        expect(getRaceIconUrl('Blood Elf', 'male')).toBe(`${BASE}/race_bloodelf_male.jpg`);
        expect(getRaceIconUrl('blood_elf', 'male')).toBe(`${BASE}/race_bloodelf_male.jpg`);
        expect(getRaceIconUrl('Human', 'male')).toBe(`${BASE}/race_human_male.jpg`);
    });

    it('maps both Undead and Scourge to the scourge game-file token', () => {
        expect(getRaceIconUrl('Undead', 'male')).toBe(`${BASE}/race_scourge_male.jpg`);
        expect(getRaceIconUrl('Scourge', 'female')).toBe(`${BASE}/race_scourge_female.jpg`);
    });

    it('covers every Classic race', () => {
        for (const race of ['Human', 'Dwarf', 'Gnome', 'Draenei', 'Orc', 'Tauren', 'Troll']) {
            expect(getRaceIconUrl(race, 'female')).toBe(`${BASE}/race_${race.toLowerCase()}_female.jpg`);
        }
    });

    it('accepts gender case-insensitively', () => {
        expect(getRaceIconUrl('Orc', 'Female')).toBe(`${BASE}/race_orc_female.jpg`);
        expect(getRaceIconUrl('Orc', 'MALE')).toBe(`${BASE}/race_orc_male.jpg`);
    });

    it('returns null for an unmapped or missing race', () => {
        expect(getRaceIconUrl('Skyborne', 'female')).toBeNull();
        expect(getRaceIconUrl('Goblin', 'male')).toBeNull();
        expect(getRaceIconUrl('', 'male')).toBeNull();
        expect(getRaceIconUrl(null, 'male')).toBeNull();
    });

    it('returns null for a missing or unknown gender', () => {
        expect(getRaceIconUrl('Human', null)).toBeNull();
        expect(getRaceIconUrl('Human', undefined)).toBeNull();
        expect(getRaceIconUrl('Human', 'other')).toBeNull();
    });
});
