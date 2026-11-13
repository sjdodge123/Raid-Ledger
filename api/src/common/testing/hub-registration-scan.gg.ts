/**
 * ROK-2187 — the `gg-card` scanner for the hub-ownership guard, split out of
 * `hub-registration-scan.ts` (at its size limit). Every
 * `this.<field>.register(owner, card, …)` on a field typed `GgCardRegistry`
 * → `owner/gg-card/<card>`. Matching the receiver (as the media-gate scan
 * does) keeps a file that also registers another kind from double-counting.
 */
import {
  resolveExpr,
  type ScanContext,
  type ScanSource,
} from './hub-registration-scan';

type Found = { key?: string; problem?: string };

const REGISTRY = 'GgCardRegistry';

/** Field names typed as the GG card registry in one source. */
function registryFields(src: ScanSource): string[] {
  const re = new RegExp(`(\\w+)\\??:\\s*${REGISTRY}\\b`, 'g');
  return [...src.text.matchAll(re)].flatMap((m) => (m[1] ? [m[1]] : []));
}

/** One file's GG card registrations, resolved through the guard's constants. */
function cardsIn(
  src: ScanSource,
  all: readonly ScanSource[],
  ctx: ScanContext,
): Found[] {
  return registryFields(src).flatMap((field) => {
    const re = new RegExp(
      `this\\.${field}\\.register\\(\\s*([\\w.']+)\\s*,\\s*([\\w.'-]+)\\s*,`,
      'g',
    );
    return [...src.text.matchAll(re)].map((m): Found => {
      const owner = resolveExpr(m[1] ?? '', src, all, ctx.constants);
      const card = resolveExpr(m[2] ?? '', src, all, ctx.constants);
      if (owner === undefined || card === undefined) {
        return {
          problem: `${src.file}: GG card owner "${m[1] ?? ''}" / card "${m[2] ?? ''}" is unresolvable`,
        };
      }
      return { key: `${owner}/gg-card/${card}` };
    });
  });
}

/** Every live `GgCardRegistry` registration outside the registry's own file. */
export function ggCards(all: readonly ScanSource[], ctx: ScanContext): Found[] {
  return all
    .filter(
      (s) =>
        s.text.includes(REGISTRY) &&
        !s.file.startsWith('plugins/core/gg/gg-card.registry'),
    )
    .flatMap((src) => cardsIn(src, all, ctx));
}
