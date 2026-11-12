/**
 * ROK-2187 — the GG card registry: plugins register producers per card, the
 * registry runs only active plugins' producers, validates every payload with
 * its contract schema, and returns the envelopes in story order.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../../drizzle/schema';
import type { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import {
  GG_PLUGIN_CARD_ORDER_BASE,
  GgCardRegistry,
  ggCoreCardOrder,
  type GgCardContext,
} from './gg-card.registry';

const VALHEIM_CARD = { characters: 1, deaths: 3, skillGains: [] };

function registryWith(active: readonly string[]): GgCardRegistry {
  const plugins: Pick<PluginRegistryService, 'isActive'> = {
    isActive: (slug: string) => active.includes(slug),
  };
  return new GgCardRegistry(plugins as PluginRegistryService);
}

const ctx: GgCardContext = {
  db: {} as PostgresJsDatabase<typeof schema>,
  userId: 7,
  year: 2026,
  window: {
    start: new Date('2026-01-01T05:00:00Z'),
    end: new Date('2027-01-01T05:00:00Z'),
  },
  tz: 'America/New_York',
};

describe('GgCardRegistry (ROK-2187)', () => {
  it('returns each active producer’s valid card, sorted by order', async () => {
    const r = registryWith(['core', 'valheim']);
    r.register(
      'valheim',
      'valheim-year',
      () => Promise.resolve(VALHEIM_CARD),
      GG_PLUGIN_CARD_ORDER_BASE,
    );
    r.register(
      'core',
      'voice',
      () => Promise.resolve({ totalSeconds: 60, sessions: 1 }),
      ggCoreCardOrder('voice'),
    );
    const cards = await r.produceAll(ctx);
    expect(cards).toEqual([
      {
        pluginSlug: 'core',
        cardId: 'voice',
        order: 800,
        payload: { totalSeconds: 60, sessions: 1 },
      },
      {
        pluginSlug: 'valheim',
        cardId: 'valheim-year',
        order: 1100,
        payload: VALHEIM_CARD,
      },
    ]);
  });

  it('never runs the producer of an inactive plugin', async () => {
    const r = registryWith(['core']);
    const producer = jest.fn(() => Promise.resolve(VALHEIM_CARD));
    r.register('valheim', 'valheim-year', producer, GG_PLUGIN_CARD_ORDER_BASE);
    expect(await r.produceAll(ctx)).toEqual([]);
    expect(producer).not.toHaveBeenCalled();
  });

  it('passes the context through and omits a card whose producer returns null', async () => {
    const r = registryWith(['valheim']);
    const producer = jest.fn(() => Promise.resolve(null));
    r.register('valheim', 'valheim-year', producer, GG_PLUGIN_CARD_ORDER_BASE);
    expect(await r.produceAll(ctx)).toEqual([]);
    expect(producer).toHaveBeenCalledWith(ctx);
  });

  it('skips a payload that fails its schema, and a card nobody declared', async () => {
    const r = registryWith(['valheim']);
    r.register(
      'valheim',
      'valheim-year',
      () => Promise.resolve({ deaths: -1 }),
      1100,
    );
    r.register('valheim', 'stray', () => Promise.resolve({}), 1101);
    expect(await r.produceAll(ctx)).toEqual([]);
  });

  it('a throwing producer drops only its own card', async () => {
    const r = registryWith(['core', 'valheim']);
    r.register(
      'valheim',
      'valheim-year',
      () => Promise.reject(new Error('boom')),
      1100,
    );
    r.register(
      'core',
      'hubs',
      () => Promise.resolve({ joined: 1, posts: 0, pictures: 0 }),
      ggCoreCardOrder('hubs'),
    );
    expect((await r.produceAll(ctx)).map((c) => c.cardId)).toEqual(['hubs']);
  });
});

describe('GgCardRegistry registration rules (ROK-2187)', () => {
  it('refuses a second producer for the same owner and card', () => {
    const r = registryWith([]);
    r.register('core', 'intro', () => Promise.resolve(null), 100);
    expect(() =>
      r.register('core', 'intro', () => Promise.resolve(null), 100),
    ).toThrow('GG card "core/intro" is already registered');
  });

  it('orders core cards around the plugin band (spec §Web card order)', () => {
    expect(ggCoreCardOrder('intro')).toBe(100);
    expect(ggCoreCardOrder('hubs')).toBe(1000);
    expect(ggCoreCardOrder('hubs')).toBeLessThan(GG_PLUGIN_CARD_ORDER_BASE);
    expect(ggCoreCardOrder('superlative')).toBe(1200);
    expect(ggCoreCardOrder('summary')).toBe(1300);
  });
});
