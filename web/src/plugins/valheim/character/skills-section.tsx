/**
 * ROK-1836 D12 — skills by level desc: name, integer level, and a meter for accumulator progress to the next level.
 * ROK-1882 — plus a trend chip (last 3 play days) between the name and the level; no trend → the row is unchanged.
 */
import { useId, useState, type JSX } from 'react';
import type { ValheimSkill, ValheimSkillTrend } from '@raid-ledger/contract';
import { GuildMeter } from '../../../components/hub/events/guild-meter';
import type { ValheimCharacterSectionProps } from './character-section-slots';
import { sortSkillsByLevel, valheimSkillName } from './valheim-skill-names';
import { skillTrendFor } from './skill-trend.helpers';
import { SkillTrendChip, SkillTrendDetail } from './skill-trend';

/**
 * Valheim `Skills.Skill.GetLevelPercentage`: `m_accumulator` over the XP the
 * next level needs, `(floor(level) + 1)^1.5 * 0.5 + 0.5`. Level 100 is full.
 */
function skillProgressPct(level: number, accumulator: number): number {
    if (level >= 100) return 100;
    const need = Math.pow(Math.floor(level) + 1, 1.5) * 0.5 + 0.5;
    return Math.min(1, accumulator / need) * 100;
}

function SkillMeter({ skill, name }: { skill: ValheimSkill; name: string }): JSX.Element {
    const next = Math.min(Math.floor(skill.level) + 1, 100);
    return (
        <div className="col-span-3">
            <GuildMeter
                pct={skillProgressPct(skill.level, skill.accumulator)}
                label={`${name} progress to level ${next}`}
            />
        </div>
    );
}

/**
 * Three columns — name | trend chip | level. The gaps live on the name (`pr-3`)
 * and the chip (`mr-3`), so a row without a chip spaces exactly as before.
 */
function SkillRow({ skill, trend }: {
    skill: ValheimSkill;
    trend: ValheimSkillTrend | undefined;
}): JSX.Element {
    const name = valheimSkillName(skill.id);
    const t = skillTrendFor(skill.id, trend);
    const detailId = useId();
    const [expanded, setExpanded] = useState(false);
    return (
        <li
            data-skill={skill.id}
            className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-y-1"
        >
            <span className="truncate pr-3 text-sm text-foreground">{name}</span>
            {t && (
                <SkillTrendChip
                    trend={t}
                    detailId={detailId}
                    expanded={expanded}
                    onToggle={() => setExpanded((v) => !v)}
                />
            )}
            <span className="col-start-3 text-sm font-bold tabular-nums text-foreground">
                {Math.floor(skill.level)}
            </span>
            <SkillMeter skill={skill} name={name} />
            {t && <SkillTrendDetail trend={t} id={detailId} expanded={expanded} />}
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
                <SkillRow key={skill.id} skill={skill} trend={character.skillTrend} />
            ))}
        </ul>
    );
}
