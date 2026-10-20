import { ButtonStyle } from 'discord.js';
import {
  HUB_LINK_LABEL,
  HUBS_LINK_LABEL,
  hubLinkButton,
} from './hub-link-button.helpers';

describe('hubLinkButton', () => {
  it('returns null when there is no link (never a placeholder URL)', () => {
    expect(hubLinkButton(null)).toBeNull();
    expect(hubLinkButton(undefined)).toBeNull();
  });

  it('builds a Link-style button carrying the label and absolute URL', () => {
    const button = hubLinkButton({
      url: 'https://raid.example.com/guilds/7',
      label: HUB_LINK_LABEL,
    });
    expect(button?.toJSON()).toEqual({
      type: 2,
      style: ButtonStyle.Link,
      label: 'Hub',
      url: 'https://raid.example.com/guilds/7',
    });
  });

  it('exposes the directory label for the multi-hub case', () => {
    expect(HUBS_LINK_LABEL).toBe('Hubs');
  });
});
