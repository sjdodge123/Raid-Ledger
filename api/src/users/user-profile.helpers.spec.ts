import { buildUserProfile } from './user-profile.helpers';

const base = {
  id: 1,
  username: 'testuser',
  avatar: 'hash',
  discordId: '123',
  customAvatarUrl: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('buildUserProfile (ROK-1734)', () => {
  it('reports steamLinked=true and never carries steamId for a linked user', () => {
    const out = buildUserProfile({ ...base, steamId: '76561198000000000' }, []);
    expect(out.data).not.toHaveProperty('steamId');
    expect(out.data.steamLinked).toBe(true);
  });

  it('reports steamLinked=false for a user without a Steam id', () => {
    const out = buildUserProfile({ ...base, steamId: null }, []);
    expect(out.data.steamLinked).toBe(false);
  });

  it('keeps the member identity fields', () => {
    const out = buildUserProfile({ ...base, steamId: null }, []);
    expect(out.data).toMatchObject({
      id: 1,
      discordId: '123',
      avatar: 'hash',
      createdAt: '2026-01-01T00:00:00.000Z',
      characters: [],
    });
  });
});
