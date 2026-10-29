/**
 * The media-registry scanners for the hub-ownership guard, split out of
 * `hub-registration-scan.ts` (at its size limit): ROK-2027 `media-subject`
 * and ROK-1959 D-6 `media-gate`. For the gate scan:
 * Every `this.<field>.register(owner, source, gate)` on a field typed
 * `HubMediaSourceGateRegistry` → `owner/media-gate/<source>`. Matching the
 * receiver (not any `.register(`) keeps a file that also registers a media
 * subject or decorator from being double-counted.
 */
import {
  resolveExpr,
  type ScanContext,
  type ScanSource,
} from './hub-registration-scan';

type Found = { key?: string; problem?: string };

const REGISTRY = 'HubMediaSourceGateRegistry';

/** Field names typed as the gate registry in one source (ctor params or properties). */
function gateFields(src: ScanSource): string[] {
  const re = new RegExp(`(\\w+)\\??:\\s*${REGISTRY}\\b`, 'g');
  return [...src.text.matchAll(re)].flatMap((m) => (m[1] ? [m[1]] : []));
}

/** One file's gate registrations, resolved through the guard's constants. */
function gatesIn(
  src: ScanSource,
  all: readonly ScanSource[],
  ctx: ScanContext,
): Found[] {
  return gateFields(src).flatMap((field) => {
    const re = new RegExp(
      `this\\.${field}\\.register\\(\\s*([\\w.']+)\\s*,\\s*([\\w.'-]+)\\s*,`,
      'g',
    );
    return [...src.text.matchAll(re)].map((m): Found => {
      const owner = resolveExpr(m[1] ?? '', src, all, ctx.constants);
      const source = resolveExpr(m[2] ?? '', src, all, ctx.constants);
      if (owner === undefined || source === undefined) {
        return {
          problem: `${src.file}: media gate owner "${m[1] ?? ''}" / source "${m[2] ?? ''}" is unresolvable`,
        };
      }
      return { key: `${owner}/media-gate/${source}` };
    });
  });
}

/** Every live `HubMediaSourceGateRegistry` registration outside the registry's own file. */
export function mediaSourceGates(
  all: readonly ScanSource[],
  ctx: ScanContext,
): Found[] {
  return all
    .filter(
      (s) =>
        s.text.includes(REGISTRY) &&
        !s.file.startsWith('hub-media/hub-media.source-gates'),
    )
    .flatMap((src) => gatesIn(src, all, ctx));
}

/** ROK-2027 — every `HubMediaSubjectRegistry` `.register(owner, 'namespace', fn)` call. */
export function mediaSubjects(
  all: readonly ScanSource[],
  ctx: ScanContext,
): Found[] {
  const re = /\.register\(\s*([\w.']+)\s*,\s*([\w.'-]+)\s*,/g;
  return all
    .filter(
      (s) =>
        s.text.includes('HubMediaSubjectRegistry') &&
        !s.file.startsWith('hub-media/hub-media.subjects'),
    )
    .flatMap((src) =>
      [...src.text.matchAll(re)].map((m): Found => {
        const owner = resolveExpr(m[1] ?? '', src, all, ctx.constants);
        const ns = resolveExpr(m[2] ?? '', src, all, ctx.constants);
        if (owner === undefined || ns === undefined) {
          return {
            problem: `${src.file}: media subject owner "${m[1] ?? ''}" / namespace "${m[2] ?? ''}" is unresolvable`,
          };
        }
        return { key: `${owner}/media-subject/${ns}` };
      }),
    );
}
