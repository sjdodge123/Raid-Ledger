/**
 * ROK-1813 — guard wiring: the settings routes are `canEdit`-only
 * (`HubVisibleGuard` + `GuildEditorGuard` after the JWT guard, AC1); the
 * public read carries no guard at all and the `public` throttle tier (D4).
 */
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { GuildEditorGuard } from '../../../../guilds/guild-editor.guard';
import { HubVisibleGuard } from '../../../../guilds/hub-visible.guard';
import { PluginActiveGuard } from '../../../plugin-host/plugin-active.guard';
import { GuildPublicCardSettingsController } from './guild-public-card-settings.controller';
import { PublicGuildCardController } from './public-guild-card.controller';

type Route = keyof GuildPublicCardSettingsController;

function metaOf(target: unknown): unknown[] {
  if (typeof target !== 'function' && typeof target !== 'object') return [];
  if (target === null) return [];
  const found: unknown = Reflect.getMetadata(GUARDS_METADATA, target);
  return Array.isArray(found) ? found : [];
}

function guardsOf(route: Route): unknown[] {
  return metaOf(GuildPublicCardSettingsController.prototype[route]);
}

describe('GuildPublicCardSettingsController guard mapping (ROK-1813 AC1)', () => {
  it.each<Route>(['get', 'update'])(
    '%s runs jwt, HubVisibleGuard, GuildEditorGuard',
    (route) => {
      const guards = guardsOf(route);
      expect(guards).toHaveLength(3);
      expect(guards.slice(1)).toEqual([HubVisibleGuard, GuildEditorGuard]);
    },
  );

  it('the class runs PluginActiveGuard', () => {
    expect(metaOf(GuildPublicCardSettingsController)).toEqual([
      PluginActiveGuard,
    ]);
  });
});

describe('PublicGuildCardController (ROK-1813 D4)', () => {
  it('is INTENTIONALLY unguarded: no class or route guard', () => {
    expect(metaOf(PublicGuildCardController)).toEqual([]);
    expect(metaOf(PublicGuildCardController.prototype.read)).toEqual([]);
  });
});
