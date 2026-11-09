/**
 * ROK-1173 AC8/AC12 — the per-row decorations the Members list needs beyond
 * the page payload: each row's professions (joined from roster insights by
 * the row key — `characterId`, or `'m' + memberId` for an unclaimed member's
 * Armory snapshot, ROK-2149 Q4=A) and the class dot's token class.
 */
import { useParams } from 'react-router-dom';
import type { CharacterProfessionsDto, WowRosterInsightsDto } from '@raid-ledger/contract';
import type { HubMemberRow } from '../../hub-module';
import { useRosterInsights } from '../hub-widgets/use-roster-insights';
import { professionMemberKey, rowProfessionKey } from '../lib/profession-member-key';

type ProfessionIndex = ReadonlyMap<string, CharacterProfessionsDto>;

const EPOCH = new Date(0).toISOString();
const INDEX_CACHE = new WeakMap<WowRosterInsightsDto, ProfessionIndex>();

function slugOf(name: string): string {
    return name.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Row key (`professionMemberKey`) → that member's professions, in the `ProfessionBadges`
 * shape. Insights reports skill per profession member; an unreported skill
 * reads as 0. Visitors get no `professions` key, so the index is empty.
 */
export function professionIndex(insights: WowRosterInsightsDto | undefined): ProfessionIndex {
    if (!insights?.professions) return new Map();
    const cached = INDEX_CACHE.get(insights);
    if (cached) return cached;
    const index = new Map<string, CharacterProfessionsDto>();
    insights.professions.forEach((prof, i) => {
        for (const m of prof.members) {
            const key = professionMemberKey(m);
            if (key === null) continue;
            const entry = { id: i, name: prof.name, slug: slugOf(prof.name), skillLevel: m.skill ?? 0, maxSkillLevel: m.maxSkill ?? 0, tiers: [] };
            const prev = index.get(key) ?? { primary: [], secondary: [], syncedAt: EPOCH };
            index.set(key, { ...prev, primary: [...prev.primary, entry] });
        }
    });
    INDEX_CACHE.set(insights, index);
    return index;
}

/** One row's professions by its row key; null when it has none reported (AC8: absent, not "none"). */
export function rowProfessions(index: ProfessionIndex, rowKey: string): CharacterProfessionsDto | null {
    return index.get(rowKey) ?? null;
}

/**
 * The hub's guild id comes from the `/hubs/:id` route; the insights query is
 * shared (react-query dedupes it) with the filters hook and the widgets.
 */
export function useRowProfessions(row: Pick<HubMemberRow, 'characterId' | 'memberId'>): CharacterProfessionsDto | null {
    const { id } = useParams<{ id: string }>();
    const guildId = Number(id);
    const insights = useRosterInsights(Number.isInteger(guildId) ? guildId : 0);
    return rowProfessions(professionIndex(insights.data), rowProfessionKey(row));
}

/** The nine classic classes' dot tokens (index.css `--color-class-*`, both families). */
const CLASS_DOT: Readonly<Record<string, string>> = {
    warrior: 'bg-class-warrior',
    paladin: 'bg-class-paladin',
    hunter: 'bg-class-hunter',
    rogue: 'bg-class-rogue',
    priest: 'bg-class-priest',
    shaman: 'bg-class-shaman',
    mage: 'bg-class-mage',
    warlock: 'bg-class-warlock',
    druid: 'bg-class-druid',
};

/** The dot's background utility for a class name, or null (unknown class → no dot). */
export function classDotClass(cls: string | null): string | null {
    return cls === null ? null : CLASS_DOT[cls.trim().toLowerCase()] ?? null;
}
