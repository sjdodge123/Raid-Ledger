/**
 * ROK-2207 prototype — pure helpers for the dungeon planner wireframe.
 * Nothing here talks to the API; the build will move the shared pieces
 * next to the real components (see the `BUILD:` notes).
 */
import type { EnrichedDungeonQuestDto, WowInstanceDto } from '@raid-ledger/contract';

/** A picked roster character as the planner shows it. */
export interface PlannerCharacter {
    /** `characters.id`; null = roster row with no linked (claimed) character. */
    characterId: string | null;
    name: string;
    className: string;
    level: number;
}

/** How a character's level sits against the dungeon's range. */
export type LevelFit = 'in' | 'below' | 'above' | 'unknown';

/**
 * "Lv15-21", or "Lv15+" when there is no ceiling.
 * BUILD: export `levelRange` from `plugins/wow/slots/event-create-content-browser.tsx` and import it.
 */
export function levelRange(min: number, max?: number | null): string {
    return `Lv${min}${max ? `-${max}` : '+'}`;
}

/** The instance's range label, or "" when the list has no minimum. */
export function instanceRange(inst: WowInstanceDto): string {
    return inst.minimumLevel != null ? levelRange(inst.minimumLevel, inst.maximumLevel) : '';
}

/** Where a level falls against the dungeon's min/max. */
export function levelFit(level: number | null, inst: WowInstanceDto): LevelFit {
    if (level == null || inst.minimumLevel == null) return 'unknown';
    if (level < inst.minimumLevel) return 'below';
    if (inst.maximumLevel != null && level > inst.maximumLevel) return 'above';
    return 'in';
}

/** The level line's copy — mirrors `getLevelWarning` wording. BUILD: extract that helper and share it. */
export function levelFitCopy(fit: LevelFit, inst: WowInstanceDto): string {
    if (fit === 'below') return `Below min level (${inst.minimumLevel ?? '?'})`;
    if (fit === 'above') return `Above range (max ${inst.maximumLevel ?? '?'})`;
    if (fit === 'unknown') return 'Level unknown';
    return 'In range';
}

/**
 * Sub-group quests by practical pickup type (the event page's grouping).
 * BUILD: extract `groupByType` from `plugins/wow/slots/quest-prep-panel.tsx` into `quest-prep-groups.ts`.
 */
export function groupByType(list: EnrichedDungeonQuestDto[]): {
    sharable: EnrichedDungeonQuestDto[]; chain: EnrichedDungeonQuestDto[]; solo: EnrichedDungeonQuestDto[];
} {
    return {
        sharable: list.filter((q) => q.sharable && !q.prevQuestId),
        chain: list.filter((q) => !!q.prevQuestId),
        solo: list.filter((q) => !q.sharable && !q.prevQuestId),
    };
}

/** Plan state carried in the URL (OQ5 ruling: the link holds the plan, no saved plans; OQ2: one dungeon). */
export interface PlanQuery {
    /** Picked roster names, in order. BUILD: characterIds (unclaimed rows by roster member id). */
    names?: string[];
    /** The plan's one dungeon. */
    dungeonId?: number;
}

/** Parse `?c=Aelin,Brann&d=90000004`; missing or invalid keys stay absent (keep the defaults). */
export function parsePlanQuery(search: string): PlanQuery {
    const q = new URLSearchParams(search);
    const c = q.get('c');
    const d = Number(q.get('d') ?? '');
    const out: PlanQuery = {};
    if (c !== null) out.names = c.split(',').filter(Boolean);
    if (Number.isInteger(d) && d > 0) out.dungeonId = d;
    return out;
}

/** The stateless share link: `<base>?c=…&d=…` (build: `/hubs/:id?c=…&d=…#dungeon-planner`). */
export function shareUrl(base: string, names: string[], dungeonId: number): string {
    const q = new URLSearchParams({ c: names.join(','), d: String(dungeonId) });
    return `${base}?${q.toString()}`;
}

/** Characters that can actually be invited (claimed ones) and the names left out. */
export function invitable(chars: PlannerCharacter[]): { ids: string[]; excluded: string[] } {
    return {
        ids: chars.flatMap((c) => (c.characterId ? [c.characterId] : [])),
        excluded: chars.filter((c) => !c.characterId).map((c) => c.name),
    };
}

/** Pre-fill params for `/events/new` (spec D6 + OQ3 option B's `inviteCharacterIds`). */
export interface CreateEventParams {
    gameId: number;
    guildId: number;
    instanceIds: number[];
    inviteCharacterIds?: string[];
}

/** `/events/new?gameId=…&guildId=…&contentInstanceIds=…[&inviteCharacterIds=…]`. */
export function createEventUrl(p: CreateEventParams): string {
    const q = new URLSearchParams({
        gameId: String(p.gameId), guildId: String(p.guildId), contentInstanceIds: p.instanceIds.join(','),
    });
    if (p.inviteCharacterIds?.length) q.set('inviteCharacterIds', p.inviteCharacterIds.join(','));
    return `/events/new?${q.toString()}`;
}
