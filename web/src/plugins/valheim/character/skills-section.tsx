/** ROK-1836 D12 — skills by level desc: name, integer level, and a meter for progress to the next level. */
import type { JSX } from 'react';
import { GuildMeter } from '../../../components/hub/events/guild-meter';
import type { ValheimCharacterSectionProps } from './character-section-slots';
import { sortSkillsByLevel, valheimSkillName } from './valheim-skill-names';

function SkillRow({ id, level }: { id: string; level: number }): JSX.Element {
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
                    pct={(level - whole) * 100}
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
                <SkillRow key={skill.id} id={skill.id} level={skill.level} />
            ))}
        </ul>
    );
}
