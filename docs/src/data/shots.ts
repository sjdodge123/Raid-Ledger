import type { ImageMetadata } from 'astro';

/**
 * Screenshot slots S1–S12 (planning-artifacts/ROK-2051-marketing-site/SHOTLIST.md).
 *
 * A real capture is `src/assets/screenshots/<id>-<slug>.png` (and optionally
 * `<id>-<slug>-light.png` for the light theme); it is picked up automatically.
 * A slot marked `withheld` is not rendered at all, even if a file exists
 * locally, so an unapproved capture can never ship by accident.
 */
export type ShotId =
  | 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6'
  | 'S7' | 'S8' | 'S9' | 'S10' | 'S11' | 'S12';

export interface Shot {
  slug: string;
  title: string;
  desc: string;
  /** Text in the frame's address bar (omitted for phone frames). */
  bar?: string;
  phone?: boolean;
  /** CSS aspect-ratio for the placeholder body, e.g. '16 / 7'. */
  aspect?: string;
  /** Alt text: what the fictional scene shows (no real people's names). */
  alt: string;
  /** Why the slot is hidden; set while its capture is pending. */
  withheld?: string;
}

export const SHOTS: Record<ShotId, Shot> = {
  S1: { slug: 'hub-overview', title: 'Guild hub overview: "Emberfall"', desc: 'Hero, leader post, upcoming events, attendance leaderboard, Gallery', bar: 'raid.hearthside.gg/hubs/emberfall', alt: 'The Emberfall guild hub in Raid Ledger: a hero banner, a leader post, upcoming events, an attendance leaderboard and a Gallery of member screenshots' },
  S2: { slug: 'discord-welcome', title: 'Pinned "Join Raid Ledger" post in Discord', desc: 'Discord client capture, fictional server "Hearthside Gaming"', bar: 'Discord · #welcome', alt: 'The pinned Join Raid Ledger post in the Hearthside Gaming Discord server', withheld: 'TODO(ROK-2051): S2 Discord client capture pending operator' },
  S3: { slug: 'game-time-phone', title: 'First-run setup on a phone', desc: 'Game Time step', phone: true, alt: 'The first-run setup on a phone at the Game Time step, with weekday evenings painted in as the times the member plays' },
  S4: { slug: 'event-roster', title: 'Event page with a full role roster', desc: 'Tanks, healers and DPS filled, two on bench, one "running late"', bar: 'raid.hearthside.gg/events/…', alt: 'A Molten Core event page with a full role roster: tanks, healers and DPS filled, two members on the bench and one marked running late' },
  S5: { slug: 'scheduling-poll', title: 'Scheduling poll with busy hours', desc: 'Leading time highlighted, Rally in the menu', bar: 'raid.hearthside.gg/polls/…', aspect: '16 / 7', alt: 'A scheduling poll grid with busy hours shaded, the leading time highlighted and the Rally and Lock options open in the menu' },
  S6: { slug: 'valheim-map', title: 'Valheim server hub, Map tab', desc: 'Pins, portals and death markers on the explored map', bar: 'raid.hearthside.gg/hubs/stonewake', alt: 'The Stonewake Valheim server hub Map tab with pins, portals and death markers', withheld: 'TODO(ROK-2051): S6 Valheim map pending operator (fixture map is a placeholder)' },
  S7: { slug: 'lineup-phone', title: 'Community lineup vote on a phone', desc: 'Common Ground ranking', phone: true, alt: 'A community lineup vote on a phone, ranking games by how many members already own them' },
  S8: { slug: 'insights', title: 'Community Insights: reliability and trends', desc: 'Attended / late / no-show columns over 90 days of history', bar: 'raid.hearthside.gg/insights', alt: 'Community Insights over 90 days: a reliability leaderboard with attended, late and no-show columns beside attendance trends' },
  S9: { slug: 'guild-members', title: 'Guild roster: Emberfall Members tab', desc: 'Roster by rank, class dots, profession badges', bar: 'raid.hearthside.gg/guilds/emberfall', alt: 'The Emberfall guild Members tab: the roster by rank with class colours, levels and profession badges, and a panel showing who is saved to which raid' },
  S10: { slug: 'bg3-campaign', title: 'BG3 campaign hub: The Gilded Road', desc: 'Party, where we are, session history', bar: 'raid.hearthside.gg/hubs/gilded-road', alt: "The Gilded Road Baldur's Gate 3 campaign hub: the party, where the group left off and a history of past sessions" },
  S11: { slug: 'calendar-month', title: 'Calendar, month view', desc: 'Two weeks of events with hub chips and server hours', bar: 'raid.hearthside.gg/calendar', alt: 'The calendar month view with two weeks of raids, Valheim nights and game nights, each tagged with its hub' },
  S12: { slug: 'og-card', title: 'Social card', desc: 'S1 + the embed + wordmark at 1200×630', alt: 'Raid Ledger social card' },
};

// Withheld slots are excluded here too: an eager-globbed image ships its
// original file to dist/ even when nothing renders it. Lift a slot's exclusion
// when its `withheld` line goes. S12 is the og:image, imported by Base.astro.
const files = import.meta.glob<{ default: ImageMetadata }>(
  [
    '../assets/screenshots/*.png',
    '!../assets/screenshots/S2-*',
    '!../assets/screenshots/S6-*',
    '!../assets/screenshots/S12-*',
  ],
  { eager: true },
);

function asset(name: string): ImageMetadata | undefined {
  return files[`../assets/screenshots/${name}`]?.default;
}

export interface ResolvedShot extends Shot {
  id: ShotId;
  /** The image to show (dark theme, or both themes when `light` is absent). */
  src?: ImageMetadata;
  /** Optional light-theme variant. */
  light?: ImageMetadata;
}

export function resolveShot(id: ShotId): ResolvedShot {
  const shot = SHOTS[id];
  const real = shot.withheld ? undefined : asset(`${id}-${shot.slug}.png`);
  const light = real ? asset(`${id}-${shot.slug}-light.png`) : undefined;
  return { ...shot, id, ...(real ? { src: real } : {}), ...(light ? { light } : {}) };
}

/** Slots to render: withheld captures are skipped entirely. */
export function visibleShots(ids: readonly ShotId[]): ShotId[] {
  return ids.filter((id) => !SHOTS[id].withheld);
}
