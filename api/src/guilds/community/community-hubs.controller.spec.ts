import { GUARDS_METADATA } from '@nestjs/common/constants';
import { GuildEditorGuard } from '../guild-editor.guard';
import { GuildLeaderGuard } from '../guild-leader.guard';
import { HubVisibleGuard } from '../hub-visible.guard';
import { CommunityHubsController } from './community-hubs.controller';

type Route = keyof CommunityHubsController;

function guardsOf(route: Route): unknown[] {
  const handler: unknown = CommunityHubsController.prototype[route];
  const found: unknown =
    typeof handler === 'function'
      ? Reflect.getMetadata(GUARDS_METADATA, handler)
      : undefined;
  return Array.isArray(found) ? found : [];
}

describe('CommunityHubsController guard mapping (ROK-1870 §2.3)', () => {
  it.each<Route>(['removeMember', 'listBans', 'ban', 'unban', 'updateBlurb'])(
    '%s runs HubVisibleGuard + GuildEditorGuard',
    (route) => {
      expect(guardsOf(route)).toEqual([HubVisibleGuard, GuildEditorGuard]);
    },
  );

  it.each<Route>(['setRole', 'transferLeader'])(
    '%s runs HubVisibleGuard + GuildLeaderGuard',
    (route) => {
      expect(guardsOf(route)).toEqual([HubVisibleGuard, GuildLeaderGuard]);
    },
  );

  it('status skips HubVisibleGuard so a leader of an archived hub gets 403 (M14)', () => {
    expect(guardsOf('setStatus')).toEqual([GuildLeaderGuard]);
  });

  it.each<Route>(['join', 'leave'])('%s runs HubVisibleGuard only', (route) => {
    expect(guardsOf(route)).toEqual([HubVisibleGuard]);
  });

  it.each<Route>(['directory', 'byGame'])('%s has no :id guard', (route) => {
    expect(guardsOf(route)).toEqual([]);
  });
});
