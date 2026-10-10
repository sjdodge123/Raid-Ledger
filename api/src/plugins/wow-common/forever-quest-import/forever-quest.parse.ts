/**
 * ROK-1748: pure parsers for Wowhead zone/quest pages (Forever dataEnv 16,
 * same markup family as Classic). Markup anchors are documented in
 * `testing/fixtures/wowhead-quests/README.md`. Nothing here throws on
 * off-shape input — bad rows are skipped and reported.
 */
import { z } from 'zod';

const itemPairs = z.array(z.tuple([z.number().int(), z.number()])).optional();

/** One quest Listview entry; unknown keys (`envChange`, …) pass through. */
const zoneQuestRowSchema = z.looseObject({
  id: z.number().int().positive(),
  name: z.string(),
  level: z.number().int().optional(),
  reqlevel: z.number().int().optional(),
  side: z.number().int().optional(),
  xp: z.number().int().optional(),
  money: z.number().int().optional(),
  itemrewards: itemPairs,
  itemchoices: itemPairs,
  notShown: z.unknown().optional(),
});
export type ZoneQuestRow = z.infer<typeof zoneQuestRowSchema>;

export interface ParseSkip {
  id: number | null;
  reason: string;
}

export interface ZoneQuestList {
  rows: ZoneQuestRow[];
  /** Rows Wowhead flags `notShown` — reported, not imported. */
  notShown: ZoneQuestRow[];
  skipped: ParseSkip[];
}

const LISTVIEW_ANCHOR = "template: 'quest', id: 'quests'";

/** Slice the balanced JSON array starting at `start` (a `[`). */
function sliceJsonArray(src: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return src.slice(start, i + 1);
  }
  return null;
}

function listviewData(html: string): unknown[] | null {
  const anchor = html.indexOf(LISTVIEW_ANCHOR);
  const dataAt = anchor < 0 ? -1 : html.indexOf('data: [', anchor);
  const raw = dataAt < 0 ? null : sliceJsonArray(html, dataAt + 6);
  if (raw === null) return null;
  try {
    const data: unknown = JSON.parse(raw);
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

function isNotShown(value: unknown): boolean {
  if (value === undefined || value === null || value === false) return false;
  return !(Array.isArray(value) && value.length === 0) && value !== 0;
}

function rawId(item: unknown): number | null {
  const id = (item as { id?: unknown } | null)?.id;
  return typeof id === 'number' ? id : null;
}

/** Parse the zone page's quest Listview into rows (+ notShown + skipped). */
export function parseZoneQuestList(html: string): ZoneQuestList {
  const list: ZoneQuestList = { rows: [], notShown: [], skipped: [] };
  const data = listviewData(html);
  if (data === null) {
    list.skipped.push({ id: null, reason: 'quest Listview not found' });
    return list;
  }
  for (const item of data) {
    const parsed = zoneQuestRowSchema.safeParse(item);
    if (!parsed.success) {
      list.skipped.push({ id: rawId(item), reason: 'off-shape zone row' });
    } else if (isNotShown(parsed.data.notShown))
      list.notShown.push(parsed.data);
    else list.rows.push(parsed.data);
  }
  return list;
}

export interface SeriesStep {
  /** Null for the page's own quest (rendered bold, no link). */
  questId: number | null;
  name: string;
  current: boolean;
}

export interface ParsedQuest {
  questLevel: number | null;
  requiredLevel: number | null;
  startNpcId: number | null;
  startNpcName: string | null;
  side: 'Alliance' | 'Horde' | 'Both' | null;
  sharable: boolean;
  series: SeriesStep[];
  prevQuestId: number | null;
  nextQuestId: number | null;
}

const INFOBOX_RE =
  /WH\.markup\.printHtml\("(\[ul\][\s\S]*?)", "infobox-contents/;
const SERIES_RE = /<table class="series">([\s\S]*?)<\/table>/;
const SERIES_ROW_RE =
  /<tr><th>\d+\.<\/th><td><div>([\s\S]*?)<\/div><\/td><\/tr>/g;

/** The infobox Markup string, JSON-unescaped (`[\/li]` → `[/li]`). */
function infoboxMarkup(html: string): string | null {
  const m = INFOBOX_RE.exec(html);
  if (!m) return null;
  try {
    return JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return null;
  }
}

function intMatch(re: RegExp, src: string): number | null {
  const m = re.exec(src);
  return m ? Number(m[1]) : null;
}

const SERIES_LINK_RE =
  /<a href="\/(?:[a-z-]+\/)?quest=(\d+)[^"]*">([^<]+)<\/a>/;

function parseSeries(html: string): SeriesStep[] {
  const table = SERIES_RE.exec(html)?.[1] ?? '';
  return [...table.matchAll(SERIES_ROW_RE)].map(([, cell]) => {
    const link = SERIES_LINK_RE.exec(cell);
    if (link)
      return { questId: Number(link[1]), name: link[2], current: false };
    const bold = /<b>([^<]+)<\/b>/.exec(cell)?.[1] ?? '';
    return { questId: null, name: bold, current: true };
  });
}

/** Parse a quest page's infobox + Series table; null if no infobox. */
export function parseQuestPage(
  html: string,
  opts: { env: 'forever' | 'classic' },
): ParsedQuest | null {
  const info = infoboxMarkup(html);
  if (info === null) return null;
  const start = new RegExp(
    `Start: \\[url=/${opts.env}/npc=(\\d+)/[^\\]]*\\]([^[]+)\\[/url\\]`,
  ).exec(info);
  const side = /\[li\]Side: (?:\[span[^\]]*\])?(Alliance|Horde|Both)/.exec(
    info,
  );
  const series = parseSeries(html);
  const at = series.findIndex((s) => s.current);
  return {
    questLevel: intMatch(/\[li\]Level: (\d+)\[\/li\]/, info),
    requiredLevel: intMatch(/\[li\]Requires level (\d+)\[\/li\]/, info),
    startNpcId: start ? Number(start[1]) : null,
    startNpcName: start ? start[2] : null,
    side: (side?.[1] as ParsedQuest['side']) ?? null,
    sharable: /\[li\]Sharable\[\/li\]/.test(info),
    series,
    prevQuestId: at > 0 ? (series[at - 1]?.questId ?? null) : null,
    nextQuestId: at >= 0 ? (series[at + 1]?.questId ?? null) : null,
  };
}

export {
  dungeonQuestRowSchema,
  toDungeonQuestRow,
  type DungeonQuestRow,
  type DungeonQuestRowResult,
} from './forever-quest.row';
