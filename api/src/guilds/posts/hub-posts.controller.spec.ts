/**
 * ROK-1868 L3a — HubPostsController wiring (§2.3): guards per route, the
 * `composer`-before-`:postId` order, no-store GETs, the POST throttle, 204
 * delete, and delegation to `HubPostsService` with the request's actor.
 */
import {
  GUARDS_METADATA,
  HEADERS_METADATA,
  HTTP_CODE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import type { AuthenticatedRequest } from '../../auth/types';
import { GuildEditorGuard } from '../guild-editor.guard';
import { HubKindActiveGuard } from '../hub-kind-active.guard';
import { HubVisibleGuard } from '../hub-visible.guard';
import { HubPostsController } from './hub-posts.controller';
import type { HubPostsService } from './hub-posts.service';

type Handler = keyof HubPostsController;
const proto = HubPostsController.prototype;

function handler(name: Handler): object {
  const fn: unknown = proto[name];
  if (typeof fn !== 'function') throw new Error(`no handler ${name}`);
  return fn;
}

function guardsOf(name: Handler): unknown[] {
  return (Reflect.getMetadata(GUARDS_METADATA, handler(name)) ??
    []) as unknown[];
}

describe('HubPostsController — routing metadata', () => {
  it('mounts at guilds/:id/posts behind HubKindActiveGuard', () => {
    expect(Reflect.getMetadata(PATH_METADATA, HubPostsController)).toBe(
      'guilds/:id/posts',
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, HubPostsController)).toEqual([
      HubKindActiveGuard,
    ]);
  });

  it('declares GET composer BEFORE GET :postId', () => {
    const names = Object.getOwnPropertyNames(proto);
    expect(Reflect.getMetadata(PATH_METADATA, handler('composer'))).toBe(
      'composer',
    );
    expect(names.indexOf('composer')).toBeLessThan(names.indexOf('get'));
  });

  it.each<Handler>(['list', 'get'])(
    '%s: jwt + HubVisibleGuard, no editor guard',
    (name) => {
      const guards = guardsOf(name);
      expect(guards).toHaveLength(2);
      expect(guards[1]).toBe(HubVisibleGuard);
    },
  );

  it.each<Handler>(['composer', 'create', 'update', 'remove'])(
    '%s: jwt + HubVisibleGuard + GuildEditorGuard',
    (name) => {
      const guards = guardsOf(name);
      expect(guards).toHaveLength(3);
      expect(guards.slice(1)).toEqual([HubVisibleGuard, GuildEditorGuard]);
    },
  );

  it.each<Handler>(['list', 'composer', 'get'])(
    '%s: Cache-Control private, no-store',
    (name) => {
      expect(Reflect.getMetadata(HEADERS_METADATA, handler(name))).toEqual([
        { name: 'Cache-Control', value: 'private, no-store' },
      ]);
    },
  );

  it('throttles POST at 10/min and answers DELETE with 204', () => {
    const keys = Reflect.getMetadataKeys(handler('create')) as string[];
    const limitKey = keys.find((k) => String(k).startsWith('THROTTLER:LIMIT'));
    const ttlKey = keys.find((k) => String(k).startsWith('THROTTLER:TTL'));
    expect(limitKey && Reflect.getMetadata(limitKey, handler('create'))).toBe(
      10,
    );
    expect(ttlKey && Reflect.getMetadata(ttlKey, handler('create'))).toBe(
      60_000,
    );
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler('remove'))).toBe(
      204,
    );
  });
});

describe('HubPostsController — delegation', () => {
  const user = { id: 3, role: 'member' };
  const req = { user } as unknown as AuthenticatedRequest;
  const service = {
    list: jest.fn().mockResolvedValue('list'),
    get: jest.fn().mockResolvedValue('get'),
    composer: jest.fn().mockResolvedValue('composer'),
    create: jest.fn().mockResolvedValue('create'),
    update: jest.fn().mockResolvedValue('update'),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const ctl = new HubPostsController(service as unknown as HubPostsService);

  it('passes the actor, ids, query and body through', async () => {
    await ctl.list(req, 7, { limit: '5' });
    await ctl.get(req, 7, 11);
    await ctl.composer(7);
    await ctl.create(req, 7, { body: 'x', relayToDiscord: false });
    await ctl.update(req, 7, 11, { body: 'y' });
    await ctl.remove(7, 11);
    expect(service.list).toHaveBeenCalledWith(user, 7, { limit: '5' });
    expect(service.get).toHaveBeenCalledWith(user, 7, 11);
    expect(service.composer).toHaveBeenCalledWith(7);
    expect(service.create).toHaveBeenCalledWith(user, 7, {
      body: 'x',
      relayToDiscord: false,
    });
    expect(service.update).toHaveBeenCalledWith(user, 7, 11, { body: 'y' });
    expect(service.remove).toHaveBeenCalledWith(7, 11);
  });
});
