/**
 * ROK-2129 L2 (spec D9 / F4): ID parity between the user account summary's
 * Forever characters and the realmless character route (app token). Names
 * and ids live in memory only; the output is counts.
 */
import type { BnetProbeIdParity, BnetProbeRegion } from '@raid-ledger/contract';
import { buildRealmlessCharName } from './blizzard-character-path.helpers';
import { buildProfileUrl } from './forever-namespace-probe.forever';
import { callBnet, type BnetFetch } from './bnet-account-probe.oauth';

/** At most this many realmless lookups per callback (spec D9). */
export const BNET_PROBE_PARITY_CAP = 10;

const CHARACTER_PATH = '/profile/wow/character/';
const BLIZZARD_API_HOST = /^[a-z]{2}\.api\.blizzard\.com$/;

/** One character to check: its summary id and the slug to look it up by. */
export interface ParityTarget {
  id: unknown;
  slug: string | null;
  via: 'href' | 'name';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function hrefOf(char: Record<string, unknown>): unknown {
  const nested = isRecord(char.character) ? char.character : char.key;
  return isRecord(nested) ? nested.href : undefined;
}

/** The realmless slug from a Blizzard href (host-checked), else null. */
export function realmlessSlugFromHref(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  try {
    const url = new URL(href);
    if (url.protocol !== 'https:' || !BLIZZARD_API_HOST.test(url.hostname)) {
      return null;
    }
    if (!url.pathname.startsWith(CHARACTER_PATH)) return null;
    const rest = url.pathname.slice(CHARACTER_PATH.length);
    return rest.length > 0 && !rest.includes('/') ? rest : null;
  } catch {
    return null;
  }
}

function nameSlug(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  try {
    return buildRealmlessCharName(name);
  } catch {
    return null;
  }
}

function toTarget(char: Record<string, unknown>): ParityTarget {
  const fromHref = realmlessSlugFromHref(hrefOf(char));
  if (fromHref !== null) return { id: char.id, slug: fromHref, via: 'href' };
  return { id: char.id, slug: nameSlug(char.name), via: 'name' };
}

/** Every character object in an account summary body (malformed = none). */
export function parityTargets(body: unknown): ParityTarget[] {
  if (!isRecord(body) || !Array.isArray(body.wow_accounts)) return [];
  const out: ParityTarget[] = [];
  for (const account of body.wow_accounts) {
    if (!isRecord(account) || !Array.isArray(account.characters)) continue;
    for (const char of account.characters) {
      if (isRecord(char)) out.push(toTarget(char));
    }
  }
  return out;
}

type Outcome = 'matched' | 'mismatched' | 'notFound' | 'errors';

async function checkOne(
  fetchFn: BnetFetch,
  target: ParityTarget,
  ctx: { region: BnetProbeRegion; prefix: string; appToken: string },
): Promise<Outcome> {
  if (target.slug === null) return 'errors';
  const url = buildProfileUrl(target.slug, ctx.prefix, ctx.region);
  const res = await callBnet(fetchFn, url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${ctx.appToken}` },
  });
  if (res.status === 404) return 'notFound';
  if (res.status !== 200 || !isRecord(res.body)) return 'errors';
  return res.body.id === target.id ? 'matched' : 'mismatched';
}

/** Sequentially check up to {@link BNET_PROBE_PARITY_CAP} characters. */
export async function runIdParity(
  fetchFn: BnetFetch,
  body: unknown,
  ctx: { region: BnetProbeRegion; prefix: string; appToken: string },
): Promise<BnetProbeIdParity> {
  const targets = parityTargets(body).slice(0, BNET_PROBE_PARITY_CAP);
  const out: BnetProbeIdParity = {
    checked: targets.length,
    matched: 0,
    mismatched: 0,
    notFound: 0,
    errors: 0,
    viaHref: 0,
    viaName: 0,
  };
  for (const target of targets) {
    out[target.via === 'href' ? 'viaHref' : 'viaName'] += 1;
    out[await checkOne(fetchFn, target, ctx)] += 1;
  }
  return out;
}
