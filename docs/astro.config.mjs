import { defineConfig } from 'astro/config';
import remarkCallouts from './src/plugins/remark-callouts.mjs';

// Raid Ledger marketing site (ROK-2051): a plain Astro landing page, no
// Starlight. GitHub Pages serves it under /Raid-Ledger, so every internal
// asset/link goes through import.meta.env.BASE_URL (see src/data/site.ts).
// Only src/pages + public are published; the markdown elsewhere in docs/
// (runbooks, spikes, plans, design-system docs) never reaches dist/.
// Guides live in src/pages/guides/*.md with layouts/Guide.astro. The app links
// to /Raid-Ledger/guides/wow-forever/ (web WOW_FOREVER_GUIDE_URL) — keep that path.
export default defineConfig({
  site: 'https://sjdodge123.github.io',
  base: '/Raid-Ledger',
  markdown: {
    // `:::note … :::` asides, carried over from the Starlight docs.
    remarkPlugins: [remarkCallouts],
  },
});
