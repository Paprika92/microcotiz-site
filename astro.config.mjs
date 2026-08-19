import { defineConfig } from 'astro/config';

// GitHub Pages : le site est servi sous /microcotiz-site/.
// build.format 'file' : chaque page sort en <nom>.html à la racine de dist/,
// pour respecter le contrat d'URLs (docs/URLS-A-PRESERVER.md) — pas de
// dossiers avec trailing slash, GitHub Pages ne redirige pas.
export default defineConfig({
  site: 'https://paprika92.github.io',
  base: '/microcotiz-site',
  build: {
    format: 'file',
  },
});
