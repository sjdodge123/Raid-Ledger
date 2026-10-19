/** ROK-1836 D12 — skills by level desc: name, integer level, and a meter for accumulator progress to the next level. */
import type { JSX } from 'react';
import type { ValheimSkill } from '@raid-ledger/contract';
import { GuildMeter } from '../../../components/hub/events/guild-meter';
import type { ValheimCharacterSectionProps } from './character-section-slots';
import { sortSkillsByLevel, valheimSkillName } from './valheim-skill-names';

/**
 * Valheim `Skills.Skill.GetLevelPercentage`: `m_accumulator` over the XP the
 * next level needs, `(floor(level) + 1)^1.5 * 0.5 + 0.5`. Level 100 is full.
 */
function skillProgressPct(level: number, accumulator: number): number {
    if (level >= 100) return 100;
    const need = Math.pow(Math.floor(level) + 1, 1.5) * 0.5 + 0.5;
    return Math.min(1, accumulator / need) * 100;
}

function SkillRow({ skill }: { skill: ValheimSkill }): JSX.Element {
    const { id, level } = skill;
    const name = valheimSkillName(id);
    const whole = Math.floor(level);
    return (
        <li
            data-skill={id}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1"
        >
            <span className="truncate text-sm text-foreground">{name}</span>
            <span className="text-sm font-bold tabular-nums text-foreground">
                {whole}
            </span>
            <div className="col-span-2">
                <GuildMeter
                    pct={skillProgressPct(level, skill.accumulator)}
                    label={`${name} progress to level ${Math.min(whole + 1, 100)}`}
                />
            </div>
        </li>
    );
}

export function SkillsSection({
    character,
}: ValheimCharacterSectionProps): JSX.Element {
    if (character.skills.length === 0)
        return <p className="text-sm text-muted">No skills recorded yet.</p>;
    return (
        <ul className="m-0 grid list-none gap-2.5 p-0">
            {sortSkillsByLevel(character.skills).map((skill) => (
                <SkillRow key={skill.id} skill={skill} />
            ))}
        </ul>
    );
}
