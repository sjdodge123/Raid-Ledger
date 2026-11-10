/**
 * ROK-1830 — the WoW guild's Members cells: the role summary band and the
 * per-row cells (character link, level + class, rank, the
 * Main pill and the raid-role badge). Core owns the section, card and collapse frame.
 * ROK-1173: the avatar + "You" pill (AC9/AC11), the class dot (AC12) and the
 * professions cell (AC8). Rows have a FIXED height (windowed list), so every
 * cell stays on one line and truncates instead of wrapping.
 */
import type { JSX } from 'react';
import type { HubCtx, HubMemberRow } from '../../hub-module';
import { Pill } from '../../../components/hub/hub-bits';
import { CharacterLink } from '../../../components/hub/character-link';
import { CharRoleBadge, RoleSummary } from './role-bits';
import { rankLabel } from './wow-guild.helpers';
import { ProfessionBadges } from '../components/ProfessionBadges';
import { classDotClass, useRowProfessions } from './wow-member-professions';
import { armoryMetaParts } from '../lib/armory-meta';
import { useRosterMemberHref } from './wow-member-row-href';

function memberFacts(m: HubMemberRow): string {
    return [m.level === null ? null : `Lv ${m.level}`, m.class].filter(Boolean).join(' ');
}

/** AC11: lazy, fixed 20px box, never blocks paint; no avatar → no image (Blizzard fetch stays ROK-1170). */
function MemberAvatar({ url }: { url: string }): JSX.Element {
    return (
        <img src={url} alt="" width={20} height={20} loading="lazy" decoding="async"
            data-testid="guild-member-avatar" className="h-5 w-5 shrink-0 rounded-full bg-panel object-cover" />
    );
}

/** ROK-2155: `stretched` (the `rowLink` column, phone cards) — the name link covers the whole card, claimed or unclaimed. */
export function NameCell({ row, stretched = false }: { row: HubMemberRow; stretched?: boolean }): JSX.Element {
    const unlinkedTo = useRosterMemberHref(row);
    return (
        <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 align-middle">
            {row.avatarUrl ? <MemberAvatar url={row.avatarUrl} /> : null}
            <span className="min-w-0 truncate"><CharacterLink name={row.name} characterId={row.characterId} unlinkedTo={unlinkedTo} stretched={stretched} /></span>
            {row.isViewer === true && <span data-testid="guild-member-you"><Pill>You</Pill></span>}
        </span>
    );
}

/**
 * AC12: a small decorative class dot; the class text keeps its token colour.
 * ROK-2133: the Armory spec + item level follow when the row has them, and
 * truncate first so a narrow row never overflows.
 */
export function FactsCell({ row }: { row: HubMemberRow }): JSX.Element {
    const dot = classDotClass(row.class);
    const armory = armoryMetaParts(row).join(' · ');
    return (
        <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 whitespace-nowrap text-xs text-muted">
            {dot && <span aria-hidden="true" data-testid="guild-member-class-dot" className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />}
            <span className="shrink-0">{memberFacts(row)}</span>
            {armory && <span data-testid="guild-member-armory" className="min-w-0 truncate">· {armory}</span>}
        </span>
    );
}

/**
 * AC8: linked rows with synced professions show badges; anything else renders nothing.
 * ROK-2155: wraps but shows ONE 16px line (`max-h-4`), so a badge that does not
 * fit drops whole instead of clipping mid-icon. `lg:relative` only: a phone card
 * (touch, no hover) lets a tap on the badges open the row like the rest of the
 * card; on a hover shell the titled badges stay above any row overlay.
 */
export function ProfessionsCell({ row }: { row: HubMemberRow }): JSX.Element | null {
    const professions = useRowProfessions(row);
    if (!professions) return null;
    return (
        <span className="inline-flex max-h-4 min-w-0 max-w-full flex-wrap items-center gap-x-1.5 overflow-hidden whitespace-nowrap text-xs text-muted lg:relative" data-testid="guild-member-professions">
            <ProfessionBadges professions={professions} separator="" />
        </span>
    );
}

export function MainCell({ row }: { row: HubMemberRow }): JSX.Element | null {
    return row.isMain ? <Pill>Main</Pill> : null;
}

export function RankCell({ row }: { row: HubMemberRow }): JSX.Element {
    // ROK-2155: never wraps ("Guild Master" broke onto two lines) and never gives up width to the facts.
    return <span className="shrink-0 whitespace-nowrap text-xs text-muted">{rankLabel(row)}</span>;
}

export function RoleCell({ row }: { row: HubMemberRow }): JSX.Element | null {
    return row.effectiveRole ? <CharRoleBadge role={row.effectiveRole} /> : null;
}

export function WowRoleSummaryBand({ page }: HubCtx): JSX.Element {
    return <RoleSummary counts={page.roleCounts} />;
}
