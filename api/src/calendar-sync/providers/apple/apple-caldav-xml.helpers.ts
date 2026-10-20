/**
 * ROK-1598 (spec §2.2, D3): CalDAV request bodies and multistatus parsing.
 *
 * Request bodies are hand-built constants (a unit spec pins the exact
 * strings). Responses parse with `fast-xml-parser`: `removeNSPrefix` makes
 * `D:` / `d:` / default-namespace replies identical, and `processEntities:
 * false` means no DOCTYPE entity is ever expanded (no XXE, no entity bomb) —
 * text is decoded here, for the five predefined entities and numeric
 * references only. Every href is resolved against the responding URL and
 * re-checked against the iCloud host allowlist (D2).
 */
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { TransientError } from '../calendar-provider.errors';
import { isAllowedCalDavUrl } from './apple-caldav-http';

const XML_DECL = '<?xml version="1.0" encoding="utf-8"?>';
const NS_D = 'xmlns:d="DAV:"';
const NS_C = 'xmlns:c="urn:ietf:params:xml:ns:caldav"';
const NS_CS = 'xmlns:cs="http://calendarserver.org/ns/"';

const propfind = (ns: string, props: string): string =>
  `${XML_DECL}<d:propfind ${ns}><d:prop>${props}</d:prop></d:propfind>`;

export const PROPFIND_PRINCIPAL = propfind(NS_D, '<d:current-user-principal/>');

export const PROPFIND_HOME_SET = propfind(
  `${NS_D} ${NS_C}`,
  '<c:calendar-home-set/>',
);

/** D9: everything `listCalendars` needs, in one Depth-1 PROPFIND. */
export const PROPFIND_COLLECTIONS = propfind(
  `${NS_D} ${NS_C} ${NS_CS}`,
  '<d:resourcetype/><d:displayname/><c:supported-calendar-component-set/>' +
    '<cs:getctag/><d:current-user-privilege-set/><c:calendar-timezone/>',
);

export const PROPFIND_ETAG = propfind(NS_D, '<d:getetag/>');

/** Escape text for an XML element body. */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** MKCALENDAR body: a VEVENT-only calendar named `displayName`. */
export function mkcalendarBody(displayName: string): string {
  return (
    `${XML_DECL}<c:mkcalendar ${NS_D} ${NS_C}><d:set><d:prop>` +
    `<d:displayname>${escapeXml(displayName)}</d:displayname>` +
    '<c:supported-calendar-component-set><c:comp name="VEVENT"/>' +
    '</c:supported-calendar-component-set></d:prop></d:set></c:mkcalendar>'
  );
}

/** `2026-10-20T19:00:00.000Z` → `20261020T190000Z`. */
export function toIcalUtc(date: Date): string {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '');
}

/** REPORT calendar-query: VEVENTs overlapping the range. No `<c:expand>` (D4). */
export function calendarQueryBody(range: { start: Date; end: Date }): string {
  return (
    `${XML_DECL}<c:calendar-query ${NS_D} ${NS_C}>` +
    '<d:prop><d:getetag/><c:calendar-data/></d:prop>' +
    '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">' +
    `<c:time-range start="${toIcalUtc(range.start)}" end="${toIcalUtc(range.end)}"/>` +
    '</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>'
  );
}

/** A parsed XML element: child names (namespace stripped) → values. */
export type XmlNode = Record<string, unknown>;

export interface CalDavPropStat {
  /** HTTP status from the `status` line (`0` when unreadable). */
  status: number;
  props: XmlNode;
}

export interface CalDavResponse {
  href: string;
  propstats: CalDavPropStat[];
}

export interface MultiStatus {
  responses: CalDavResponse[];
}

export interface CalDavCollection {
  /** Last path segment under the home set (D8). */
  id: string;
  href: string;
  displayName: string;
  components: string[];
  ctag: string | null;
  writable: boolean;
  timezone: string | null;
}

export interface CalDavObject {
  href: string;
  etag: string | null;
  ics: string;
}

const ARRAY_TAGS = new Set(['response', 'propstat', 'comp', 'privilege']);

const parser = new XMLParser({
  removeNSPrefix: true,
  processEntities: false,
  ignoreAttributes: false,
  parseTagValue: false,
  parseAttributeValue: false,
  cdataPropName: '__cdata',
  isArray: (name: string) => ARRAY_TAGS.has(name),
});

const isNode = (v: unknown): v is XmlNode =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const asArray = (v: unknown): unknown[] =>
  Array.isArray(v) ? v : v === undefined ? [] : [v];

