import { defineConfig } from 'astro/config';

/**
 * SuperPhoto — configuration Astro.
 *
 * Le frontend est 100 % statique : Tauri charge `dist/` dans sa webview et le
 * backend Rust expose les dialogues natifs et l'entrée/sortie de fichiers.
 * `devUrl` (voir src-tauri/tauri.conf.json) pointe sur ce serveur en mode dev.
 */
export default defineConfig({
  site: 'https://superphoto.cc',
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
    build: {
      assetsInlineLimit: 0,
      sourcemap: true,
    },
  },
});
