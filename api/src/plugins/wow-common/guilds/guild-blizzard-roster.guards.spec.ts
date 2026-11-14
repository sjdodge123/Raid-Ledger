/**
 * ROK-2192 (operator ruling 2026-11-13) — the Blizzard roster writes the hub
 * settings sheet calls (slug PATCH, "Sync now") admit the linked guild's
 * rank-0 GM: they sit behind `GuildEditorOrTopRankGuard`, not the editor-only
 * `GuildEditorGuard`. The read stays any hub-visible member.
 */
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { GuildEditorGuard } from '../../../guilds/guild-editor.guard';
import { GuildEditorOrTopRankGuard } from '../../../guilds/guild-editor-or-top-rank.guard';
import { GuildBlizzardRosterController } from './guild-blizzard-roster.controller';
import { GuildBlizzardRosterSyncController } from './guild-blizzard-roster-sync.controller';

function guardsOf(handler: object): unknown[] {
  const guards: unknown = Reflect.getMetadata(GUARDS_METADATA, handler);
  return Array.isArray(guards) ? guards : [];
}

describe('Blizzard roster write guards (ROK-2192)', () => {
  it.each([
    ['PATCH slug', GuildBlizzardRosterController.prototype.setSlug],
    ['POST sync', GuildBlizzardRosterSyncController.prototype.sync],
  ])('%s admits the rank-0 GM', (_label, handler) => {
    const guards = guardsOf(handler);
    expect(guards).toContain(GuildEditorOrTopRankGuard);
    expect(guards).not.toContain(GuildEditorGuard);
  });
});
