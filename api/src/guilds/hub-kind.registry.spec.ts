/**
 * ROK-1830 S2 — a hub kind registers through `EXTENSION_POINTS.HUB_KIND` and
 * core resolves it by kind, with zero core edits. A kind whose owning plugin
 * is inactive is refused with `PluginActiveGuard`'s 403; unknown ⇒ 404.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { LadderRole } from '@raid-ledger/contract';
import { createDrizzleMock } from '../common/testing/drizzle-mock';
import type * as schema from '../drizzle/schema';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import {
  EXTENSION_POINTS,
  type HubKindAdapter,
} from '../plugins/plugin-host/extension-points';
import { HubKindRegistry } from './hub-kind.registry';

const TEST_PLUGIN = 'test-hub-plugin';

function testHubKind(role: LadderRole): HubKindAdapter {
  return {
    kind: 'game_server',
    pluginSlug: TEST_PLUGIN,
    isMember: (userId) => Promise.resolve(userId === 7),
    resolveLadder: () => Promise.resolve(role),
  };
}

function build(): { plugins: PluginRegistryService; hubs: HubKindRegistry } {
  const db: unknown = createDrizzleMock();
  const plugins = new PluginRegistryService(
    db as PostgresJsDatabase<typeof schema>,
    new EventEmitter2(),
  );
  return { plugins, hubs: new HubKindRegistry(plugins) };
}

describe('HubKindRegistry (ROK-1830)', () => {
  it('resolves a test hub kind registered through HUB_KIND', async () => {
    const { plugins, hubs } = build();
    const adapter = testHubKind('member');
    plugins.registerAdapter(EXTENSION_POINTS.HUB_KIND, adapter.kind, adapter);

    const resolved = hubs.require('game_server');
    expect(resolved).toBe(adapter);
    await expect(resolved.isMember(7, 1)).resolves.toBe(true);
    await expect(
      resolved.resolveLadder({ id: 7, role: 'member' }, 1),
    ).resolves.toBe('member');
  });

  it('does not answer for a kind nobody registered', () => {
    const { plugins, hubs } = build();
    const adapter = testHubKind('member');
    plugins.registerAdapter(EXTENSION_POINTS.HUB_KIND, adapter.kind, adapter);

    expect(hubs.resolve('wow_guild')).toBeUndefined();
    expect(() => hubs.require('wow_guild')).toThrow(
      new NotFoundException('No hub module for kind "wow_guild"'),
    );
  });

  it('refuses a kind whose owning plugin is inactive with a 403', () => {
    const { plugins, hubs } = build();
    const adapter = testHubKind('officer');
    plugins.registerAdapter(EXTENSION_POINTS.HUB_KIND, adapter.kind, adapter, {
      ownerPluginId: TEST_PLUGIN,
    });

    expect(hubs.resolve('game_server')).toBeUndefined();
    expect(() => hubs.require('game_server')).toThrow(
      new ForbiddenException(`Plugin "${TEST_PLUGIN}" is not active`),
    );
  });
});