const ENTITY = /&(?:#(\d{1,7})|#x([0-9a-fA-F]{1,6})|(lt|gt|quot|apos|amp));/g;
const NAMED: Record<string, string> = {
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  amp: '&',
};

/** Decode predefined + numeric entities in one pass (`&amp;lt;` → `&lt;`). */
export function decodeXmlText(text: string): string {
  return text.replace(
    ENTITY,
    (whole: string, dec?: string, hex?: string, name?: string) => {
      if (name) return NAMED[name] ?? whole;
      const cp = dec ? Number(dec) : parseInt(hex ?? '', 16);
      return Number.isInteger(cp) && cp > 0 && cp <= 0x10ffff
        ? String.fromCodePoint(cp)
        : whole;
    },
  );
}

/** Text content of an element (entity-decoded; CDATA kept verbatim). */
export function textOf(v: unknown): string | null {
  if (typeof v === 'string') return decodeXmlText(v);
  if (!isNode(v)) return null;
  const raw = v['#text'];
  const text = typeof raw === 'string' ? decodeXmlText(raw) : '';
  const cdata = typeof v['__cdata'] === 'string' ? v['__cdata'] : '';
  return text || cdata ? text + cdata : null;
}

/** Parse a 207 body. Malformed or non-multistatus XML → `TransientError`. */
export function parseMultiStatus(xml: string): MultiStatus {
  if (!xml.trim() || XMLValidator.validate(xml) !== true) {
    throw new TransientError('caldav_xml');
  }
  const doc: unknown = parser.parse(xml);
  const root = isNode(doc) ? doc['multistatus'] : undefined;
  if (root === '') return { responses: [] };
  if (!isNode(root)) throw new TransientError('caldav_xml');
  return {
    responses: asArray(root['response']).filter(isNode).map(toResponse),
  };
}

function toResponse(node: XmlNode): CalDavResponse {
  const propstats = asArray(node['propstat'])
    .filter(isNode)
    .map((ps) => ({
      status: statusCode(textOf(ps['status'])),
      props: isNode(ps['prop']) ? ps['prop'] : {},
    }));
  if (propstats.length === 0 && node['status'] !== undefined) {
    propstats.push({ status: statusCode(textOf(node['status'])), props: {} });
  }
  return { href: textOf(asArray(node['href'])[0]) ?? '', propstats };
}

function statusCode(line: string | null): number {
  const m = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(line ?? '');
  return m?.[1] ? Number(m[1]) : 0;
}

/** Props of every `200` propstat, merged; `404` propstats are ignored. */
export function okProps(r: CalDavResponse): XmlNode {
  return r.propstats
    .filter((p) => p.status === 200)
    .reduce<XmlNode>((acc, p) => ({ ...acc, ...p.props }), {});
}

/** Resolve `href` against `base`; refuse anything off the iCloud allowlist. */
export function resolveHref(href: string, base: string): string {
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    throw new TransientError('caldav_href');
  }
  if (!isAllowedCalDavUrl(url.href)) throw new TransientError('href_refused');
  return url.href;
}

function nestedHref(ms: MultiStatus, key: string, base: string) {
  for (const r of ms.responses) {
    const prop = okProps(r)[key];
    const href = isNode(prop) ? textOf(asArray(prop['href'])[0]) : null;
    if (href) return resolveHref(href, base);
  }
  return null;
}

/** `current-user-principal` as an absolute URL, or null. */
export const principalHref = (ms: MultiStatus, base: string) =>
  nestedHref(ms, 'current-user-principal', base);

/** `calendar-home-set` as an absolute URL, or null. */
export const homeSetHref = (ms: MultiStatus, base: string) =>
  nestedHref(ms, 'calendar-home-set', base);

/** The first `getetag` in the reply, or null. */
export function firstEtag(ms: MultiStatus): string | null {
  for (const r of ms.responses) {
    const etag = textOf(okProps(r)['getetag']);
    if (etag) return etag;
  }
  return null;
}

const COLLECTION_ID = /^[A-Za-z0-9._~%-]{1,200}$/;
const stripSlash = (href: string) => href.replace(/\/+$/, '');

/** D9: VEVENT calendars from a Depth-1 home-set listing. */
export function toCollections(
  ms: MultiStatus,
  homeSetUrl: string,
): CalDavCollection[] {
  const home = stripSlash(new URL(homeSetUrl).href);
  const out: CalDavCollection[] = [];
  for (const r of ms.responses) {
    const href = resolveHref(r.href, homeSetUrl);
    const c = stripSlash(href) === home ? null : toCollection(href, okProps(r));
    if (c) out.push(c);
  }
  return out;
}

function toCollection(href: string, props: XmlNode): CalDavCollection | null {
  const type = props['resourcetype'];
  if (!isNode(type) || !('calendar' in type) || 'subscribed' in type) {
    return null;
  }
  const set = props['supported-calendar-component-set'];
  const components = asArray(isNode(set) ? set['comp'] : undefined)
    .map((c) => (isNode(c) ? c['@_name'] : undefined))
    .filter((n): n is string => typeof n === 'string');
  const id = new URL(href).pathname.split('/').filter(Boolean).at(-1);
  if (!id || !COLLECTION_ID.test(id) || !components.includes('VEVENT')) {
    return null;
  }
  return {
    id,
    href,
    displayName: textOf(props['displayname']) || id,
    components,
    ctag: textOf(props['getctag']),
    writable: isWritable(props['current-user-privilege-set']),
    timezone: textOf(props['calendar-timezone']),
  };
}

/** D9: `write` / `write-content` (or `all`) grants writing; absent → true. */
function isWritable(set: unknown): boolean {
  if (set === undefined) return true;
  return asArray(isNode(set) ? set['privilege'] : undefined)
    .filter(isNode)
    .some((p) => 'write' in p || 'write-content' in p || 'all' in p);
}

/** calendar-query results: `200` propstats carrying calendar-data only. */
export function toCalendarObjects(
  ms: MultiStatus,
  base: string,
): CalDavObject[] {
  const out: CalDavObject[] = [];
  for (const r of ms.responses) {
    const props = okProps(r);
    const ics = textOf(props['calendar-data']);
    if (!ics) continue;
    const etag = textOf(props['getetag']);
    out.push({ href: resolveHref(r.href, base), etag, ics });
  }
  return out;
}
