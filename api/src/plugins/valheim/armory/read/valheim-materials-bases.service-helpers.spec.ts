/** ROK-1859 — `orderLike`: a base's totals take the shared totals' SQL order. */
import type { ValheimMaterialStack } from '@raid-ledger/contract';
import { orderLike } from './valheim-materials-bases.service-helpers';

const stack = (prefab: string, quality = 1): ValheimMaterialStack => ({
  prefab,
  quality,
  total: 1,
  chests: 1,
});

describe('orderLike', () => {
  it('orders mixed-case prefabs like SQL `ORDER BY prefab, quality` asc, not JS code-point order', () => {
    // Postgres collation puts 'amber' before 'Bronze'; a JS sort puts every capital first.
    const reference = [
      stack('amber'),
      stack('Bronze'),
      stack('Bronze', 2),
      stack('Wood'),
    ];
    const stacks = [
      stack('Wood'),
      stack('Bronze', 2),
      stack('amber'),
      stack('Bronze'),
    ];
    expect(
      orderLike(reference, stacks).map((s) => `${s.prefab}|${s.quality}`),
    ).toEqual(['amber|1', 'Bronze|1', 'Bronze|2', 'Wood|1']);
  });

  it('puts a stack missing from the reference last and leaves the input untouched', () => {
    const stacks = [stack('Zed'), stack('Wood'), stack('amber')];
    const out = orderLike([stack('amber'), stack('Wood')], stacks);
    expect(out.map((s) => s.prefab)).toEqual(['amber', 'Wood', 'Zed']);
    expect(stacks.map((s) => s.prefab)).toEqual(['Zed', 'Wood', 'amber']);
  });
});
