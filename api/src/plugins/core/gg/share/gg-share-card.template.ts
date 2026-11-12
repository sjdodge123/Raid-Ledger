/**
 * ROK-2187 lane 7 — the GG share card (1200×630 OG PNG) as a satori element
 * tree. The tree is built from {@link ggShareCardModel}, which copies ONLY
 * the public Summary allow-list (Q4): display name, year, events attended,
 * hours, top-3 game names, the superlative title and the "played with" COUNT.
 * Never another player's name, an id or an email; the avatar is not drawn
 * (no server-side fetch of a remote image).
 *
 * Colours: this is a raster, so theme tokens do not apply — fixed values are
 * the default-dark `@theme` tokens in web/src/index.css: backdrop #020617
 * (`--color-backdrop`), panel #1e293b (`--color-panel`), foreground #ffffff
 * (`--color-foreground`), secondary #cbd5e1 (`--color-secondary`), muted
 * #94a3b8 (`--color-muted`), accent #10b981 (`--color-success`).
 */
import type {
  GgPublicSummaryDto,
  GgSuperlativeKey,
} from '@raid-ledger/contract';

export const GG_SHARE_CARD_SIZE = { width: 1200, height: 630 } as const;

const C = {
  backdrop: '#020617',
  panel: '#1e293b',
  foreground: '#ffffff',
  secondary: '#cbd5e1',
  muted: '#94a3b8',
  accent: '#10b981',
} as const;

/** Superlative titles — mirrors web/src/components/gg/gg-format.ts (no emoji: the font has none). */
const SUPERLATIVE_TITLES: Readonly<Record<GgSuperlativeKey, string>> = {
  'night-owl': 'The Night Owl',
  'always-on-time': 'Always On Time',
  'the-planner': 'The Planner',
  explorer: 'The Explorer',
  'voice-regular': 'The Voice of the Raid',
  regular: 'The Regular',
  'welcome-aboard': 'Welcome Aboard',
};

type Style = Readonly<Record<string, string | number>>;
export type GgCardChild = GgCardNode | string;
/** A satori element (React-element shaped: `key` is required by the type). */
export interface GgCardNode {
  type: string;
  key: null;
  props: { style: Style; children?: GgCardChild | GgCardChild[] };
}

/** The share card's only inputs — the public allow-list, pre-formatted. */
export interface GgShareCardModel {
  year: number;
  displayName: string;
  eventsAttended: string;
  hours: string;
  playedWithCount: string;
  topGames: string[];
  superlativeTitle: string | null;
}

const NUM = new Intl.NumberFormat('en-US');

/** Builds one satori element. */
export function ggNode(
  type: string,
  style: Style,
  children?: GgCardChild | GgCardChild[],
): GgCardNode {
  return {
    type,
    key: null,
    props: children === undefined ? { style } : { style, children },
  };
}

/** Copies the allow-listed fields out of a public DTO (extra keys are dropped). */
export function ggShareCardModel(dto: GgPublicSummaryDto): GgShareCardModel {
  return {
    year: dto.year,
    displayName: dto.displayName,
    eventsAttended: NUM.format(dto.eventsAttended),
    hours: `${NUM.format(Math.round(dto.hoursPlayedSeconds / 3600))}h`,
    playedWithCount: NUM.format(dto.playedWithCount),
    topGames: dto.topGames.slice(0, 3).map((g) => g.name),
    superlativeTitle: dto.superlative
      ? SUPERLATIVE_TITLES[dto.superlative]
      : null,
  };
}

const ONE_LINE: Style = {
  display: 'flex',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: 1040,
};

function stat(value: string, label: string): GgCardNode {
  return ggNode('div', { display: 'flex', flexDirection: 'column', flex: 1 }, [
    ggNode(
      'div',
      { display: 'flex', fontSize: 72, fontWeight: 800, color: C.foreground },
      value,
    ),
    ggNode('div', { display: 'flex', fontSize: 26, color: C.muted }, label),
  ]);
}

function header(m: GgShareCardModel): GgCardNode {
  return ggNode(
    'div',
    { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    [
      ggNode(
        'div',
        { display: 'flex', fontSize: 40, fontWeight: 800, color: C.accent },
        `GG ${m.year}`,
      ),
      ggNode(
        'div',
        { display: 'flex', fontSize: 24, color: C.muted },
        'Raid Ledger',
      ),
    ],
  );
}

function identity(m: GgShareCardModel): GgCardNode {
  const lines: GgCardNode[] = [
    ggNode(
      'div',
      { ...ONE_LINE, fontSize: 64, fontWeight: 800, color: C.foreground },
      m.displayName,
    ),
  ];
  if (m.superlativeTitle) {
    lines.push(
      ggNode(
        'div',
        { display: 'flex', fontSize: 32, color: C.secondary },
        m.superlativeTitle,
      ),
    );
  }
  return ggNode('div', { display: 'flex', flexDirection: 'column' }, lines);
}

function topGames(m: GgShareCardModel): GgCardNode {
  const text =
    m.topGames.length > 0 ? m.topGames.join('  ·  ') : 'No games logged';
  return ggNode('div', { display: 'flex', flexDirection: 'column' }, [
    ggNode(
      'div',
      { display: 'flex', fontSize: 22, color: C.muted },
      'Top games',
    ),
    ggNode(
      'div',
      { ...ONE_LINE, fontSize: 30, fontWeight: 700, color: C.secondary },
      text,
    ),
  ]);
}

/** Panel = 1200×630 minus the 32px backdrop margin; border-box so padding stays inside. */
const PANEL: Style = {
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  boxSizing: 'border-box',
  width: 1136,
  height: 566,
  padding: 48,
  borderRadius: 32,
  background: C.panel,
};

const ROOT: Style = {
  display: 'flex',
  width: '100%',
  height: '100%',
  padding: 32,
  background: C.backdrop,
  fontFamily: 'Inter',
};

function stats(m: GgShareCardModel): GgCardNode {
  return ggNode('div', { display: 'flex' }, [
    stat(m.eventsAttended, 'events attended'),
    stat(m.hours, 'hours played'),
    stat(m.playedWithCount, 'people played with'),
  ]);
}

/** The full 1200×630 share card tree for a public Summary DTO. */
export function buildGgShareCardTree(dto: GgPublicSummaryDto): GgCardNode {
  const m = ggShareCardModel(dto);
  const panel = ggNode('div', PANEL, [
    header(m),
    identity(m),
    stats(m),
    topGames(m),
  ]);
  return ggNode('div', ROOT, panel);
}
