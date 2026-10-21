import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { GuildKind } from '@raid-ledger/contract';
import {
  directoryKinds,
  joinedPredicate,
  visibleKinds,
  type DirectoryScope,
} from './community-directory.visibility';

/** ROK-1875 §6 — the per-kind directory predicates, rendered to SQL text. */
function render(q: SQL): { text: string; params: unknown[] } {
  const { sql: text, params } = new PgDialect().sqlToQuery(q);
  return { text, params };
}

function scope(over: Partial<DirectoryScope> = {}): DirectoryScope {
  return { kinds: [], memberIds: [], staff: false, ...over };
}

describe('visibleKinds', () => {
  it('renders false when no kind is live', () => {
    expect(render(visibleKinds(scope())).text).toBe('false');
  });

  it('a community-only scope has no WoW / server branch', () => {
    const { params } = render(visibleKinds(scope({ kinds: ['game_community'] })));
    expect(params).toContain('game_community');
    expect(params).not.toContain('game_server');
    expect(params).not.toContain('wow_guild');
  });

  it('community requires status active; server only hidden_at IS NULL', () => {
    const { text, params } = render(
      visibleKinds(scope({ kinds: ['game_server', 'game_community'] })),
    );
    expect(params).toEqual(
      expect.arrayContaining(['game_server', 'game_community', 'active']),
    );
    expect(text.match(/"hidden_at" is null/g)).toHaveLength(2);
  });

  it('a non-staff WoW branch is limited to the viewer member ids', () => {
    const { text, params } = render(
      visibleKinds(scope({ kinds: ['wow_guild'], memberIds: [7, 9] })),
    );
    expect(text).toContain('"guilds"."id" in');
    expect(params).toEqual(['wow_guild', 7, 9]);
  });

  it('a non-staff WoW branch with no memberships matches nothing', () => {
    const { text } = render(visibleKinds(scope({ kinds: ['wow_guild'] })));
    expect(text).not.toMatch(/in \(\)/);
    expect(text).toContain('false');
  });

  it('staff see every non-hidden WoW guild (no member-id gate)', () => {
    const { text } = render(
      visibleKinds(scope({ kinds: ['wow_guild'], staff: true })),
    );
    expect(text).not.toContain('"guilds"."id" in');
    expect(text).not.toContain('false');
  });
});

describe('joinedPredicate', () => {
  it('never emits an empty IN () for a viewer with no memberships', () => {
    const { text } = render(joinedPredicate(scope()));
    expect(text).not.toMatch(/in \(\)/);
    expect(text).toContain('"viewer_row"');
  });

  it('non-community rows are joined through the member ids', () => {
    const { text, params } = render(joinedPredicate(scope({ memberIds: [3] })));
    expect(text).toContain('"guilds"."id" in');
    expect(params).toContain(3);
  });
});

describe('directoryKinds', () => {
  it('orders live kinds by GUILD_KINDS and ignores the kind filter', () => {
    const live: GuildKind[] = ['game_community', 'wow_guild'];
    expect(directoryKinds(live, undefined)).toEqual({
      live: ['wow_guild', 'game_community'],
      queried: ['wow_guild', 'game_community'],
    });
    expect(directoryKinds(live, 'game_community')).toEqual({
      live: ['wow_guild', 'game_community'],
      queried: ['game_community'],
    });
  });

  it('a filter on a dead kind queries nothing', () => {
    expect(directoryKinds(['game_community'], 'game_server').queried).toEqual(
      [],
    );
  });
});
