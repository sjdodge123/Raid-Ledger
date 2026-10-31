import { defineConfig } from 'astro/config';

// Raid Ledger marketing site (ROK-2051): a plain Astro landing page, no
// Starlight. GitHub Pages serves it under /Raid-Ledger, so every internal
// asset/link goes through import.meta.env.BASE_URL (see src/data/site.ts).
// Only src/pages + public are published; the markdown elsewhere in docs/
// (runbooks, spikes, plans, design-system docs) never reaches dist/.
export default defineConfig({
  site: 'https://sjdodge123.github.io',
  base: '/Raid-Ledger',
});
