/** ROK-1899 — the station switcher: content-width wrapping chips with the station's own icon (initials when it has none). */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ValheimCatalogIcon } from '@raid-ledger/contract';
import { StationSwitcher } from './station-switcher';
import type { StationGroup } from './crafting.helpers';
import type { PlannerNames } from './use-planner-names';

const groups: StationGroup[] = [{ key: 'forge', label: 'Forge', maxLevel: 7, rows: [] }];
const atlas = { sha256: 'a'.repeat(64), width: 512, height: 256, ready: true };

function namesWith(icon: ValheimCatalogIcon | null): PlannerNames {
    return {
        nameOf: (p) => p,
        stationName: () => 'Forge',
        ctxFor: () => ({ serverId: 7, items: { forge: { name: 'Forge', category: 'Station', icon } }, atlas, atlasUrl: 'blob:atlas' }),
    };
}

const forgeChip = (): HTMLElement => {
    const label = screen.getByRole('radio', { name: 'Forge' }).closest('label');
    if (label === null) throw new Error('Forge segment label missing');
    return label;
};

describe('StationSwitcher', () => {
    it('draws the catalogue station icon in the chip', () => {
        render(<StationSwitcher groups={groups} value="forge" onChange={() => undefined} names={namesWith({ kind: 'atlas', x: 0, y: 0, w: 32, h: 32 })} />);
        expect(forgeChip().querySelector('[data-face="sprite"]')).not.toBeNull();
    });

    it('falls back to the initials glyph only when the station has no icon', () => {
        render(<StationSwitcher groups={groups} value="forge" onChange={() => undefined} names={namesWith(null)} />);
        expect(forgeChip().querySelector('[data-face="sprite"]')).toBeNull();
        expect(forgeChip()).toHaveTextContent(/^FForge$/);
    });

    it('sizes chips to their content instead of stretching them to equal widths', () => {
        render(<StationSwitcher groups={groups} value="forge" onChange={() => undefined} />);
        expect(screen.getByRole('radiogroup', { name: 'Crafting station' }).className).toContain('[&_label]:flex-none');
    });
});
