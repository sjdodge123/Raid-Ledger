/**
 * ROK-1790 — one profession card on the Crafters tab (§4.2 card chrome):
 * the profession name + crafter count, then one row per crafter — the same
 * `CharacterLink` / `formatSkill` / `sourceLabel` row the Guild professions
 * widget draws (spec D5), plus a §3.2 `GuildMeter` skill bar. An unclaimed
 * roster member links to its read-only roster page (ROK-2149) in italics.
 * No "specialty" line (operator ruling 2026-11-12 Q4: no source for it).
 */
import type { JSX } from 'react';
import { CharacterLink } from '../../../../components/hub/character-link';
import { GuildMeter } from '../../../../components/hub/events/guild-meter';
import { professionMemberKey } from '../../lib/profession-member-key';
import { memberPagePath } from '../../lib/member-routes';
import {
    formatSkill, memberCount, sourceLabel, type ProfessionMember, type RosterProfession,
} from '../../hub-widgets/professions.helpers';

interface CrafterCardProps {
    profession: RosterProfession;
    /** The hub id, for an unclaimed member's roster page. */
    hubId: number;
}

/** A profession card; `profession.members` arrive already sorted by `filterCrafters`. */
export function CrafterCard({ profession, hubId }: CrafterCardProps): JSX.Element {
    const { name, members } = profession;
    return (
        <li className="flex flex-col gap-3 rounded-lg border border-edge bg-panel p-4">
            <div className="flex items-baseline justify-between gap-2">
                <h3 className="min-w-0 truncate text-base font-semibold text-foreground">{name}</h3>
                <span className="shrink-0 text-xs text-muted">{memberCount(members.length)}</span>
            </div>
            <ul aria-label={`${name} crafters`} className="flex flex-col gap-2">
                {members.map((m) => (
                    <CrafterRow key={professionMemberKey(m) ?? m.name} member={m} profession={name} hubId={hubId} />
                ))}
            </ul>
        </li>
    );
}

function CrafterRow({ member, profession, hubId }: { member: ProfessionMember; profession: string; hubId: number }): JSX.Element {
    const skill = formatSkill(member.skill, member.maxSkill);
    const unlinkedTo = member.memberId === undefined ? undefined : memberPagePath(hubId, member.memberId);
    const nameClass = member.characterId === null ? 'italic text-foreground' : 'font-medium text-foreground';
    return (
        <li className="flex flex-col gap-1 text-sm">
            <span className="flex items-center justify-between gap-2">
                <CharacterLink name={member.name} characterId={member.characterId} unlinkedTo={unlinkedTo}
                    className={`min-w-0 truncate ${nameClass}`} />
                <span className="flex shrink-0 items-center gap-2">
                    <span className="tabular-nums text-foreground">{skill ?? '—'}</span>
                    <span className="text-xs text-muted">{sourceLabel(member.source)}</span>
                </span>
            </span>
            {member.skill !== null && member.maxSkill !== null && member.maxSkill > 0 && (
                <GuildMeter tone="neutral" pct={(member.skill / member.maxSkill) * 100} label={`${member.name} ${profession} skill`} />
            )}
        </li>
    );
}
