/**
 * ROK-1882 — the Valheim skill trend chip for /dev/design-system (§3.2
 * "Character section slots"). The real `SkillList`: a 3-day gain, a 1-day
 * gain, a net loss (danger) and a row with no change (no chip, unchanged).
 * Tap a chip for the per-day line. Tokens only, so it flips with the family.
 */
import type { JSX } from 'react';
import { SkillList } from '../../plugins/valheim/character/skills-section';
import { Section, StateFrame } from './design-system-bits';

const SKILLS = [
    { id: 'Spears', level: 52.4, accumulator: 20 },
    { id: 'Bows', level: 31, accumulator: 5 },
    { id: 'Swim', level: 18.2, accumulator: 3 },
    { id: 'Run', level: 12, accumulator: 1 },
];
const TREND = {
    days: [
        { date: '2026-10-20', gains: { Spears: 2, Bows: 1.3, Swim: -1.2 } },
        { date: '2026-10-18', gains: { Spears: 1.6 } },
        { date: '2026-10-15', gains: { Spears: 0.5 } },
    ],
};

export function SkillTrendDemo(): JSX.Element {
    return (
        <StateFrame label="Skill trend chip — 3 days / 1 day / net loss / no change" note="Same dates on every row; hollow dot = no change that day. Tap a chip for the per-day line.">
            <div className="w-full max-w-md"><SkillList skills={SKILLS} trend={TREND} /></div>
        </StateFrame>
    );
}

/** Its own section (moved out of Map viewport — the chip is a separate pattern). */
export function SkillTrendSection(): JSX.Element {
    return (
        <Section id="skill-trend" title="Pattern — skill trend chip" blurb="§3.2 Character section slots — a delta chip + one dot per play day; dot colour is per day, the chip tone is the net.">
            <SkillTrendDemo />
        </Section>
    );
}
