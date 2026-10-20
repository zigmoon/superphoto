#!/usr/bin/env node
/**
 * Rasterise les fichiers de marque SVG en PNG (fond transparent).
 *
 * `sharp` est déjà présent dans l'arbre de dépendances (via Astro) et embarque
 * librsvg : il rend les masques SVG exactement comme le navigateur, ce qui est
 * indispensable pour les trous du logo.
 *
 *   node scripts/brand-png.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');

function step(message) {
  process.stdout.write(`\u2022 ${message}\n`);
}

async function render(svgPath, pngPath, size, { background = null } = {}) {
  const svg = await readFile(svgPath);
  let pipeline = sharp(svg, { density: 384 }).resize(size, size, {
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });
  if (background) pipeline = pipeline.flatten({ background });
  await pipeline.png({ compressionLevel: 9 }).toFile(pngPath);
  step(`${path.relative(root, pngPath)} (${size}×${size})`);
}

const appIcon = path.join(publicDir, 'brand', 'app-icon.svg');

await render(appIcon, path.join(publicDir, 'brand', 'icon-64.png'), 64);
await render(appIcon, path.join(publicDir, 'brand', 'icon-192.png'), 192);
await render(appIcon, path.join(publicDir, 'brand', 'icon-512.png'), 512);
await render(appIcon, path.join(publicDir, 'favicon-32.png'), 32);

// iOS ne gère pas la transparence sur l'écran d'accueil : on garde un fond
// clair (jamais noir) — les anneaux sombres du logo gardent la marque lisible.
await render(appIcon, path.join(publicDir, 'apple-touch-icon.png'), 180, {
  background: { r: 255, g: 255, b: 255 },
});

// Carte de partage 1200 × 630 : fond clair, marque officielle centrée.
const artwork = (await readFile(appIcon, 'utf8'))
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .replace(/<title>[\s\S]*?<\/title>/, '');
const card = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#f8f8f8"/>
  <g transform="translate(390 115) scale(0.84)">
    ${artwork}
  </g>
</svg>`;
await sharp(Buffer.from(card), { density: 144 })
  .resize(1200, 630)
  .png({ compressionLevel: 9 })
  .toFile(path.join(publicDir, 'brand', 'og-image.png'));
step('public/brand/og-image.png (1200×630)');

// Logo du README GitHub : une paire, choisie par `prefers-color-scheme`.
//   • fond clair  → l'œuvre bi-ton (plaques blanches, anneaux d'encre) : les
//     anneaux dessinent la marque, comme dans le fichier d'origine ;
//   • fond sombre → la variante pleinement blanche, sans aucun pixel sombre,
//     puisque les anneaux noirs y seraient invisibles.
for (const [source, target, label] of [
  ['mark.svg', '.github/brand-logo-light.png', 'fond clair'],
  ['mark-white.svg', '.github/brand-logo-dark.png', 'fond sombre'],
]) {
  await sharp(await readFile(path.join(publicDir, 'brand', source)), { density: 384 })
    .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(root, target));
  step(`${target} (${label})`);
}

// Icônes du bureau : Tauri dérive toutes les tailles (ico, icns, png) d'un
// unique 1024 × 1024 rendu depuis la version **blanche** de la marque.
// Aucun fond : le PNG est transparent, donc le logo se pose sur la barre des
// tâches et le Dock sans pastille carrée derrière lui.
await sharp(await readFile(path.join(publicDir, 'brand', 'mark-white.svg')), { density: 512 })
  .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile(path.join(root, 'src-tauri', 'app-icon.png'));
step('src-tauri/app-icon.png (1024×1024, marque blanche, transparent) — puis `npx tauri icon`');
