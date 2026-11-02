/**
 * ROK-1728 (D8, §8 Q2 option a): the `Join Series` row on series embeds.
 */
import { ButtonStyle } from 'discord.js';
import { buildSeriesJoinRow } from './discord-embed-buttons.helpers';
import { SERIES_BUTTON_IDS } from '../series-signup/series-signup.constants';

describe('buildSeriesJoinRow', () => {
  it('holds exactly one blurple "Join Series" button keyed series_join:<id>', () => {
    const components = buildSeriesJoinRow(42).toJSON().components;
    expect(components).toEqual([
      {
        type: 2,
        style: ButtonStyle.Primary,
        label: 'Join Series',
        custom_id: 'series_join:42',
      },
    ]);
  });

  it('uses the series prefix, never a signup button id', () => {
    expect(SERIES_BUTTON_IDS.JOIN).toBe('series_join');
    const json = buildSeriesJoinRow(7).toJSON().components[0];
    expect(json).toMatchObject({ custom_id: 'series_join:7' });
  });
});
