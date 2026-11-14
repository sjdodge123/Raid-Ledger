/**
 * ROK-1175 L3 — HubForumController wiring (D8): guards per route, the
 * `latest`-before-`:threadId` order, no-store GETs, 204s, the create throttle.
 */
import {
  GUARDS_METADATA,
  HEADERS_METADATA,
  HTTP_CODE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { PerUserThrottleGuard } from '../../common/throttle/per-user-throttle.guard';
import { GuildEditorGuard } from '../guild-editor.guard';
import { HubKindActiveGuard } from '../hub-kind-active.guard';
import { HubVisibleGuard } from '../hub-visible.guard';
import { HubForumThrottleGuard } from './hub-forum-throttle.guard';
import { HubForumController } from './hub-forum.controller';

type Handler = keyof HubForumController;
const proto = HubForumController.prototype;

function handler(name: Handler): object {
  const fn: unknown = proto[name];
  if (typeof fn !== 'function') throw new Error(`no handler ${name}`);
  return fn;
}

function meta(key: string, name: Handler): unknown {
  return Reflect.getMetadata(key, handler(name));
}

function guardsOf(name: Handler): unknown[] {
  const guards: unknown = meta(GUARDS_METADATA, name);
  return Array.isArray(guards) ? guards : [];
}

describe('ROK-1175 HubForumController — routing metadata', () => {
  it('mounts at guilds/:id/forum behind HubKindActiveGuard', () => {
    expect(Reflect.getMetadata(PATH_METADATA, HubForumController)).toBe(
      'guilds/:id/forum',
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, HubForumController)).toEqual([
      HubKindActiveGuard,
    ]);
  });

  it('declares GET latest BEFORE GET :threadId', () => {
    const names = Object.getOwnPropertyNames(proto);
    expect(meta(PATH_METADATA, 'latest')).toBe('latest');
    expect(names.indexOf('latest')).toBeLessThan(names.indexOf('get'));
  });

  it.each<Handler>(['list', 'latest', 'get'])(
    '%s: no-store, visible-hub check, no editor guard',
    (name) => {
      const guards = guardsOf(name);
      expect(guards).toHaveLength(2);
      expect(guards[1]).toBe(HubVisibleGuard);
      expect(guards).not.toContain(GuildEditorGuard);
      expect(meta(HEADERS_METADATA, name)).toEqual([
        { name: 'Cache-Control', value: 'private, no-store' },
      ]);
    },
  );

  it.each<Handler>(['create', 'reply'])(
    '%s: throttled per user, members only (no editor guard)',
    (name) => {
      const guards = guardsOf(name);
      expect(guards.slice(1)).toEqual([HubForumThrottleGuard, HubVisibleGuard]);
    },
  );

  it.each<Handler>(['update', 'remove', 'updateReply', 'removeReply'])(
    '%s: author/moderator rules live in the service, not an editor guard',
    (name) => {
      const guards = guardsOf(name);
      expect(guards.slice(1)).toEqual([HubVisibleGuard]);
    },
  );

  it.each<Handler>(['pin', 'unpin'])('%s: GuildEditorGuard, 204', (name) => {
    expect(guardsOf(name).slice(1)).toEqual([
      HubVisibleGuard,
      GuildEditorGuard,
    ]);
    expect(meta(PATH_METADATA, name)).toBe(':threadId/pin');
    expect(meta(HTTP_CODE_METADATA, name)).toBe(204);
  });

  it.each<Handler>(['remove', 'removeReply'])('%s answers 204', (name) => {
    expect(meta(HTTP_CODE_METADATA, name)).toBe(204);
  });

  it('the forum throttle is its own per-user bucket at 10 per minute', () => {
    const guard = new HubForumThrottleGuard();
    expect(guard).toBeInstanceOf(PerUserThrottleGuard);
    for (let i = 0; i < 10; i += 1) guard.hit(1);
    expect(() => guard.hit(1)).toThrow('Too Many Requests');
    expect(() => guard.hit(2)).not.toThrow();
  });
});
