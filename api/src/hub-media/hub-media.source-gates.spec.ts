import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import type * as schema from '../drizzle/schema';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { HubMediaSourceGateRegistry } from './hub-media.source-gates';

/**
 * A registry whose plugin gate answers from `active` and whose hub has live
 * rows of `present` sources (default: every gated source).
 */
function setupWith(
  active: ReadonlySet<string>,
  present: readonly string[] = ['bg3-save'],
): { gates: HubMediaSourceGateRegistry; db: MockDb } {
  const db = createDrizzleMock();
  const asDb: unknown = db;
  const typed = asDb as PostgresJsDatabase<typeof schema>;
  const plugins = new PluginRegistryService(typed, new EventEmitter2());
  jest.spyOn(plugins, 'isActive').mockImplementation((s) => active.has(s));
  db.where.mockResolvedValue(present.map((source) => ({ source })));
  return { gates: new HubMediaSourceGateRegistry(plugins, typed), db };
}
const setup = (active: ReadonlySet<string>) => setupWith(active).gates;

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

  it('never asks the gate when the hub has no live row of its source, and still excludes it (ROK-1959 review MINOR 2)', async () => {
    const { gates } = setupWith(new Set(['bg3']), []);
    const gate = jest.fn(() => Promise.resolve(false));
    gates.register('bg3', 'bg3-save', gate);
    await expect(gates.hiddenSources(7)).resolves.toEqual(['bg3-save']);
    expect(gate).not.toHaveBeenCalled();
  });

  it('runs no presence read at all when no gate is registered', async () => {
    const { gates, db } = setupWith(new Set());
    await expect(gates.hiddenSources(7)).resolves.toEqual([]);
    expect(db.selectDistinct).not.toHaveBeenCalled();
  });

  it('fails closed without asking the gate when the presence read throws', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { gates, db } = setupWith(new Set(['bg3']));
    db.where.mockRejectedValue(new Error('db down'));
    const gate = jest.fn(() => Promise.resolve(false));
    gates.register('bg3', 'bg3-save', gate);
    await expect(gates.hiddenSources(7)).resolves.toEqual(['bg3-save']);
    expect(gate).not.toHaveBeenCalled();
  });

  it('lists a source once when two gates both hide it', async () => {
    const gates = setup(new Set(['bg3', 'core']));
    gates.register('bg3', 'bg3-save', () => Promise.resolve(true));
    gates.register('core', 'bg3-save', () => Promise.resolve(true));
    await expect(gates.hiddenSources(7)).resolves.toEqual(['bg3-save']);
  });
});
