/**
 * ROK-1933 L6a — the fixture's generated Discord ids must pass the fixture
 * route's own `bDiscordId` validator (a 17–20 digit snowflake), or a spec that
 * echoes B's id back gets a 400 instead of the 409 it is probing for.
 */
import { claimDriveSnowflakes } from './valheim-claim-drive-demo-seed.helpers';

describe('claimDriveSnowflakes', () => {
  it('returns two distinct 17–20 digit snowflakes', () => {
    const { a, b } = claimDriveSnowflakes();
    expect(a).toMatch(/^\d{17,20}$/);
    expect(b).toMatch(/^\d{17,20}$/);
    expect(a).not.toBe(b);
  });
});
