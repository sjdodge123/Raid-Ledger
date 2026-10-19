/**
 * ROK-1836 — the character page's section slot list (L2 shell, L3 fills).
 *
 * The page renders every entry as a §4.10 titled `<section>` in its column
 * (one column below 1024px, two from 1024px). L3 swaps an entry's
 * `component` for the real section (equipment / skills / inventory /
 * trophies) — the page shell itself never changes.
 */
import type { ComponentType } from 'react';
import type { ValheimCharacterDetail } from '@raid-ledger/contract';
import { SectionPlaceholder } from './section-placeholder';

export interface ValheimCharacterSectionProps {
    character: ValheimCharacterDetail;
}

export interface ValheimCharacterSectionDef {
    /** Stable id — also the heading id prefix (`${id}-h`). */
    id: 'equipment' | 'skills' | 'inventory' | 'trophies';
    title: string;
    /** Desktop column: Equipment + Skills left, Inventory + Trophies right (spec layout). */
    column: 'left' | 'right';
    component: ComponentType<ValheimCharacterSectionProps>;
}


export const VALHEIM_CHARACTER_SECTIONS: readonly ValheimCharacterSectionDef[] = [
    { id: 'equipment', title: 'Equipment', column: 'left', component: SectionPlaceholder },
    { id: 'skills', title: 'Skills', column: 'left', component: SectionPlaceholder },
    { id: 'inventory', title: 'Inventory', column: 'right', component: SectionPlaceholder },
    { id: 'trophies', title: 'Trophies', column: 'right', component: SectionPlaceholder },
];
