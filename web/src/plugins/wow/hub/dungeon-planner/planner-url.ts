/**
 * ROK-2216 — the Dungeon planner's stateless link (ROK-2207 OQ5: the link IS
 * the plan). `/hubs/:id?d=<instanceId>&c=<token>,…#dungeon-planner`; a token
 * is a claimed character's uuid or `m<memberId>` for an unclaimed roster row.
 */
import { MAX_DUNGEON_PLAN_CHARACTERS } from '@raid-ledger/contract';

/** The hub tab id (and URL hash) of the planner. */
export const DUNGEON_PLANNER_TAB_ID = 'dungeon-planner';

/** One pick: a claimed character (by id) or an unclaimed roster member (by member id). */
export type PlanToken =
    | { kind: 'character'; characterId: string }
    | { kind: 'member'; memberId: number };

/** The plan as the URL carries it. */
export interface PlanState {
    instanceId: number | null;
    tokens: PlanToken[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MEMBER_RE = /^m([1-9]\d*)$/;

/** Parse one link token; null when malformed. */
export function parseToken(raw: string): PlanToken | null {
    const value = raw.trim().toLowerCase();
    if (UUID_RE.test(value)) return { kind: 'character', characterId: value };
    const member = MEMBER_RE.exec(value)?.[1];
    const memberId = member === undefined ? NaN : Number(member);
    return Number.isSafeInteger(memberId) ? { kind: 'member', memberId } : null;
}

/** A token's link form — also its identity for de-duplication. */
export function tokenKey(token: PlanToken): string {
    return token.kind === 'character' ? token.characterId : `m${token.memberId}`;
}

/** Valid tokens in pick order: malformed and duplicate ones dropped, at most five kept. */
function parseTokens(raw: string | null): PlanToken[] {
    const out: PlanToken[] = [];
    const seen = new Set<string>();
    for (const part of (raw ?? '').split(',')) {
        if (out.length >= MAX_DUNGEON_PLAN_CHARACTERS) break;
        const token = parseToken(part);
        if (!token || seen.has(tokenKey(token))) continue;
        seen.add(tokenKey(token));
        out.push(token);
    }
    return out;
}

/** Read the plan from a location search string (`?d=…&c=…`). */
export function parsePlanQuery(search: string): PlanState {
    const query = new URLSearchParams(search);
    const d = query.get('d') ?? '';
    const id = /^\d+$/.test(d) ? Number(d) : NaN;
    return {
        instanceId: Number.isSafeInteger(id) && id > 0 ? id : null,
        tokens: parseTokens(query.get('c')),
    };
}

/** The plan's query string without `?` (commas left readable); '' for an empty plan. */
export function planSearch(state: PlanState): string {
    const parts: string[] = [];
    if (state.instanceId !== null) parts.push(`d=${state.instanceId}`);
    if (state.tokens.length > 0) parts.push(`c=${state.tokens.map(tokenKey).join(',')}`);
    return parts.join('&');
}

/** The copyable link to this plan on the guild hub. */
export function shareUrl(origin: string, guildId: number, state: PlanState): string {
    const search = planSearch(state);
    return `${origin}/hubs/${guildId}${search ? `?${search}` : ''}#${DUNGEON_PLANNER_TAB_ID}`;
}

/** The claimed characters' ids (the only picks the plan API and invites take), in order. */
export function toCharacterIds(tokens: PlanToken[]): string[] {
    return tokens.flatMap((t) => (t.kind === 'character' ? [t.characterId] : []));
}

/** Pre-fill params for `/events/new` (read by ROK-2215's `create-event-prefill.ts`). */
export interface CreateEventParams {
    gameId: number;
    guildId: number;
    instanceIds: number[];
    inviteCharacterIds?: string[];
}

/** `/events/new?gameId=…&guildId=…&contentInstanceIds=…[&inviteCharacterIds=…]`. */
export function createEventUrl(p: CreateEventParams): string {
    const base = `/events/new?gameId=${p.gameId}&guildId=${p.guildId}&contentInstanceIds=${p.instanceIds.join(',')}`;
    const invite = p.inviteCharacterIds ?? [];
    return invite.length > 0 ? `${base}&inviteCharacterIds=${invite.join(',')}` : base;
}
