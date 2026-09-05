import { buildDepartureEmbed } from './departure-grace.embed.helpers';
import {
  DEFAULT_COMMUNITY_NAME,
  colorForState,
} from '../embeds/embed-chrome.helpers';
import { NOTIFICATION_EMBED_AUTHORS } from '../../notifications/notification-embed.helpers';

/**
 * ROK-1477 (Lane C) — the "Slot Vacated" DM now gets its colour, author and
 * footer from the shared chrome instead of writing them itself.
 */
describe('buildDepartureEmbed chrome', () => {
  const card = () =>
    buildDepartureEmbed('Roknua', 'tank', 2, 'Friday Deep Dive');

  it('renders in the needs_you state — the reader is asked to promote', () => {
    expect(card().data.color).toBe(colorForState('needs_you'));
  });

  it('carries the slot-vacated author line', () => {
    expect(card().data.author?.name).toBe(
      NOTIFICATION_EMBED_AUTHORS.SLOT_VACATED,
    );
  });

  // The processor has no branding in hand, so the builder takes no community
  // override and this is the footer production actually renders. Asserting a
  // caller-supplied name here would pin a branch no caller can reach.
  it('footers with the chrome default community name', () => {
    expect(card().data.footer?.text).toBe(DEFAULT_COMMUNITY_NAME);
  });

  it('keeps the title and the departed-member description', () => {
    const data = card().data;
    expect(data.title).toBe('Slot Vacated');
    expect(data.description).toContain('**Roknua** departed from the **tank**');
  });
});
