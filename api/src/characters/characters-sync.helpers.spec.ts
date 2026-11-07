/**
 * ROK-1920 — a character-media miss on sync (fetchCharacterMedia → null)
 * keeps the stored portrait/render instead of wiping them; all variants.
 */
import {
  buildSyncUpdateFields,
  type EnrichedProfile,
} from './characters-sync.helpers';

function profile(
  media: Pick<EnrichedProfile['profile'], 'avatarUrl' | 'renderUrl'>,
): EnrichedProfile['profile'] {
  return {
    name: 'Stoneward',
    realm: null,
    class: 'Warrior',
    spec: null,
    role: 'tank',
    level: 60,
    race: 'Human',
    faction: 'alliance',
    itemLevel: 64,
    profileUrl: null,
    ...media,
  };
}

const AVATAR = 'https://render.worldofwarcraft.com/avatar.jpg';
const RENDER = 'https://render.worldofwarcraft.com/main-raw.png';

describe.each<[string, { gameVariant?: string }]>([
  ['no variant (retail)', {}],
  ['classic_era', { gameVariant: 'classic_era' }],
  ['wow_forever', { gameVariant: 'wow_forever' }],
])('buildSyncUpdateFields media — %s', (_label, extra) => {
  it('omits avatarUrl/renderUrl when the media fetch returned null', () => {
    const got = buildSyncUpdateFields(
      profile({ avatarUrl: null, renderUrl: null }),
      null,
      null,
      null,
      extra,
    );
    expect(got).not.toHaveProperty('avatarUrl');
    expect(got).not.toHaveProperty('renderUrl');
    expect(got).toHaveProperty('level', 60);
  });

  it('writes both URLs when present', () => {
    const got = buildSyncUpdateFields(
      profile({ avatarUrl: AVATAR, renderUrl: RENDER }),
      null,
      null,
      null,
      extra,
    );
    expect(got).toMatchObject({ avatarUrl: AVATAR, renderUrl: RENDER });
  });

  it('writes the one that came back and keeps the other', () => {
    const got = buildSyncUpdateFields(
      profile({ avatarUrl: AVATAR, renderUrl: null }),
      null,
      null,
      null,
      extra,
    );
    expect(got).toHaveProperty('avatarUrl', AVATAR);
    expect(got).not.toHaveProperty('renderUrl');
  });
});
