import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://castwright.sinist3r.lol',
  integrations: [
    starlight({
      title: 'Castwright',
      description: 'Overlays, alerts, chat and automation for Twitch streamers. Free and open source.',
      logo: { src: './src/assets/logo.svg' },
      favicon: '/favicon.svg',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/AmeliaFromFinance/castwright' }],
      editLink: { baseUrl: 'https://github.com/AmeliaFromFinance/castwright/edit/main/docs-site/' },
      lastUpdated: true,
      customCss: ['./src/styles/theme.css'],
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Install', slug: 'guide/install' },
            { label: 'First-time setup', slug: 'guide/first-run' },
            { label: 'Your first overlay', slug: 'guide/quick-start' }
          ]
        },
        {
          label: 'Guide',
          items: [
            { label: 'Overlays', slug: 'guide/overlays' },
            { label: 'Overlay editor', slug: 'guide/overlay-editor' },
            { label: 'Alerts', slug: 'guide/alerts' },
            { label: 'Automation', slug: 'guide/automation' },
            { label: 'Activity', slug: 'guide/activity' },
            { label: 'Settings and themes', slug: 'guide/settings' },
            { label: 'Stream Deck and hotkeys', slug: 'guide/stream-deck' },
            { label: 'Troubleshooting', slug: 'guide/troubleshooting' },
            { label: 'FAQ', slug: 'guide/faq' }
          ]
        },
        { label: 'Reference', items: [{ autogenerate: { directory: 'reference' } }] },
        { label: 'Screenshots', slug: 'gallery' },
        { label: 'Build from source', slug: 'development' }
      ]
    })
  ]
});
