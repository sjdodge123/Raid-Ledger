import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { createDrizzleMock } from '../common/testing/drizzle-mock';
import type * as schema from '../drizzle/schema';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import {
  HubMediaSubjectRegistry,
  type HubMediaSubjectResolver,
} from './hub-media.subjects';

/** A registry whose plugin gate answers from `active`. */
function setup(active: ReadonlySet<string>) {
  const db: unknown = createDrizzleMock();
  const plugins = new PluginRegistryService(
    db as PostgresJsDatabase<typeof schema>,
    new EventEmitter2(),
  );
  jest.spyOn(plugins, 'isActive').mockImplementation((s) => active.has(s));
  const resolver = jest.fn<
    ReturnType<HubMediaSubjectResolver>,
    Parameters<HubMediaSubjectResolver>
  >();
  const subjects = new HubMediaSubjectRegistry(plugins);
  subjects.register('valheim', 'valheim-death', resolver);
  return { subjects, resolver };
}

describe('HubMediaSubjectRegistry (ROK-2027 D2/D6)', () => {
  it('hands the payload after the FIRST ":" to the namespace resolver', async () => {
    const { subjects, resolver } = setup(new Set(['valheim']));
    resolver.mockResolvedValue([3, 9]);
    await expect(subjects.resolve(7, 'valheim-death:n:odd')).resolves.toEqual([
      3, 9,
    ]);
    expect(resolver).toHaveBeenCalledWith({ guildId: 7, payload: 'n:odd' });
  });

  it('returns an empty id list as-is (a stale key is not an error)', async () => {
    const { subjects, resolver } = setup(new Set(['valheim']));
    resolver.mockResolvedValue([]);
    await expect(subjects.resolve(7, 'valheim-death:c1')).resolves.toEqual([]);
  });

  it.each([
    ['an unknown namespace', 'bg3-party:c1'],
    ['no namespace', ':c1'],
    ['no colon at all', 'valheim-death'],
  ])('refuses %s with 400 "Invalid query"', async (_label, subject) => {
    const { subjects, resolver } = setup(new Set(['valheim']));
    await expect(subjects.resolve(7, subject)).rejects.toThrow(
      new BadRequestException('Invalid query'),
    );
    expect(resolver).not.toHaveBeenCalled();
  });

  it('refuses while the owner plugin is inactive, without calling it', async () => {
    const { subjects, resolver } = setup(new Set());
    resolver.mockResolvedValue([1]);
    await expect(subjects.resolve(7, 'valheim-death:c1')).rejects.toThrow(
      new BadRequestException('Invalid query'),
    );
    expect(resolver).not.toHaveBeenCalled();
  });

  it('refuses a payload its resolver rejects (null)', async () => {
    const { subjects, resolver } = setup(new Set(['valheim']));
    resolver.mockResolvedValue(null);
    await expect(subjects.resolve(7, 'valheim-death:zzz')).rejects.toThrow(
      new BadRequestException('Invalid query'),
    );
  });

  it('refuses a second resolver for the same namespace', () => {
    const { subjects } = setup(new Set(['valheim']));
    expect(() =>
      subjects.register('core', 'valheim-death', () => Promise.resolve([])),
    ).toThrow('hub media subject "valheim-death" is already registered');
  });
});
