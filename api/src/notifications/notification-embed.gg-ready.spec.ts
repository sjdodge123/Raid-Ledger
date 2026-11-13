/**
 * ROK-2187 — the `gg_ready` DM ("Your GG <year> is ready") carries a primary
 * Link button to the player's GG page, built from the payload's year.
 */
import type { APIButtonComponentWithURL } from 'discord.js';
import { buildPrimaryButton } from './notification-embed.buttons';

const CLIENT = 'https://raid.example';

function primary(
  payload: Record<string, unknown> | undefined,
): APIButtonComponentWithURL | null {
  const btn = buildPrimaryButton('gg_ready', 'n-1', payload, CLIENT);
  return btn ? (btn.toJSON() as APIButtonComponentWithURL) : null;
}

describe('buildPrimaryButton — gg_ready (ROK-2187)', () => {
  it('links to <clientUrl>/gg/<year>', () => {
    const json = primary({ year: 2026, url: '/gg/2026' });
    expect(json?.label).toBe('Open your GG 2026');
    expect(json?.url).toBe(`${CLIENT}/gg/2026`);
  });

  it('has no button without a plausible year', () => {
    expect(primary(undefined)).toBeNull();
    expect(primary({ year: '2026; drop' })).toBeNull();
    expect(primary({ year: 99 })).toBeNull();
  });
});
