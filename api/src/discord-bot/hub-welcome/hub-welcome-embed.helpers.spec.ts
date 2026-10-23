/**
 * ROK-1933 Part 4 — unit: the hub welcome embed's fields and link buttons.
 */
import { ButtonStyle, type APIButtonComponentWithURL } from 'discord.js';
import {
  buildHubWelcomeEmbed,
  buildHubWelcomeRow,
  hubWelcomeUrls,
} from './hub-welcome-embed.helpers';
import { HUB_WELCOME_COPY } from './hub-welcome.constants';

const base = { hubId: 42, hubName: 'gamersaloon' };

function linkButtons(clientUrl: string, withClaim: boolean) {
  const row = buildHubWelcomeRow({ ...base, clientUrl, withClaim }).toJSON();
  return row.components as APIButtonComponentWithURL[];
}

describe('buildHubWelcomeEmbed', () => {
  it('sets the author marker, a title naming the hub and a description', () => {
    const data = buildHubWelcomeEmbed({
      ...base,
      claimHint: 'Link Steam.',
    }).data;
    expect(data.author?.name).toBe(HUB_WELCOME_COPY.author);
    expect(data.title).toBe('gamersaloon on Raid Ledger');
    expect(data.description).toContain('gamersaloon');
  });

  it('adds "Claim your character" (the plugin hint) then "New here?"', () => {
    const data = buildHubWelcomeEmbed({
      ...base,
      claimHint: 'Link Steam.',
    }).data;
    expect(data.fields?.map((f) => [f.name, f.value])).toEqual([
      ['Claim your character', 'Link Steam.'],
      ['New here?', HUB_WELCOME_COPY.newHereValue],
    ]);
  });

  it('omits the claim field when the hub kind supplies no hint', () => {
    const data = buildHubWelcomeEmbed(base).data;
    expect(data.fields?.map((f) => f.name)).toEqual(['New here?']);
  });

  it('uses a plugin-supplied description over the generic one', () => {
    const data = buildHubWelcomeEmbed({ ...base, description: 'Custom.' }).data;
    expect(data.description).toBe('Custom.');
  });
});

describe('buildHubWelcomeRow', () => {
  it('links [Open the hub] and [Claim your character] off the client URL', () => {
    const buttons = linkButtons('https://rl.example/', true);
    expect(buttons.map((b) => [b.style, b.label, b.url])).toEqual([
      [ButtonStyle.Link, 'Open the hub', 'https://rl.example/hubs/42'],
      [
        ButtonStyle.Link,
        'Claim your character',
        'https://rl.example/hubs/42#characters',
      ],
    ]);
  });

  it('drops the claim button for a kind with no characters', () => {
    const buttons = linkButtons('https://rl.example', false);
    expect(buttons.map((b) => b.label)).toEqual(['Open the hub']);
  });

  it('keeps a client URL sub-path (append, never new URL)', () => {
    expect(hubWelcomeUrls('https://x.test/rl', 7)).toEqual({
      hub: 'https://x.test/rl/hubs/7',
      characters: 'https://x.test/rl/hubs/7#characters',
    });
  });
});
