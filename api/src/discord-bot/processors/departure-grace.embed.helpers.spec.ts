import { buildDepartureEmbed } from './departure-grace.embed.helpers';
import { colorForState } from '../embeds/embed-chrome.helpers';
import { NOTIFICATION_DM_AUTHORS } from '../../notifications/notification-embed.helpers';

/**
 * ROK-1477 (Lane C) — the "Slot Vacated" DM now gets its colour, author and
 * footer from the shared chrome instead of writing them itself.
 */
describe('buildDepartureEmbed chrome', () => {
  const card = () =>
    buildDepartureEmbed('Roknua', 'tank', 2, 'Friday Deep Dive', 'My Guild');

  it('renders in the needs_you state — the reader is asked to promote', () => {
    expect(card().data.color).toBe(colorForState('needs_you'));
  });

  it('carries the slot-vacated author line', () => {
    expect(card().data.author?.name).toBe(NOTIFICATION_DM_AUTHORS.SLOT_VACATED);
  });

  it('footers with the community name', () => {
    expect(card().data.footer?.text).toBe('My Guild');
  });

  it('keeps the title and the departed-member description', () => {
    const data = card().data;
    expect(data.title).toBe('Slot Vacated');
    expect(data.description).toContain('**Roknua** departed from the **tank**');
  });
});
