/**
 * ROK-2107: a sync writes Blizzard professions to `armoryProfessions` only —
 * the user-entered `professions` column is never in a sync record.
 * ROK-1920 — a character-media miss on sync (fetchCharacterMedia → null)
 * keeps the stored portrait/render instead of wiping them; all variants.
 */
import {
  applyOptionalSyncFields,
  buildSyncUpdateFields,
  type EnrichedProfile,
} from './characters-sync.helpers';

const PAYLOAD = {
  primary: [],
  secondary: [],
  syncedAt: '2026-11-06T00:00:00.000Z',
};

const PROFILE: EnrichedProfile['profile'] = {
  name: 'Ana',
  realm: null,
  class: 'Mage',
  spec: null,
  role: null,
  level: 25,
  race: 'Gnome',
  faction: 'alliance',
  itemLevel: null,
  avatarUrl: null,
  renderUrl: null,
  profileUrl: null,
};

describe('applyOptionalSyncFields (ROK-2107)', () => {
  it('puts a Blizzard professions payload in armoryProfessions, never professions', () => {
    const record = applyOptionalSyncFields(
      { name: 'x' },
      { professions: PAYLOAD, equipment: null, talents: null },
    );
    expect(record).toHaveProperty('armoryProfessions', PAYLOAD);
    expect(record).not.toHaveProperty('professions');
  });

  it('emits neither key when the adapter returned null (leave prior value)', () => {
    const record = applyOptionalSyncFields(
      {},
      { professions: null, equipment: null, talents: null },
    );
    expect(record).not.toHaveProperty('armoryProfessions');
    expect(record).not.toHaveProperty('professions');
  });
});

describe('buildSyncUpdateFields (ROK-2107)', () => {
  it('routes professions to armoryProfessions for every caller', () => {
    const fields = buildSyncUpdateFields(PROFILE, null, null, PAYLOAD);
    expect(fields).toHaveProperty('armoryProfessions', PAYLOAD);
    expect(fields).not.toHaveProperty('professions');
  });
});

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
