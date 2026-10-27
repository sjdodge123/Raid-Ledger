import { hubPath } from './hub-path';

describe('hubPath', () => {
  it('builds the canonical /hubs/<id> page path, not the /guilds redirect', () => {
    expect(hubPath(7)).toBe('/hubs/7');
  });
});
