/**
 * ROK-2226 — the event-lifecycle listener scanner for the hub-ownership guard
 * (split out: `hub-registration-scan.ts` is at its size limit). A plain
 * `@OnEvent(APP_EVENT_EVENTS.*)` class is a hub behaviour of kind
 * `event-tagger` when it declares `readonly hubBehaviour = '<id>'` and
 * `readonly ownerPluginId = <owner>` → `owner/event-tagger/<id>`. Declaring
 * only one of the two, or either without a lifecycle `@OnEvent`, is a problem.
 * Classes with neither field are not hub behaviours (discord-bot, etc.).
 *
 * ROK-2208 — a listener of another kind (the forum ↔ Discord sync listens to
 * `HUB_FORUM_CHANGED` and bot events) also declares
 * `readonly hubBehaviourKind = '<kind>'` → `owner/<kind>/<id>`. The kind must
 * be one this guard scans and the class needs an `@OnEvent` handler; a
 * kind-less declaration keeps the strict event-tagger rule above.
 */
import type { HubBehaviourKind } from '@raid-ledger/contract';
import {
  SCANNED_KINDS,
  resolveExpr,
  type ScanContext,
  type ScanSource,
} from './hub-registration-scan';

type Found = { key?: string; problem?: string };

const EXPR = String.raw`('[^']*'|[\w.]+)`;
const field = (name: string): RegExp =>
  new RegExp(String.raw`readonly ${name}(?::\s*\w+)?\s*=\s*` + EXPR);
const BEHAVIOUR = field('hubBehaviour');
const KIND = field('hubBehaviourKind');
const OWNER = field('ownerPluginId');
const LIFECYCLE = /@OnEvent\(\s*APP_EVENT_EVENTS\./;
const ANY_HANDLER = /@OnEvent\(/;

/** `kindExpr` resolved to a kind this guard scans, else undefined. */
function scannedKind(kindExpr: string): HubBehaviourKind | undefined {
  const raw = /^'([^']*)'$/.exec(kindExpr)?.[1];
  return SCANNED_KINDS.find((k) => k === raw);
}

/** A listener that names its kind (ROK-2208): any `@OnEvent` handler. */
function kindedListener(
  src: ScanSource,
  idExpr: string,
  kindExpr: string,
  resolved: { id: string | undefined; owner: string | undefined },
): Found {
  const kind = scannedKind(kindExpr);
  const { id, owner } = resolved;
  if (!kind || !id || !owner || !ANY_HANDLER.test(src.text)) {
    return {
      problem: `${src.file}: listener behaviour "${idExpr}" of kind "${kindExpr}" — needs a resolvable ownerPluginId, a scanned hubBehaviourKind and an @OnEvent handler`,
    };
  }
  return { key: `${owner}/${kind}/${id}` };
}

/** One source's declared listener behaviour, if it declares one. */
function listenerIn(
  src: ScanSource,
  all: readonly ScanSource[],
  ctx: ScanContext,
): Found | undefined {
  const idExpr = BEHAVIOUR.exec(src.text)?.[1];
  if (idExpr === undefined) return undefined;
  const ownerSrc = OWNER.exec(src.text)?.[1];
  const id = resolveExpr(idExpr, src, all, ctx.constants);
  const owner =
    ownerSrc === undefined
      ? undefined
      : resolveExpr(ownerSrc, src, all, ctx.constants);
  const kindExpr = KIND.exec(src.text)?.[1];
  if (kindExpr !== undefined) {
    return kindedListener(src, idExpr, kindExpr, { id, owner });
  }
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
