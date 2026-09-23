/**
 * ROK-1612 — the card's two controls, the prefilled modal, and the AC8
 * invariant: no reply is ever a dead end.
 */
import { ButtonStyle, ComponentType } from 'discord.js';
import { LFG_URGENCY_CHOICES } from '../commands/lfg.command.helpers';
import {
  LFG_COMPOSER_COPY,
  LFG_COMPOSER_TERM_MAX,
} from './lfg-composer.constants';
import {
  GAMES_PAGE_SEARCH_MAX,
  buildComposerCard,
  buildComposerModal,
  gamesPageUrl,
} from './lfg-composer-card.helpers';
import {
  buildCandidatesReply,
  buildNoMatchReply,
  buildUrgencyReply,
  type LfgComposerReply,
} from './lfg-composer-reply.helpers';
import { horizonOf, orderUrgencyChoices } from './lfg-composer-urgency.helpers';

const CLIENT_URL = 'https://raid.example.net';
const DRG = { id: 3, name: 'Deep Rock Galactic' };

/** The one text input inside a built modal, narrowed out of the union. */
function modalInput(
  modal: ReturnType<typeof buildComposerModal>,
): Record<string, unknown> {
  const row = modal.toJSON().components[0];
  if (!('components' in row)) throw new Error('expected an action row');
  return row.components[0] as unknown as Record<string, unknown>;
}

/** The URL of the one Link button across a reply's rows, if any. */
function linkUrl(
  rows: ReadonlyArray<{ toJSON(): { components: ReadonlyArray<object> } }>,
): string | undefined {
  return rows
    .flatMap((row) => row.toJSON().components)
    .find((c): c is { url: string } => 'url' in c)?.url;
}

/** Every button label in a reply, flattened across its rows. */
function labels(reply: LfgComposerReply): string[] {
  return reply.components.flatMap((row) =>
    row.toJSON().components.map((c) => ('label' in c ? c.label : undefined)),
  ) as string[];
}

describe('buildComposerCard', () => {
  it('carries the title and nothing else — the subtitle was cut', () => {
    const card = buildComposerCard(CLIENT_URL);
    expect(card.content).toBe(LFG_COMPOSER_COPY.CARD_TITLE);
    expect(card.content).not.toMatch(/leave the channel/i);
  });

  it('keeps View games as permanent furniture beside Post an LFG', () => {
    const row = buildComposerCard(CLIENT_URL).components[0].toJSON();
    expect(row.components).toHaveLength(2);
    expect(row.components[0]).toMatchObject({
      style: ButtonStyle.Primary,
      label: '+ Post an LFG',
    });
    expect(row.components[1]).toMatchObject({
      style: ButtonStyle.Link,
      url: `${CLIENT_URL}/games`,
    });
  });

  it('drops the link rather than the card when no client URL is configured', () => {
    const row = buildComposerCard(null).components[0].toJSON();
    expect(row.components).toHaveLength(1);
    expect(gamesPageUrl(null)).toBeNull();
  });

  it('does not double the slash on a client URL that has a trailing one', () => {
    expect(gamesPageUrl('https://raid.example.net/')).toBe(
      'https://raid.example.net/games',
    );
  });
});

describe('buildComposerModal', () => {
  it('prefills what was typed so a typo is edited, never retyped', () => {
    expect(modalInput(buildComposerModal('deep rok'))).toMatchObject({
      value: 'deep rok',
      required: true,
    });
  });

  it('opens blank on the first press', () => {
    expect(modalInput(buildComposerModal())).not.toHaveProperty('value');
  });
});

describe('buildCandidatesReply', () => {
  it('offers the hits under a count heading and never auto-selects', () => {
    const reply = buildCandidatesReply(
      'rock',
      [DRG, { id: 4, name: 'Rocket League' }],
      false,
      CLIENT_URL,
    );
    expect(reply.content).toBe('2 games match “rock”');
    const select = reply.components[0].toJSON().components[0];
    expect(select.type).toBe(ComponentType.StringSelect);
    expect(select).toMatchObject({
      options: [
        { label: 'Deep Rock Galactic', value: '3' },
        { label: 'Rocket League', value: '4' },
      ],
    });
  });

  it('asks rather than tells on the trigram path', () => {
    const reply = buildCandidatesReply('valhiem', [DRG], true, CLIENT_URL);
    expect(reply.content).toBe('No exact match for “valhiem”. Did you mean:');
  });

  it('always goes back and always offers the games page (AC8)', () => {
    const reply = buildCandidatesReply('rock', [DRG], false, CLIENT_URL);
    expect(labels(reply)).toEqual(
      expect.arrayContaining([
        LFG_COMPOSER_COPY.BACK_BUTTON,
        LFG_COMPOSER_COPY.VIEW_GAMES_BUTTON,
      ]),
    );
  });
});

