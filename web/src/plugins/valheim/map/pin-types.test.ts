import { describe, expect, it } from 'vitest';
import {
    PIN_CHECKED_CLASS,
    PIN_DISC_CLASS,
    pinAccessibleName,
    pinDisplayLabel,
    pinStyleFor,
} from './pin-types';

const TYPES = [
    'Bed',
    'Death',
    'Boss',
    'Shout',
    'Icon0',
    'Icon3',
    'Hildir1',
    'toString',
    'SomeMod_Pin',
];
const TOKENS = new Set([
    'foreground',
    'success',
    'danger',
    'warning',
    'surface',
]);

describe('pinStyleFor (D8)', () => {
    it('maps the known types to their icons', () => {
        expect(TYPES.slice(0, 4).map((t) => pinStyleFor(t).iconName)).toEqual([
            'home',
            'x-circle',
            'fire',
            'megaphone',
        ]);
    });

    it('falls back to the generic pin for IconN, unknown and prototype-named types', () => {
        for (const t of [
            'Icon0',
            'Icon3',
            'Hildir1',
            'toString',
            'SomeMod_Pin',
        ]) {
            expect(pinStyleFor(t)).toMatchObject({
                iconName: 'map-pin',
                typeLabel: 'Pin',
                toneClass: 'text-foreground',
            });
        }
    });

    it('uses --color-* token utilities only — no hex, rgb or palette colours', () => {
        const classes = [
            ...TYPES.map((t) => pinStyleFor(t).toneClass),
            PIN_DISC_CLASS,
            PIN_CHECKED_CLASS,
        ]
            .flatMap((c) => c.split(/\s+/))
            .filter((c) => /^(text|bg)-/.test(c));
        for (const c of classes) {
            const token = c.replace(/^(text|bg)-/, '').replace(/\/\d+$/, '');
            expect(
                TOKENS.has(token),
                `${c} is not a design token utility`,
            ).toBe(true);
        }
    });
});

describe('pinDisplayLabel', () => {
    it('uses the label, or the type name when it is blank', () => {
        expect(pinDisplayLabel('Home base', 'Bed')).toBe('Home base');
        expect(pinDisplayLabel('  ', 'Death')).toBe('Death');
        expect(pinDisplayLabel('', 'Icon2')).toBe('Pin');
    });
});

describe('pinAccessibleName (prototype naming)', () => {
    const base = { label: 'Camp', type: 'Bed', checked: false, shared: false };
    it('is "<label> (<type>)" for a plain personal pin', () => {
        expect(pinAccessibleName(base)).toBe('Camp (Bed)');
    });
    it('falls back to the type name when the label is blank', () => {
        expect(pinAccessibleName({ ...base, label: ' ', type: 'Shout' })).toBe(
            'Shout (Shout)',
        );
    });
    it('appends ", cartography table" then ", checked"', () => {
        expect(pinAccessibleName({ ...base, shared: true })).toBe(
            'Camp (Bed, cartography table)',
        );
        expect(pinAccessibleName({ ...base, checked: true })).toBe(
            'Camp (Bed, checked)',
        );
        expect(
            pinAccessibleName({ ...base, shared: true, checked: true }),
        ).toBe('Camp (Bed, cartography table, checked)');
    });
});
