// One place for the site's outbound links and base-path handling.
const BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/');

/** Resolve a path inside the site against the GitHub Pages base (/Raid-Ledger/). */
export function withBase(path = ''): string {
  return BASE + path.replace(/^\//, '');
}

export const REPO = 'https://github.com/sjdodge123/Raid-Ledger';

export const LINKS = {
  repo: REPO,
  // README "## Setup — the three required steps" (GitHub drops the em dash).
  setup: `${REPO}#setup--the-three-required-steps`,
  wiki: `${REPO}/wiki`,
  releases: `${REPO}/releases`,
  issues: `${REPO}/issues`,
  license: `${REPO}/blob/main/LICENSE`,
  ledgerLink: 'https://github.com/sjdodge123/ledger-link',
} as const;

export const SITE = {
  title: 'Raid Ledger — grow a Discord gaming community that shows up',
  description:
    'Raid Ledger runs and grows your Discord gaming community: events members sign up for in Discord, attendance from voice, polls that pick the night and the game, and a hub for every guild, server and campaign. Free, open source, self-hosted.',
} as const;
