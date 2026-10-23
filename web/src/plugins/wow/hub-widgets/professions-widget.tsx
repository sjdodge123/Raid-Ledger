/**
 * ROK-1923 (epic ROK-1905 H8, widget W4) — WoW: Forever "Guild professions"
 * Overview card body. Each profession shows its member count and best known
 * skill; expanding it lists the members (linked to their character) with
 * skill and a short source note. Core draws the `WidgetCard` chrome; the
 * registration (`professions.register.ts`) gates it to members.
 */
import { useState, type JSX } from 'react';
import { CharacterLink } from '../../../components/hub/character-link';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { useRosterInsights } from './use-roster-insights';
import { ProfessionsEmpty } from './professions-empty';
import {
    bestMember, charactersWithProfessions, formatSkill, memberCount, sortMembers, sourceLabel,
    type ProfessionMember, type RosterProfession,
} from './professions.helpers';

/** The Guild professions widget body (lazy-loaded). */
export default function ProfessionsWidget({ page }: Pick<HubWidgetCtx, 'page'>): JSX.Element {
    const { data, isPending, isError } = useRosterInsights(page.guild.id);
    if (isPending) return <div className="h-24 animate-pulse rounded-md bg-panel" />;
    if (isError) return <p role="alert" className="text-sm text-muted">Couldn't load professions.</p>;
    const professions = data.professions ?? [];
    if (professions.length === 0) return <ProfessionsEmpty gameId={page.guild.gameId} />;
    return (
        <div className="flex flex-col gap-3">
            <ul className="divide-y divide-edge" aria-label="Guild professions">
                {professions.map((p) => <ProfessionRow key={p.name} profession={p} />)}
            </ul>
            <p data-testid="professions-footer" className="text-xs text-muted">
                {charactersWithProfessions(professions)} characters with professions · manual entry, the addon or the Armory
            </p>
        </div>
    );
}

function ProfessionRow({ profession }: { profession: RosterProfession }): JSX.Element {
    const [open, setOpen] = useState(false);
    const best = bestMember(profession);
    const bestSkill = best ? formatSkill(best.skill, best.maxSkill) : null;
    return (
        <li className="py-1.5">
            <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}
                className="flex w-full min-h-[40px] items-center justify-between gap-2 rounded-sm text-left text-sm hover:opacity-80">
                <span className="min-w-0 truncate font-medium text-foreground">{profession.name}</span>
                <span className="shrink-0 text-xs text-muted">
                    {memberCount(profession.members.length)}
                    {bestSkill !== null && <> · best <span className="tabular-nums text-foreground">{bestSkill}</span></>}
                </span>
            </button>
            {open && <MemberList name={profession.name} members={profession.members} />}
        </li>
    );
}

function MemberList({ name, members }: { name: string; members: readonly ProfessionMember[] }): JSX.Element {
    return (
        <ul aria-label={`${name} members`} className="mt-1 flex flex-col gap-1 pl-3">
            {sortMembers(members).map((m) => (
                <li key={m.characterId} className="flex items-center justify-between gap-2 text-sm">
                    <CharacterLink name={m.name} characterId={m.characterId} className="min-w-0 truncate text-foreground" />
                    <span className="flex shrink-0 items-center gap-2">
                        <span className="tabular-nums text-foreground">{formatSkill(m.skill, m.maxSkill) ?? '—'}</span>
                        <span className="text-xs text-muted">{sourceLabel(m.source)}</span>
                    </span>
                </li>
            ))}
        </ul>
    );
}
