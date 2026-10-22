import type { ValheimRecipeResource } from '@raid-ledger/contract';

/**
 * ROK-1894 — which per-quality cost rule a recipes set follows (CONTRACT
 * §5b): `v0` = Valheim 0.221.x (0.221.4 IL), `v1` = Valheim 1.0.x
 * (measured on 1.0.20: upgrade items every step, ×2 per level from q3).
 */
export type ValheimCostRule = 'v0' | 'v1';

/** `v1` for a `gameVersion` whose major part is ≥ 1; anything else keeps `v0`. */
export function costRuleFor(
  gameVersion: string | null | undefined,
): ValheimCostRule {
  const major = Number.parseInt((gameVersion ?? '').split('.')[0] ?? '', 10);
  return Number.isFinite(major) && major >= 1 ? 'v1' : 'v0';
}

/**
 * §5b `amount(r, q)`. `v0`: `q ≤ 1 ? amount : (q − 1) · amountPerLevel`.
 * `v1`: an upgrade item (`upgraderResource`) costs `amount` at every step;
 * any other resource `amount` at q1, then `amountPerLevel · 2^(q − 2)`.
 */
export function amountAt(
  r: ValheimRecipeResource,
  q: number,
  rule: ValheimCostRule = 'v0',
): number {
  if (q <= 1) return r.amount;
  if (rule === 'v0') return (q - 1) * r.amountPerLevel;
  if (r.upgraderResource) return r.amount;
  return r.amountPerLevel * 2 ** (q - 2);
}
