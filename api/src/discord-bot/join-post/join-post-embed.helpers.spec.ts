import { ButtonStyle, ComponentType } from 'discord.js';
import {
  buildJoinPostEmbed,
  buildJoinPostRow,
  JOIN_POST_MEMBERS_LINE,
  JOIN_POST_PRIVACY_LINE,
} from './join-post-embed.helpers';
import {
  JOIN_POST_AUTHOR,
  JOIN_POST_BUTTON_LABEL,
} from './join-post.constants';

describe('buildJoinPostRow', () => {
  it('is one Link button labelled "Join Raid Ledger" opening /login', () => {
    const row = buildJoinPostRow('https://raid.example.com').toJSON();
    expect(row.components).toHaveLength(1);
    expect(row.components[0]).toEqual({
      type: ComponentType.Button,
      style: ButtonStyle.Link,
      label: JOIN_POST_BUTTON_LABEL,
      url: 'https://raid.example.com/login',
    });
  });

  it('does not double the slash when the client URL ends with one', () => {
    const row = buildJoinPostRow('https://raid.example.com/').toJSON();
    expect(row.components[0]).toMatchObject({
      url: 'https://raid.example.com/login',
    });
  });

  it('keeps a sub-path in the client URL', () => {
    const row = buildJoinPostRow('https://example.com/raid/').toJSON();
    expect(row.components[0]).toMatchObject({
      url: 'https://example.com/raid/login',
    });
  });
});

describe('buildJoinPostEmbed', () => {
  const json = buildJoinPostEmbed('Night Owls').toJSON();

  it('carries the join-post author line (rediscovery identity)', () => {
    expect(json.author?.name).toBe(JOIN_POST_AUTHOR);
  });

  it('names the community and says it is for server members', () => {
    expect(json.title).toBe('Join Night Owls');
    expect(json.description).toContain(JOIN_POST_MEMBERS_LINE);
  });

  it('states that signing in shares only username and avatar', () => {
    expect(json.description).toContain(JOIN_POST_PRIVACY_LINE);
    expect(JOIN_POST_PRIVACY_LINE).toBe(
      'Signing in with Discord shares only your Discord username and avatar.',
    );
  });
});
