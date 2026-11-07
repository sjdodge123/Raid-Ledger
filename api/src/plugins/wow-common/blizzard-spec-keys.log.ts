/**
 * ROK-2110 D8: one-time, keys-only log of the WoW: Forever `specializations`
 * inner shape, so the first real sync shows which keys Blizzard sends
 * (the ROK-2108 probe stops at two levels). Never logs a value. Remove once
 * an anonymised recorded fixture replaces the hand-built one (F7).
 */
type KeysLogger = { log: (msg: string) => void };

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

let logged = false;

/** First element of `v` when it is an array of objects. */
function firstRec(v: unknown): Rec | undefined {
  if (!Array.isArray(v)) return undefined;
  const first: unknown = v[0];
  return isRec(first) ? first : undefined;
}

const keysOf = (v: Rec | undefined): string =>
  v ? `[${Object.keys(v).sort().join(',')}]` : '-';

/** Keys at each level: top, group[0], specializations[0], talents[0], talent. */
export function describeSpecKeys(data: Rec): string {
  const groups = data.specialization_groups;
  const group = firstRec(groups);
  const spec = firstRec(group?.specializations ?? data.specializations);
  const talent = firstRec(spec?.talents);
  const inner = talent && isRec(talent.talent) ? talent.talent : undefined;
  const tooltip =
    talent && isRec(talent.spell_tooltip) ? talent.spell_tooltip : undefined;
  return [
    `top=${keysOf(data)}`,
    `groups=${Array.isArray(groups) ? groups.length : '-'}`,
    `group[0]=${keysOf(group)}`,
    `specializations[0]=${keysOf(spec)}`,
    `talents[0]=${keysOf(talent)}`,
    `talents[0].talent=${keysOf(inner)}`,
    `talents[0].spell_tooltip=${keysOf(tooltip)}`,
  ].join(' ');
}

/** Log the Forever specializations keys once per process (info, no values). */
export function logForeverSpecKeysOnce(data: Rec, logger: KeysLogger): void {
  if (logged) return;
  logged = true;
  logger.log(
    `Forever specializations keys (ROK-2110): ${describeSpecKeys(data)}`,
  );
}

/** Test hook: re-arm the once-per-process flag. */
export function resetForeverSpecKeysLogForTests(): void {
  logged = false;
}
