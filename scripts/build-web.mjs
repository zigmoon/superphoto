#!/usr/bin/env node
/**
 * Fabrique la version « web » de SuperPhoto, celle qu'on pose par FTP.
 *
 * Le dossier produit ne contient que des liens relatifs : `index.html` cherche
 * `./assets/…` et `./favicon.svg`. On peut donc l'envoyer dans n'importe quel
 * sous-dossier (`/app/`, `/superphoto/`, `/outils/photo/`…) sans rien recompiler.
 *
 *   npm run build:web
 *   node scripts/build-web.mjs --base=/app/   (base explicite, liens absolus)
 *   npm run build:web:zip                     (ajoute superphoto-web.zip)
 */
import { spawnSync } from 'node:child_process';
import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

const argv = process.argv.slice(2);
const baseArg = argv.find((a) => a.startsWith('--base='));
const explicitBase = baseArg ? baseArg.slice('--base='.length) : '';
const wantZip = argv.includes('--zip');

function step(message) {
  process.stdout.write(`\u2022 ${message}\n`);
}

function fail(message) {
  process.stderr.write(`\n\u2716 ${message}\n`);
  process.exit(1);
}

step(explicitBase ? `Base explicite : ${explicitBase}` : 'Liens relatifs (dossier libre)');

const astroCli = path.join(root, 'node_modules', 'astro', 'bin', 'astro.mjs');
const build = spawnSync(process.execPath, [astroCli, 'build'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    ...(explicitBase ? { SUPERPHOTO_BASE: explicitBase } : { SUPERPHOTO_BASE: '' }),
  },
});

if (build.status !== 0) fail('astro build a échoué.');

const indexPath = path.join(dist, 'index.html');

// Astro écrit toujours ses liens en absolu. Pour un dossier posé par FTP, on
// les repasse en relatif : le même dossier marche alors dans /app/, /photo/…
if (!explicitBase) {
  const html = await readFile(indexPath, 'utf8');
  const rewritten = html.replace(/(\b(?:href|src)=")\/(?!\/)/g, '$1./');
  const moved = [...html.matchAll(/(?:href|src)="(\/(?!\/)[^"]*)"/g)].length;
  await writeFile(indexPath, rewritten);
  if (moved > 0) step(`${moved} lien(s) absolu(s) passés en relatif`);
}

const html = await readFile(indexPath, 'utf8');

// Vérification : aucun lien ne doit sortir du dossier une fois posé par FTP.
const absolute = explicitBase
  ? []
  : [...html.matchAll(/(?:href|src)="(\/(?!\/)[^"]*)"/g)].map((m) => m[1]);
if (absolute.length > 0) {
  fail(
    `index.html contient encore ${absolute.length} lien(s) absolu(s) : ${absolute.slice(0, 4).join(', ')}`,
  );
}

const cssDir = path.join(dist, 'assets');
const cssFiles = (await readdir(cssDir).catch(() => [])).filter((f) => f.endsWith('.css'));

// Un `url(/…)` dans le CSS casserait aussi hors racine : on le signale plutôt
// que de produire un dossier qui a l'air bon.
const cssTexts = [];
for (const file of cssFiles) {
  const css = await readFile(path.join(cssDir, file), 'utf8');
  if (/url\(\s*['"]?\/(?!\/)/.test(css)) fail(`${file} contient un url(/…) absolu.`);
  cssTexts.push(css);
}

// dist/ ne doit contenir *que* ce que le serveur sert réellement.
//   • les `.map` ne servent qu'au débogage local (et exposent les sources TS) ;
//   • les visuels de marque que personne ne référence (mark*.svg, icon-64…)
//     restent dans public/ pour le dépôt, mais n'ont rien à faire en ligne.
const manifestText = await readFile(path.join(dist, 'site.webmanifest'), 'utf8').catch(() => '');
const served = new Set();
for (const text of [html, manifestText, ...cssTexts]) {
  for (const m of text.matchAll(/brand\/[A-Za-z0-9._-]+/g)) served.add(path.basename(m[0]));
}
const pruned = [];
for (const dir of [cssDir, path.join(dist, 'brand')]) {
  for (const file of await readdir(dir).catch(() => [])) {
    const unusedBrand = dir.endsWith('brand') && !served.has(file);
    if (!file.endsWith('.map') && !unusedBrand) continue;
    await rm(path.join(dir, file), { force: true });
    pruned.push(file);
  }
}
if (pruned.length > 0) step(`${pruned.length} fichier(s) inutile(s) retiré(s) : ${pruned.join(', ')}`);

const relative = [...html.matchAll(/(?:href|src)="(\.\/[^"]*)"/g)].map((m) => m[1]);
const linked = [...html.matchAll(/(?:href|src)="([^"#][^"]*)"/g)].length;

const hasFavicon = await stat(path.join(dist, 'favicon.svg')).then(
  () => true,
  () => false,
);
if (!hasFavicon) fail('favicon.svg manque dans dist/.');

const size = await stat(path.join(dist, 'index.html')).then((s) => s.size);
step(
  `dist/index.html : ${(size / 1024).toFixed(1)} Ko, ${linked} ressource(s) liée(s), favicon présent`,
);

if (wantZip) {
  const zipPath = path.join(root, 'superphoto-web.zip');
  await rm(zipPath, { force: true });
  // On liste explicitement les entrées de premier niveau : l'archive s'ouvre
  // alors sur `index.html`, `assets/`… sans dossier `.` parasite.
  const entries = await readdir(dist);
  const zipped = spawnSync(
    process.platform === 'win32' ? 'tar.exe' : 'zip',
    process.platform === 'win32'
      ? ['-a', '-c', '-f', zipPath, '-C', dist, ...entries]
      : ['-r', '-q', zipPath, ...entries],
    { cwd: dist, stdio: 'inherit' },
  );
  if (zipped.status !== 0) fail('Compression impossible — compressez dist/ à la main.');
  const zipSize = await stat(zipPath).then((s) => s.size);
  step(`superphoto-web.zip : ${(zipSize / 1024).toFixed(1)} Ko`);
}

process.stdout.write(
  '\n\u2714 Version web prête : envoyez le CONTENU de dist/ par FTP.\n' +
    '   (test local : npm run preview:web)\n',
);
