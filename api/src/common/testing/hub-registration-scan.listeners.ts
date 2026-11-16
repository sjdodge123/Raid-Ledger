/**
 * ROK-2226 — the event-lifecycle listener scanner for the hub-ownership guard
 * (split out: `hub-registration-scan.ts` is at its size limit). A plain
 * `@OnEvent(APP_EVENT_EVENTS.*)` class is a hub behaviour of kind
 * `event-tagger` when it declares `readonly hubBehaviour = '<id>'` and
 * `readonly ownerPluginId = <owner>` → `owner/event-tagger/<id>`. Declaring
 * only one of the two, or either without a lifecycle `@OnEvent`, is a problem.
 * Classes with neither field are not hub behaviours (discord-bot, etc.).
 */
import {
  resolveExpr,
  type ScanContext,
  type ScanSource,
} from './hub-registration-scan';

type Found = { key?: string; problem?: string };

const BEHAVIOUR = /readonly hubBehaviour(?::\s*\w+)?\s*=\s*([\w.']+)/;
const OWNER = /readonly ownerPluginId(?::\s*\w+)?\s*=\s*([\w.']+)/;
const LIFECYCLE = /@OnEvent\(\s*APP_EVENT_EVENTS\./;

/** One source's declared listener behaviour, if it declares one. */
function listenerIn(
  src: ScanSource,
  all: readonly ScanSource[],
  ctx: ScanContext,
): Found | undefined {
  const idExpr = BEHAVIOUR.exec(src.text)?.[1];
  const ownerSrc = OWNER.exec(src.text)?.[1];
  if (idExpr === undefined) return undefined;
  const id = resolveExpr(idExpr, src, all, ctx.constants);
  const owner =
    ownerSrc === undefined
      ? undefined
      : resolveExpr(ownerSrc, src, all, ctx.constants);
  if (id === undefined || owner === undefined || !LIFECYCLE.test(src.text)) {
    return {
      problem: `${src.file}: event listener behaviour "${idExpr}" — needs a resolvable ownerPluginId and an @OnEvent(APP_EVENT_EVENTS.*) handler`,
    };
  }
  return { key: `${owner}/event-tagger/${id}` };
}

/** Every declared event-lifecycle listener behaviour. */
export function eventListeners(
  all: readonly ScanSource[],
  ctx: ScanContext,
): Found[] {
  return all.flatMap((src) => listenerIn(src, all, ctx) ?? []);
}
