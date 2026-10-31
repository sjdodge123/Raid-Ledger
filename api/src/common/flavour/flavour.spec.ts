/**
 * ROK-1700 — RL_FLAVOUR runtime flavour: parsing, the boot guards and the one
 * FLEET_* warning. Unset / nas must behave exactly as before (regression guard).
 */
import {
  assertFlavourBootConfig,
  getFlavour,
  ignoredFleetEnvWarning,
  isCloudFlavour,
} from './flavour';

const env = (vars: Record<string, string>): NodeJS.ProcessEnv => vars;

describe('ROK-1700 getFlavour / isCloudFlavour', () => {
  it.each([
    ['unset', {}, 'nas'],
    ['empty', { RL_FLAVOUR: '' }, 'nas'],
    ['whitespace', { RL_FLAVOUR: '  ' }, 'nas'],
    ['nas', { RL_FLAVOUR: 'nas' }, 'nas'],
    ['cloud', { RL_FLAVOUR: 'cloud' }, 'cloud'],
    ['cloud with padding', { RL_FLAVOUR: ' cloud ' }, 'cloud'],
  ])('%s → %s', (_label, vars, expected) => {
    expect(getFlavour(env(vars))).toBe(expected);
    expect(isCloudFlavour(env(vars))).toBe(expected === 'cloud');
  });

  it.each(['Cloud', 'saas', 'NAS', 'true'])(
    'unknown value %p throws naming the variable and the allowed values',
    (value) => {
      expect(() => getFlavour(env({ RL_FLAVOUR: value }))).toThrow(
        `RL_FLAVOUR="${value}" is not a known flavour — allowed values: nas, cloud`,
      );
    },
  );
});

describe('ROK-1700 assertFlavourBootConfig', () => {
  it('cloud + DEMO_MODE=true refuses, naming both variables', () => {
    expect(() =>
      assertFlavourBootConfig(env({ RL_FLAVOUR: 'cloud', DEMO_MODE: 'true' })),
    ).toThrow(/RL_FLAVOUR=cloud cannot run with DEMO_MODE=true/);
  });

  it('an unknown flavour refuses', () => {
    expect(() => assertFlavourBootConfig(env({ RL_FLAVOUR: 'aws' }))).toThrow(
      /RL_FLAVOUR="aws"/,
    );
  });

  it.each([
    ['nas + DEMO_MODE', { RL_FLAVOUR: 'nas', DEMO_MODE: 'true' }, 'nas'],
    ['unset + DEMO_MODE', { DEMO_MODE: 'true' }, 'nas'],
    [
      'cloud, DEMO_MODE off',
      { RL_FLAVOUR: 'cloud', DEMO_MODE: 'false' },
      'cloud',
    ],
    ['cloud, DEMO_MODE unset', { RL_FLAVOUR: 'cloud' }, 'cloud'],
  ])('%s boots as %s', (_label, vars, expected) => {
    expect(assertFlavourBootConfig(env(vars))).toBe(expected);
  });
});

describe('ROK-1700 ignoredFleetEnvWarning', () => {
  const FLEET = {
    FLEET_FIRST_DISCORD_LOGIN_ADMIN: 'true',
    FLEET_ADMIN_DISCORD_ID: '123456789012345678',
  };

  it('cloud with both set → ONE message naming both', () => {
    const msg = ignoredFleetEnvWarning(env({ RL_FLAVOUR: 'cloud', ...FLEET }));
    expect(msg).toBe(
      'RL_FLAVOUR=cloud ignores fleet-only variables: FLEET_FIRST_DISCORD_LOGIN_ADMIN, FLEET_ADMIN_DISCORD_ID — first Discord login is not promoted to admin and no fleet operator is bootstrapped.',
    );
  });

  it('cloud names only the variables actually set', () => {
    const msg = ignoredFleetEnvWarning(
      env({ RL_FLAVOUR: 'cloud', FLEET_ADMIN_DISCORD_ID: '1234567' }),
    );
    expect(msg).toContain('variables: FLEET_ADMIN_DISCORD_ID —');
  });

  it('cloud with none set → no warning', () => {
    expect(ignoredFleetEnvWarning(env({ RL_FLAVOUR: 'cloud' }))).toBeNull();
  });

  it('nas with fleet vars set → no warning (fleet behaviour unchanged)', () => {
    expect(
      ignoredFleetEnvWarning(env({ RL_FLAVOUR: 'nas', ...FLEET })),
    ).toBeNull();
    expect(ignoredFleetEnvWarning(env(FLEET))).toBeNull();
  });
});
