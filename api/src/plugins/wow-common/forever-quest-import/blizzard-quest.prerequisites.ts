/**
 * ROK-2143 (review M2/M4): the prerequisite quests a Blizzard quest's
 * `requirements` names. Pure; never throws on off-shape input.
 *
 * The one live quest with a quest requirement (4132, run 3, 2026-11-09)
 * stores `quests: { operator: { name: 'And', type: 'AND' }, conditions: [...] }`
 * where each condition is either a nested `{ operator, conditions }` group or
 * `{ target: { id, key, name } }` (pinned as a fixture in the specs). Older
 * guesses are still read: a bare id, an `{ id }` reference and a
 * `{ quest: { id } }` wrapper.
 *
 * Only AND groups count (M4). Blizzard's data has no separate negation flag
 * we have seen, so an `OR` group (any one of several) and any operator we
 * cannot read as `AND` (a negated "not completed X" condition, a breadcrumb
 * exclusion) names no prerequisite. A group with no operator is a plain list
 * and counts as AND.
 */

type JsonRecord = Record<string, unknown>;

const isRecord = (v: unknown): v is JsonRecord =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Group nesting cap (circular-safe by depth). */
const MAX_GROUP_DEPTH = 8;

/** A prerequisite id and how deep its AND group sits (1 = direct). */
export interface PrerequisiteRef {
  id: number;
  depth: number;
}

function positiveInt(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
}

/** `operator` absent → AND (plain list); else only an `AND` type counts. */
function isAndGroup(group: JsonRecord): boolean {
  const op = group.operator;
  if (op === undefined || op === null) return true;
  const type = typeof op === 'string' ? op : isRecord(op) ? op.type : undefined;
  return typeof type === 'string' && type.toUpperCase() === 'AND';
}

/** A condition's quest id: `target`, a `quest` wrapper, `{ id }` or a number. */
function conditionId(v: unknown): number | null {
  if (!isRecord(v)) return positiveInt(v);
  if (v.target !== undefined) return conditionId(v.target);
  if (v.quest !== undefined) return conditionId(v.quest);
  return positiveInt(v.id);
}

function walk(v: unknown, depth: number, out: PrerequisiteRef[]): void {
  if (depth > MAX_GROUP_DEPTH) return;
  if (Array.isArray(v)) {
    for (const e of v) walk(e, depth, out);
    return;
  }
  if (isRecord(v) && Array.isArray(v.conditions)) {
    if (!isAndGroup(v)) return;
    for (const c of v.conditions) walk(c, depth + 1, out);
    return;
  }
  const id = conditionId(v);
  if (id !== null) out.push({ id, depth: Math.max(depth, 1) });
}

/**
 * Every prerequisite under a quest-named top-level key of `requirements`
 * (`quests`, `previous_quest`, `prerequisite_quests`, …), document order,
 * de-duplicated (shallowest occurrence kept), without the quest itself.
 */
export function listPrerequisiteRefs(
  requirements: unknown,
  selfId?: number,
): PrerequisiteRef[] {
  if (!isRecord(requirements)) return [];
  const found: PrerequisiteRef[] = [];
  for (const [key, value] of Object.entries(requirements)) {
    if (/quest/i.test(key)) walk(value, 0, found);
  }
  const byId = new Map<number, PrerequisiteRef>();
  for (const ref of found) {
    if (ref.id === selfId) continue;
    const prev = byId.get(ref.id);
    if (!prev || ref.depth < prev.depth) byId.set(ref.id, ref);
  }
  return [...byId.values()];
}

/** {@link listPrerequisiteRefs} ids, document order. */
export function listPrerequisiteIds(
  requirements: unknown,
  selfId?: number,
): number[] {
  return listPrerequisiteRefs(requirements, selfId).map((r) => r.id);
}

/** All AND prerequisite ids, sorted ascending (stable crawl/report order). */
export function extractPrerequisiteIds(
  requirements: unknown,
  selfId?: number,
): number[] {
  return listPrerequisiteIds(requirements, selfId).sort((a, b) => a - b);
}

/**
 * The one id `prevQuestId` holds. With several AND prerequisites: the most
 * direct (shallowest group) wins, because a nested group is a sub-clause and
 * the direct target is the quest the chain card should step back to (4132 →
 * 4121, not the nested 4081/4082); ties → the highest id, a deterministic
 * pick independent of Blizzard's ordering. The crawl still follows them all.
 */
export function pickPrevQuestId(
  refs: readonly PrerequisiteRef[],
): number | null {
  let best: PrerequisiteRef | null = null;
  for (const ref of refs) {
    if (
      !best ||
      ref.depth < best.depth ||
      (ref.depth === best.depth && ref.id > best.id)
    ) {
      best = ref;
    }
  }
  return best?.id ?? null;
}
