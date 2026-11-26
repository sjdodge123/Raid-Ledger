/**
 * ROK-2365 — plugin-scope guard, handler half. In a scoped plugin folder
 * (`scopedFolder`) every `@OnEvent` method, every `@Processor` class's
 * `process()`, and every Discord `interactionCreate` / `messageCreate`
 * callback must contain an active check (`getActiveSlugsSync(` /
 * `isActive(`) — in its own body or in a same-class method it calls directly
 * (`this.x(`, one level) — or carry the `// plugin-scope: cleanup` marker in
 * its body, only where it is genuinely withdrawal cleanup. Anything else must
 * sit in the guard's allowlist with a reason (`gap:` for a real gap).
 *
 * Takes RAW sources (the marker is a comment); each body is comment-stripped
 * before the active-check test, so a commented-out check never counts.
 */
import type { ScanSource } from './hub-registration-scan';
import {
  reasonProblems,
  scopedFolder,
  type ScopeAllowlist,
} from './hub-registration-scan.scope';
import { stripComments } from './strip-comments';

export const CLEANUP_MARKER = '// plugin-scope: cleanup';
const ACTIVE_CHECK = /\b(getActiveSlugsSync|isActive)\s*\(/;
const MEMBER =
  /^\s*(?:(?:public|private|protected|static|async)\s+)*(\w+)\s*[(<]/;
const DISCORD =
  /(?:gatewayBinding\(\s*|\.on\(\s*)(?:'(interactionCreate|messageCreate)'|Events\.(InteractionCreate|MessageCreate))/g;

/** One handler: `<file>#<name>`, its raw body, and the raw class text. */
export interface HandlerSite {
  key: string;
  body: string;
  classText: string;
}

/** Index of the bracket closing the `open` char at `from` (or text end). */
function closeOf(
  text: string,
  from: number,
  open: string,
  close: string,
): number {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === open) depth += 1;
    if (text[i] === close && (depth -= 1) === 0) return i;
  }
  return text.length;
}

/** The `{ … }` body of the member whose parameter list starts at/after `from`. */
function bodyAfter(text: string, from: number): string {
  const params = text.indexOf('(', from);
  const open = text.indexOf('{', closeOf(text, params, '(', ')'));
  if (params < 0 || open < 0) return '';
  return text.slice(open, closeOf(text, open, '{', '}') + 1);
}

/** The body of method `name` in `text`, or '' when not found. */
function methodBody(text: string, name: string): string {
  const re = new RegExp(
    String.raw`^[ \t]*(?:(?:public|private|protected|static|async)\s+)*${name}\s*[(<]`,
    'm',
  );
  const m = re.exec(text);
  return m === null ? '' : bodyAfter(text, m.index + m[0].length - 1);
}

/** The member a decorator at `at` sits on: its name and its body. */
function decoratedMember(
  text: string,
  at: number,
): { name: string; body: string } {
  let depth = 0;
  let pos = at;
  for (const line of text.slice(at).split('\n')) {
    const member =
      depth === 0 && !/^\s*@/.test(line) ? MEMBER.exec(line) : null;
    if (member !== null) {
      return { name: member[1] ?? '', body: bodyAfter(text, pos) };
    }
    depth +=
      (line.match(/\(/g) ?? []).length - (line.match(/\)/g) ?? []).length;
    pos += line.length + 1;
  }
  return { name: '', body: '' };
}

/** Every `@OnEvent` method and `@Processor` `process()` in one raw source. */
function decoratedHandlers(src: ScanSource): HandlerSite[] {
  const onEvents = [...src.text.matchAll(/^\s*@OnEvent\(/gm)].map((m) => {
    const { name, body } = decoratedMember(src.text, m.index ?? 0);
    return { key: `${src.file}#${name}`, body, classText: src.text };
  });
  const processors = [...src.text.matchAll(/^@Processor\(/gm)].flatMap(() => {
    const cls = /class (\w+)/.exec(src.text)?.[1] ?? '?';
    const body = methodBody(src.text, 'process');
    return [{ key: `${src.file}#${cls}.process`, body, classText: src.text }];
  });
  return [...onEvents, ...processors];
}

/** Every Discord interaction / message callback in one raw source. */
function discordHandlers(src: ScanSource): HandlerSite[] {
  return [...src.text.matchAll(DISCORD)].map((m, i) => {
    const at = m.index ?? 0;
    const call = src.text.slice(at, closeOf(src.text, at, '(', ')') + 1);
    const event = m[1] ?? m[2] ?? 'discord';
    return {
      key: `${src.file}#${event}[${i}]`,
      body: call,
      classText: src.text,
    };
  });
}

/** Every handler in the scoped plugin folders of `rawSources`. */
export function scopedHandlers(
  rawSources: readonly ScanSource[],
): HandlerSite[] {
  return rawSources
    .filter((s) => scopedFolder(s.file) !== undefined)
    .flatMap((s) => [...decoratedHandlers(s), ...discordHandlers(s)]);
}

/** Active check in the body or a same-class method it calls; or the cleanup marker. */
export function isScopeChecked(site: HandlerSite): boolean {
  if (site.body.includes(CLEANUP_MARKER)) return true;
  const body = stripComments(site.body);
  if (ACTIVE_CHECK.test(body)) return true;
  return [...body.matchAll(/\bthis\.(\w+)\s*\(/g)].some((m) =>
    ACTIVE_CHECK.test(stripComments(methodBody(site.classText, m[1] ?? ''))),
  );
}

/** Every unchecked, un-allowlisted scoped handler, plus allowlist problems. */
export function handlerScopeViolations(
  rawSources: readonly ScanSource[],
  allow: ScopeAllowlist,
): string[] {
  const sites = scopedHandlers(rawSources);
  const unchecked = sites
    .filter((s) => !isScopeChecked(s) && allow[s.key] === undefined)
    .map(
      (s) =>
        `${s.key} has no active check (getActiveSlugsSync / isActive) or ${CLEANUP_MARKER} marker and is not allowlisted`,
    );
  const stale = Object.entries(allow).flatMap(([key, reason]) => {
    const site = sites.find((s) => s.key === key);
    if (site === undefined)
      return [`${key}: allowlisted but no such scoped handler`];
    if (isScopeChecked(site))
      return [`${key}: allowlisted but already checked — drop it`];
    return reasonProblems(key, reason, site.classText);
  });
  return [...unchecked, ...stale];
}
