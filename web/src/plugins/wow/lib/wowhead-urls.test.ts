import { describe, it, expect } from 'vitest';
import {
    getWowheadQuestUrl,
    getWowheadItemUrl,
    getWowheadDataSuffix,
    getWowheadNpcSearchUrl,
} from './wowhead-urls';

describe('wowhead-urls', () => {
    describe('getWowheadQuestUrl', () => {
        it('returns www.wowhead.com for retail variant', () => {
            expect(getWowheadQuestUrl(100, 'retail')).toBe('https://www.wowhead.com/quest=100');
        });

        it('returns tbc domain for classic_anniversary variant', () => {
            expect(getWowheadQuestUrl(100, 'classic_anniversary')).toBe('https://www.wowhead.com/tbc/quest=100');
        });

        it('returns classic domain for classic_era variant', () => {
            expect(getWowheadQuestUrl(100, 'classic_era')).toBe('https://www.wowhead.com/classic/quest=100');
        });

        it('returns classic domain for classic variant', () => {
            expect(getWowheadQuestUrl(100, 'classic')).toBe('https://www.wowhead.com/classic/quest=100');
        });

        // P1: apiNamespacePrefix support
        it('returns tbc domain for classicann prefix', () => {
            expect(getWowheadQuestUrl(100, 'classicann')).toBe('https://www.wowhead.com/tbc/quest=100');
        });

        it('returns classic domain for classic1x prefix', () => {
            expect(getWowheadQuestUrl(100, 'classic1x')).toBe('https://www.wowhead.com/classic/quest=100');
        });

        it('returns www domain for null prefix (retail)', () => {
            expect(getWowheadQuestUrl(100, null)).toBe('https://www.wowhead.com/quest=100');
            expect(getWowheadQuestUrl(100, undefined)).toBe('https://www.wowhead.com/quest=100');
        });
    });

    describe('getWowheadItemUrl', () => {
        it('returns correct domain for classicann prefix', () => {
            expect(getWowheadItemUrl(42, 'classicann')).toBe('https://www.wowhead.com/tbc/item=42');
        });

        it('returns correct domain for classic1x prefix', () => {
            expect(getWowheadItemUrl(42, 'classic1x')).toBe('https://www.wowhead.com/classic/item=42');
        });
    });

    describe('getWowheadDataSuffix', () => {
        it('returns tbc domain for classicann prefix', () => {
            expect(getWowheadDataSuffix('classicann')).toBe('domain=tbc');
        });

        it('returns classic domain for classic1x prefix', () => {
            expect(getWowheadDataSuffix('classic1x')).toBe('domain=classic&dataEnv=1');
        });
    });

    describe('getWowheadNpcSearchUrl', () => {
        it('returns correct domain for classicann prefix', () => {
            expect(getWowheadNpcSearchUrl('Onyxia', 'classicann')).toBe(
                'https://www.wowhead.com/tbc/search?q=Onyxia',
            );
        });

        it('returns correct domain for classic1x prefix', () => {
            expect(getWowheadNpcSearchUrl('Ragnaros', 'classic1x')).toBe(
                'https://www.wowhead.com/classic/search?q=Ragnaros',
            );
        });
    });
});