describe('buildUrgencyReply', () => {
  it('names the game and carries the whole live vocabulary', () => {
    const reply = buildUrgencyReply({
      game: DRG,
      term: 'deep rock',
      origin: 'candidates',
      choices: LFG_URGENCY_CHOICES,
      clientUrl: CLIENT_URL,
    });
    expect(reply.content).toBe('When do you want to play Deep Rock Galactic?');
    const row = reply.components[0].toJSON();
    expect(row.components).toHaveLength(LFG_URGENCY_CHOICES.length);
    expect(row.components.map((c) => ('style' in c ? c.style : null))).toEqual(
      LFG_URGENCY_CHOICES.map(() => ButtonStyle.Primary),
    );
  });

  it.each(['search', 'candidates'] as const)(
    'still goes back, always to the select (origin %s, ROK-1658)',
    (origin) => {
      const reply = buildUrgencyReply({
        game: DRG,
        term: 'deep rock',
        origin,
        choices: LFG_URGENCY_CHOICES,
        clientUrl: CLIENT_URL,
      });
      const tailRow = reply.components[1].toJSON().components;
      expect(tailRow.map((c) => ('label' in c ? c.label : c.type))).toEqual([
        LFG_COMPOSER_COPY.BACK_BUTTON,
      ]);
      const tail = tailRow[0];
      expect('custom_id' in tail ? tail.custom_id : undefined).toBe(
        'lfgc:backc:deep rock',
      );
    },
  );
});

describe('orderUrgencyChoices', () => {
  it('renders soonest first, derived from the horizon and not the label', () => {
    const ordered = orderUrgencyChoices(LFG_URGENCY_CHOICES);
    expect(ordered.map((c) => horizonOf(c.value))).toEqual([
      'now',
      'tonight',
      'week',
    ]);
  });

  it('keeps a horizon it has never heard of pressable, at the end', () => {
    const ordered = orderUrgencyChoices([
      { name: 'Next month', value: 'month' },
      { name: 'This week', value: 'week' },
      { name: 'Right now', value: 'now:30' },
    ]);
    expect(ordered.map((c) => c.value)).toEqual(['now:30', 'week', 'month']);
  });
});

describe('buildNoMatchReply', () => {
  it('carries ONLY Back and View games — no select, no separate Try again', () => {
    const reply = buildNoMatchReply('bg3', CLIENT_URL);
    expect(reply.content).toBe('No games match “bg3”');
    expect(reply.components).toHaveLength(1);
    expect(labels(reply)).toEqual(['← Back', 'View games ↗']);
  });

  it('still offers Back on a deployment with no web URL', () => {
    expect(labels(buildNoMatchReply('bg3', null))).toEqual(['← Back']);
  });

  it('shows a typed term literally, markdown and all', () => {
    expect(buildNoMatchReply('*bg3*', null).content).toBe(
      'No games match “\\*bg3\\*”',
    );
  });
});

describe('View games carries the searched term (ROK-1658 operator note)', () => {
  const TERM = 'deep rock & stone';

  it('opens /games searching for what the results message was built from', () => {
    const url = linkUrl(
      buildCandidatesReply(TERM, [DRG], false, CLIENT_URL).components,
    );
    expect(url).toBe(`${CLIENT_URL}/games?q=deep+rock+%26+stone`);
    expect(new URL(url ?? '').searchParams.get('q')).toBe(TERM);
  });

  it('opens /games searching for the term that found nothing', () => {
    const url = linkUrl(
      buildNoMatchReply('pokémon #1 & co', CLIENT_URL).components,
    );
    expect(url?.startsWith(`${CLIENT_URL}/games?q=`)).toBe(true);
    expect(url).not.toMatch(/[ #&]/);
    expect(new URL(url ?? '').searchParams.get('q')).toBe('pokémon #1 & co');
  });

  it('keeps the pinned card on plain /games — nothing has been searched yet', () => {
    const url = linkUrl(buildComposerCard(CLIENT_URL).components);
    expect(url).toBe(`${CLIENT_URL}/games`);
    expect(new URL(url ?? '').searchParams.has('q')).toBe(false);
  });

  it('never hands /games a q longer than it accepts', () => {
    const url = linkUrl(
      buildNoMatchReply('x'.repeat(150), CLIENT_URL).components,
    );
    const q = new URL(url ?? '').searchParams.get('q') ?? '';
    expect(q).toBe('x'.repeat(LFG_COMPOSER_TERM_MAX));
    expect(q.length).toBeLessThanOrEqual(GAMES_PAGE_SEARCH_MAX);
  });

  it('trims the term and links plain /games when it is blank', () => {
    expect(gamesPageUrl(CLIENT_URL, '  bg3  ')).toBe(
      `${CLIENT_URL}/games?q=bg3`,
    );
    expect(gamesPageUrl(CLIENT_URL, '   ')).toBe(`${CLIENT_URL}/games`);
  });

  it('still drops the link on a deployment with no web URL', () => {
    expect(gamesPageUrl(null, TERM)).toBeNull();
    const reply = buildCandidatesReply(TERM, [DRG], false, null);
    expect(linkUrl(reply.components)).toBeUndefined();
    expect(labels(reply)).not.toContain(LFG_COMPOSER_COPY.VIEW_GAMES_BUTTON);
  });
});
