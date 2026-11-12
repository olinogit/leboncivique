// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://leboncivique.fr',
  trailingSlash: 'always',
  output: 'static',
  i18n: {
    locales: ['fr', 'en'],
    defaultLocale: 'fr',
    routing: { prefixDefaultLocale: false },
  },
  build: {
    // Aucune feuille de style ni script en ligne : la CSP peut rester stricte (style-src 'self', script-src 'self').
    inlineStylesheets: 'never',
    format: 'directory',
  },
  vite: {
    build: { assetsInlineLimit: 0 },
  },
  integrations: [
    sitemap({
      i18n: { defaultLocale: 'fr', locales: { fr: 'fr-FR', en: 'en' } },
      filter: (page) => !page.includes('/404'),
    }),
  ],
});
