import { defineConfig } from 'astro/config';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/**
 * SuperPhoto — configuration Astro.
 *
 * Le frontend est 100 % statique : Tauri charge `dist/` dans sa webview et le
 * backend Rust expose les dialogues natifs et l'entrée/sortie de fichiers.
 * `devUrl` (voir src-tauri/tauri.conf.json) pointe sur ce serveur en mode dev.
 *
 * Deux cibles de sortie, même code source :
 *   • `npm run build`      → chemins absolus (« /assets/… »), pour le bureau et
 *                            un déploiement à la racine du domaine.
 *   • `npm run build:web`  → mêmes fichiers, puis `scripts/build-web.mjs`
 *                            réécrit les liens en relatif (« ./assets/… »)
 *                            pour poser le dossier par FTP n'importe où.
 * SUPERPHOTO_BASE force une base explicite (ex. « /app/ ») pour un site servi
 * dans un sous-dossier fixe.
 */
const base = process.env.SUPERPHOTO_BASE || '/';

export default defineConfig({
  site: 'https://superphoto.cc',
  base,
  srcDir: 'src',
  publicDir: 'public',
  outDir: 'dist',

  build: {
    format: 'file',
    assets: 'assets',
    inlineStylesheets: 'never',
  },

  trailingSlash: 'ignore',
  devToolbar: { enabled: false },

  server: {
    host: true,
    port: 4321,
    strictPort: true,
  },

  vite: {
    define: {
      // Version unique : package.json alimente l'interface (onglet À propos).
      __APP_VERSION__: JSON.stringify(version),
    },
    build: {
      assetsInlineLimit: 0,
      sourcemap: true,
    },
  },
});

