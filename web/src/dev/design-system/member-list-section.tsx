/**
 * Windowed member list + WoW class dots for /dev/design-system (ROK-1173,
 * design-system §4.31). Mounts the REAL `HubMemberVirtualList` with the WoW
 * Members columns over 2,000 sample rows — scroll it and only the visible
 * rows (+ overscan) are in the DOM. The class-dot strip shows all nine
 * `--color-class-*` tokens; flip the colour family to see both sets.
 */
import type { JSX } from 'react';
import type { HubMemberRow } from '../../plugins/hub-module';
import { HubMemberVirtualList } from '../../components/hub/hub-member-virtual-list';
import { bandMembers } from '../../components/hub/hub-members.helpers';
import { WOW_MEMBER_COLUMNS, wowMemberRowClass, wowRankGroup } from '../../plugins/wow/hub/wow-members.helpers';
import { classDotClass } from '../../plugins/wow/hub/wow-member-professions';
import { Section, StateFrame } from './design-system-bits';

const CLASSES = ['Warrior', 'Paladin', 'Hunter', 'Rogue', 'Priest', 'Shaman', 'Mage', 'Warlock', 'Druid'] as const;
const RANKS = ['Guild Master', 'Officer', 'Veteran', 'Member', 'Initiate'] as const;
const ROLES = ['tank', 'healer', 'dps', null] as const;

function sampleRow(i: number): HubMemberRow {
    const rankIndex = Math.min(4, Math.floor(i / 400));
    return {
        memberId: i + 1, name: `Member${String(i + 1).padStart(4, '0')}`, class: CLASSES[i % CLASSES.length] ?? null,
        level: 10 + (i % 51), rankIndex, rankName: RANKS[rankIndex] ?? null, effectiveRole: ROLES[i % ROLES.length] ?? null,
        characterId: null, isMain: i % 7 === 0, ...(i === 3 ? { isViewer: true as const } : {}),
    };
}

const ROWS: readonly HubMemberRow[] = Array.from({ length: 2000 }, (_, i) => sampleRow(i));
const BANDS = bandMembers(ROWS, wowRankGroup);
const FEW_BANDS = bandMembers(ROWS.slice(0, 40), wowRankGroup);

function ClassDots(): JSX.Element {
    return (
        <ul className="flex flex-wrap gap-3" data-testid="ds-class-dots">
            {CLASSES.map((c) => (
                <li key={c} className="inline-flex items-center gap-1.5 text-xs text-muted">
                    <span aria-hidden="true" className={`h-2 w-2 rounded-full ${classDotClass(c) ?? ''}`} />{c}
                </li>
            ))}
        </ul>
    );
}

export function MemberListSection(): JSX.Element {
    return (
        <Section id="member-list" title="Windowed member list + class dots"
            blurb="§4.31 — hub Members list: fixed-height rows, only the visible window (+8 overscan) mounted; table at 1024px and up, cards below. Class dots are decorative; the class name stays text.">
            <div className="grid gap-4" data-testid="ds-member-list">
                <StateFrame label="Class dots — --color-class-*" note="Two blocks (@theme + shared light block), like the faction hues. Unknown classes get no dot.">
                    <ClassDots />
                </StateFrame>
                <StateFrame label="Table (≥1024px) — 2,000 rows, banded by rank" note="hub-member-virtual-list.tsx: rows 44px, band headings 32px; scroll and inspect the DOM.">
                    <div className="w-full"><HubMemberVirtualList bands={BANDS} columns={WOW_MEMBER_COLUMNS} rowClass={wowMemberRowClass} desktop /></div>
                </StateFrame>
                <StateFrame label="Cards (<1024px) — 40 rows" note="Cards 64px; a long meta line clips instead of wrapping.">
                    <div className="w-full max-w-sm"><HubMemberVirtualList bands={FEW_BANDS} columns={WOW_MEMBER_COLUMNS} rowClass={wowMemberRowClass} desktop={false} /></div>
                </StateFrame>
            </div>
        </Section>
    );
}
