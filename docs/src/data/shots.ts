import type { ImageMetadata } from 'astro';

/**
 * Screenshot slots S1–S12 (planning-artifacts/ROK-2051-marketing-site/SHOTLIST.md).
 *
 * To swap in a real capture: drop `src/assets/screenshots/<id>-<slug>.png`
 * (and optionally `<id>-<slug>-light.png` for the light theme) — it is picked
 * up automatically — then delete the slot's `fallback` line below.
 * Until then a slot shows its `fallback` (the closest June screenshot) or,
 * with neither, a styled placeholder frame.
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
  /** Interim June screenshot file name in src/assets/screenshots/. */
  fallback?: string;
}

export const SHOTS: Record<ShotId, Shot> = {
  S1: { slug: 'hub-overview', title: 'Guild hub overview: "Emberfall"', desc: 'Hero, leader post, upcoming events, attendance leaderboard, Gallery', bar: 'raid.hearthside.gg/hubs/emberfall' },
  S2: { slug: 'discord-welcome', title: 'Pinned "Join Raid Ledger" post in Discord', desc: 'Discord client capture, fictional server "Hearthside Gaming"', bar: 'Discord · #welcome' },
  S3: { slug: 'game-time-phone', title: 'First-run setup on a phone', desc: 'Game Time step', phone: true, fallback: 'game-time.png' },
  S4: { slug: 'event-roster', title: 'Event page with a full role roster', desc: 'Tanks, healers and DPS filled, two on bench, one "running late"', bar: 'raid.hearthside.gg/events/…', fallback: 'event-with-roster.png' },
  S5: { slug: 'scheduling-poll', title: 'Scheduling poll with busy hours', desc: 'Leading time highlighted, Rally in the menu', bar: 'raid.hearthside.gg/polls/…', aspect: '16 / 7' },
  S6: { slug: 'valheim-map', title: 'Valheim server hub, Map tab', desc: 'Pins, portals and death markers on the explored map', bar: 'raid.hearthside.gg/hubs/stonewake' },
  S7: { slug: 'lineup-phone', title: 'Community lineup vote on a phone', desc: 'Common Ground ranking', phone: true },
  S8: { slug: 'insights', title: 'Community Insights: reliability and trends', desc: 'Attended / late / no-show columns over 90 days of history', bar: 'raid.hearthside.gg/insights' },
  S9: { slug: 'guild-members', title: 'Guild roster: Emberfall Members tab', desc: 'Roster by rank, class dots, profession badges', bar: 'raid.hearthside.gg/guilds/emberfall' },
  S10: { slug: 'bg3-campaign', title: 'BG3 campaign hub: The Gilded Road', desc: 'Party, where we are, session history', bar: 'raid.hearthside.gg/hubs/gilded-road' },
  S11: { slug: 'calendar-month', title: 'Calendar, month view', desc: 'Two weeks of events with hub chips and server hours', bar: 'raid.hearthside.gg/calendar' },
  S12: { slug: 'og-card', title: 'Social card', desc: 'S1 + the embed + wordmark at 1200×630' },
};

const files = import.meta.glob<{ default: ImageMetadata }>(
  '../assets/screenshots/*.png',
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
  /** True while `src` is an interim June screenshot, not the real capture. */
  interim: boolean;
}

export function resolveShot(id: ShotId): ResolvedShot {
  const shot = SHOTS[id];
  const real = asset(`${id}-${shot.slug}.png`);
  const fallback = shot.fallback ? asset(shot.fallback) : undefined;
  const light = real ? asset(`${id}-${shot.slug}-light.png`) : undefined;
  return {
    ...shot,
    id,
    ...(real ?? fallback ? { src: real ?? fallback } : {}),
    ...(light ? { light } : {}),
    interim: !real && Boolean(fallback),
  };
}
