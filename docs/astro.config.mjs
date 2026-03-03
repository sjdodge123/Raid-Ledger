import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://sjdodge123.github.io',
  base: '/Raid-Ledger',
  integrations: [
    starlight({
      title: 'Raid Ledger',
      description:
        'A unified dashboard for gaming communities — plan raids and events, track schedules and attendance, and boost engagement.',
      customCss: ['./src/styles/custom.css'],
      pagefind: false,
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/sjdodge123/Raid-Ledger' },
      ],
      sidebar: [
        { label: 'Home', slug: 'index' },
      ],
      favicon: '/favicon.svg',
    }),
  ],
});
