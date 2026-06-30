import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://sjdodge123.github.io',
  base: '/Raid-Ledger',
  integrations: [
    starlight({
      title: 'Raid Ledger',
      description:
        'Run your entire raid operation from inside Discord. A self-hosted, Discord-native dashboard for gaming communities — signups, voice attendance, reminders, and game votes, all where your community already lives.',
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
