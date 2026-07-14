/**
 * Lenient Co-Optimus XML parsing (ROK-1397).
 *
 * The API's responses are NOT reliably well-formed standalone XML: browser
 * -fetched payloads carry a trailing Cloudflare <script> after </games>, and
 * the prose fields (coopexp/background) contain unescaped entities that trip
 * strict DOM parsers. So: slice to the </games> envelope and tag-extract the
 * flat scalar fields (which never contain markup) — exactly the approach the
 * ROK-275 probe exercised across 179 live responses.
 */

export interface CooptimusEntry {
  id: number;
  title: string;
  system: string;
  steam: number | null;
  online: number;
  local: number;
  lan: number;
  splitscreen: boolean;
  dropInDropOut: boolean;
  campaign: boolean;
  featurelist: string | null;
  coopExperience: string | null;
  description: string | null;
  url: string | null;
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
};

function decodeEntities(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|#39|apos);/g, (m) => ENTITIES[m] ?? m);
}

function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  const v = m?.[1]?.trim();
  return v ? decodeEntities(v) : null;
}

function intTag(block: string, name: string): number {
  const v = tag(block, name);
  const n = v == null ? NaN : parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

/** The API returns the literal 18-char empty envelope for misses. */
export function isEmptyEnvelope(text: string): boolean {
  return sliceEnvelope(text).replace(/\s+/g, '') === '<games></games>';
}

/** Cut everything after </games> (Cloudflare script ride-alongs etc.). */
export function sliceEnvelope(text: string): string {
  const end = text.lastIndexOf('</games>');
  return end === -1 ? text : text.slice(0, end + '</games>'.length);
}

/** Parse a games.php response into typed per-platform entries. */
export function parseCooptimusResponse(text: string): CooptimusEntry[] {
  const xml = sliceEnvelope(text);
  const entries: CooptimusEntry[] = [];
  for (const [, block] of xml.matchAll(/<game>([\s\S]*?)<\/game>/g)) {
    const id = intTag(block, 'id');
    const title = tag(block, 'title');
    const system = tag(block, 'system');
    if (!id || !title || !system) continue;
    const steamRaw = intTag(block, 'steam');
    entries.push({
      id,
      title,
      system,
      steam: steamRaw > 0 ? steamRaw : null,
      online: intTag(block, 'online'),
      local: intTag(block, 'local'),
      lan: intTag(block, 'lan'),
      splitscreen: intTag(block, 'splitscreen') === 1,
      dropInDropOut: intTag(block, 'dropindropout') === 1,
      campaign: intTag(block, 'campaign') === 1,
      featurelist: tag(block, 'featurelist'),
      coopExperience: tag(block, 'coopexp'),
      description: tag(block, 'background'),
      url: tag(block, 'url'),
    });
  }
  return entries;
}
