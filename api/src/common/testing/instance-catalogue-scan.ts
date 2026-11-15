/**
 * ROK-2210: source scanner behind `instance-catalogue.guard.spec.ts`. Finds
 * hand-rolled instance tables outside the catalogue module: id-keyed maps
 * (≥3 distinct catalogue ids as object keys), name-keyed maps (≥3 distinct
 * catalogue names as keys), number→id maps such as zone→instance (≥3
 * distinct catalogue ids as values of numeric keys) and
 * `minimumLevel: <number>` literals. Callers pass comment-stripped text
 * (`strip-comments.ts`).
 */
export type CatalogueDetector =
  'id-map' | 'name-map' | 'zone-map' | 'level-literal';

export interface CatalogueScanHit {
  detector: CatalogueDetector;
  line: number;
  token: string;
}

export interface CatalogueVocabulary {
  ids: ReadonlySet<number>;
  names: readonly string[];
}

interface Found {
  token: string;
  index: number;
}

const ID_KEY_RE = /(?:^|[{,\s])(\d{2,8})\s*:/gm;
const ID_VALUE_RE = /(?:^|[{,\s])\d{1,8}\s*:\s*(\d{2,8})\b/gm;
const LEVEL_LITERAL_RE = /minimumLevel\s*:\s*\d+/g;
const MIN_DISTINCT = 3;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** One regex matching any catalogue name used as an object key. */
export function buildNameKeyRe(names: readonly string[]): RegExp {
  const quoted = names.map(escapeRe).join('|');
  const singleQuoted = names
    .map((n) => escapeRe(n).replace(/'/g, "\\\\'"))
    .join('|');
  const bare = names.filter((n) => /^[A-Za-z_$][\w$]*$/.test(n)).join('|');
  const alts = [
    `'(?:${singleQuoted})'`,
    `"(?:${quoted})"`,
    `\`(?:${quoted})\``,
  ];
  if (bare) alts.push(`(?:${bare})`);
  return new RegExp(`(?:^|[{,\\s])(${alts.join('|')})\\s*:`, 'gm');
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function collect(
  text: string,
  re: RegExp,
  keep: (token: string) => boolean,
): Found[] {
  const out: Found[] = [];
  for (const m of text.matchAll(re)) {
    const token = (m[1] ?? m[0]).replace(/^['"`]|['"`]$/g, '');
    if (keep(token)) out.push({ token, index: m.index });
  }
  return out;
}

function toHits(
  text: string,
  detector: CatalogueDetector,
  found: Found[],
  minDistinct: number,
): CatalogueScanHit[] {
  if (new Set(found.map((f) => f.token)).size < minDistinct) return [];
  return found.map((f) => ({
    detector,
    line: lineAt(text, f.index),
    token: f.token,
  }));
}

/** Every offending key/value/literal in one comment-stripped source. */
export function scanCatalogueSource(
  text: string,
  vocab: CatalogueVocabulary,
  nameRe: RegExp,
): CatalogueScanHit[] {
  const isId = (t: string): boolean => vocab.ids.has(Number(t));
  return [
    ...toHits(text, 'id-map', collect(text, ID_KEY_RE, isId), MIN_DISTINCT),
    ...toHits(
      text,
      'name-map',
      collect(text, nameRe, () => true),
      MIN_DISTINCT,
    ),
    ...toHits(text, 'zone-map', collect(text, ID_VALUE_RE, isId), MIN_DISTINCT),
    ...toHits(
      text,
      'level-literal',
      collect(text, LEVEL_LITERAL_RE, () => true),
      1,
    ),
  ];
}
