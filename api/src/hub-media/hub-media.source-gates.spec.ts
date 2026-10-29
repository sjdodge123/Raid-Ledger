import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { createDrizzleMock } from '../common/testing/drizzle-mock';
import type * as schema from '../drizzle/schema';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { HubMediaSourceGateRegistry } from './hub-media.source-gates';

/** A registry whose plugin gate answers from `active`. */
function setup(active: ReadonlySet<string>) {
  const db: unknown = createDrizzleMock();
  const plugins = new PluginRegistryService(
    db as PostgresJsDatabase<typeof schema>,
    new EventEmitter2(),
  );
  jest.spyOn(plugins, 'isActive').mockImplementation((s) => active.has(s));
  return new HubMediaSourceGateRegistry(plugins);
}

describe('HubMediaSourceGateRegistry (ROK-1959 D-5)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('hides a source whose gate says hide, on that hub only', async () => {
    const gates = setup(new Set(['bg3']));
    gates.register('bg3', 'bg3-save', (g) => Promise.resolve(g === 7));
    await expect(gates.hiddenSources(7)).resolves.toEqual(['bg3-save']);
    await expect(gates.hiddenSources(8)).resolves.toEqual([]);
  });

  it('hides nothing when no gate is registered', async () => {
    await expect(setup(new Set()).hiddenSources(7)).resolves.toEqual([]);
  });

  it('fails closed while the owner plugin is inactive, without asking the gate', async () => {
    const gates = setup(new Set());
    const gate = jest.fn(() => Promise.resolve(false));
    gates.register('bg3', 'bg3-save', gate);
    await expect(gates.hiddenSources(7)).resolves.toEqual(['bg3-save']);
    expect(gate).not.toHaveBeenCalled();
  });

  it('fails closed and warns when the gate throws', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const gates = setup(new Set(['bg3']));
    gates.register('bg3', 'bg3-save', () =>
      Promise.reject(new Error('db down')),
    );
    await expect(gates.hiddenSources(7)).resolves.toEqual(['bg3-save']);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'media gate for "bg3-save" (bg3) failed on hub 7',
      ),
    );
  });

  it('lists a source once when two gates both hide it', async () => {
    const gates = setup(new Set(['bg3', 'core']));
    gates.register('bg3', 'bg3-save', () => Promise.resolve(true));
    gates.register('core', 'bg3-save', () => Promise.resolve(true));
    await expect(gates.hiddenSources(7)).resolves.toEqual(['bg3-save']);
  });
});
