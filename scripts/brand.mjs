#!/usr/bin/env node
/**
 * Marque officielle SuperPhoto.
 *
 * Source unique : `super_photo_blanc.svg`, déposé à la racine du projet (export
 * Illustrator). Ce fichier contient quatorze calques de recherche, dont **un
 * seul est visible** : `Calque_13`, le logo retenu. C'est lui, et rien d'autre,
 * que l'on diffuse.
 *
 * Le script ne redessine pas la marque : il recopie la géométrie officielle à
 * l'identique (mêmes polygones, mêmes tracés) en se contentant de
 *   • retirer l'en-tête XML, le DOCTYPE et l'énorme bloc PGF d'Illustrator ;
 *   • supprimer les calques masqués (`display="none"`) ;
 *   • rendre les couleurs explicites : plaques blanches `#FFFFFF`, anneaux `ink`.
 *
 * Résultat : un SVG de quelques kilo-octets, identique au logo déposé, qui reste
 * lisible sur fond clair comme sur fond sombre — les anneaux sombres détourent
 * les plaques blanches, sans aucune pastille de fond.
 *
 *   npm run brand       (écrit les SVG)
 *   npm run brand:png   (rasterise ensuite les PNG)
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(root, 'super_photo_blanc.svg');
const INK = '#111114';
const PLATE = '#FFFFFF';

function step(message) {
  process.stdout.write(`\u2022 ${message}\n`);
}

function fail(message) {
  process.stderr.write(`\u2716 ${message}\n`);
  process.exit(1);
}

function trim(value) {
  return Math.round(value * 100) / 100;
}

/** Réduit les nombres à deux décimales et supprime les espaces superflus. */
function compact(markup) {
  return markup
    .replace(/\s+/g, ' ')
    .replace(/-?\d+\.\d{3,}/g, (number) => String(trim(Number(number))))
    .trim();
}

const source = await readFile(SOURCE, 'utf8').catch(() => {
  fail('super_photo_blanc.svg introuvable à la racine du projet.');
});

const viewBox = /viewBox="([^"]+)"/.exec(source)?.[1] ?? '0 0 500 500';

/**
 * Renvoie le contenu du premier `<g id="…">` de premier niveau qui n'est pas
 * masqué. On suit l'imbrication des balises `<g>` pour s'arrêter exactement sur
 * la balise fermante du calque.
 */
function extractVisibleLayer(svg) {
  const openTag = /<g\b[^>]*\bid="[^"]+"[^>]*>/g;
  let match;
  while ((match = openTag.exec(svg)) !== null) {
    if (/display="none"/.test(match[0])) continue;
    const start = match.index + match[0].length;
    let depth = 1;
    const tag = /<\/?g\b[^>]*>/g;
    tag.lastIndex = start;
    let inner;
    while ((inner = tag.exec(svg)) !== null) {
      depth += inner[0].startsWith('</') ? -1 : 1;
      if (depth === 0) {
        return { id: /id="([^"]+)"/.exec(match[0])?.[1] ?? '', body: svg.slice(start, inner.index) };
      }
    }
    return { id: '', body: svg.slice(start) };
  }
  return null;
}

const layer = extractVisibleLayer(source);
if (!layer) fail('Aucun calque visible dans super_photo_blanc.svg.');

// Couleurs explicites. Les `<polygon>` n'ont pas de `fill` dans le fichier
// d'origine (ils héritent) ; les `<path>` non plus (noir par défaut). On écrit
// donc les deux, et on choisit la couleur des anneaux : `INK` pour la version
// bi-ton (fond clair), `PLATE` pour la version blanche (fond sombre), où les
// anneaux se fondent dans les plaques et donnent une marque pleinement blanche.
function paint(ringColor) {
  const markup = compact(layer.body)
    .replace(/<polygon\b([^>]*?)\/?>/g, (_, attributes) => {
      const clean = String(attributes).replace(/\sfill="[^"]*"/g, '');
      return `<polygon fill="${PLATE}"${clean}/>`;
    })
    .replace(/<path\b([^>]*?)\/?>/g, (_, attributes) => {
      const clean = String(attributes).replace(/\sfill="[^"]*"/g, '');
      return `<path fill="${ringColor}"${clean}/>`;
    })
    .replace(/\s+\/>/g, '/>');

  // Les tracés Illustrator contiennent des retours à la ligne : on les garde
  // hors des attributs (ils sont déjà compactés) mais on nettoie les `d` pour
  // rester lisibles dans le fichier produit.
  return markup.replace(/\sd="([^"]*)"/g, (_, d) => ` d="${String(d).replace(/\s+/g, ' ').trim()}"`);
}

const artwork = paint(INK);

/** Réindente un fragment SVG : une balise par ligne, indentation par niveau. */
function pretty(markup) {
  const tokens = markup.match(/<[^>]+>/g) ?? [];
  let depth = 0;
  const lines = [];
  for (const token of tokens) {
    if (/^<\//.test(token)) depth = Math.max(0, depth - 1);
    lines.push(`${'  '.repeat(depth)}${token}`);
    if (/^<(?!\/)/.test(token) && !/\/>$/.test(token)) depth += 1;
  }
  return lines.join('\n');
}

function svgDocument(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img">
  <title>SuperPhoto</title>
${pretty(body)
  .split('\n')
  .map((line) => `  ${line}`)
  .join('\n')}
</svg>
`;
}

const document = svgDocument(artwork);
const documentWhite = svgDocument(paint(PLATE));

const brandDir = path.join(root, 'public', 'brand');
const assetDir = path.join(root, 'src', 'assets', 'brand');
await mkdir(brandDir, { recursive: true });
await mkdir(assetDir, { recursive: true });

// La même œuvre partout : barre supérieure, favicon, icônes d'application,
// images du README. Un seul dessin, donc un seul comportement visuel.
for (const target of [
  path.join(assetDir, 'app-icon.svg'),
  path.join(brandDir, 'app-icon.svg'),
  path.join(brandDir, 'mark.svg'),
  path.join(brandDir, 'mark-light.svg'),
  path.join(brandDir, 'mark-dark.svg'),
  path.join(root, 'public', 'favicon.svg'),
]) {
  await writeFile(target, document);
}

// Variante pleinement blanche : même géométrie, anneaux de la couleur des
// plaques. Elle ne sert qu'en thème sombre, là où un logo à anneaux noirs
// disparaîtrait (le README GitHub s'en sert via `<picture>`).
await writeFile(path.join(brandDir, 'mark-white.svg'), documentWhite);

const plates = (artwork.match(/<polygon\b/g) ?? []).length;
const rings = (artwork.match(/<path\b/g) ?? []).length;

step(`calque officiel : ${layer.id} — ${plates} plaques, ${rings} anneaux`);
step(`super_photo_blanc.svg : ${(source.length / 1024).toFixed(0)} Ko → ${(document.length / 1024).toFixed(1)} Ko`);
step('écrit : public/brand/{app-icon,mark,mark-light,mark-dark,mark-white}.svg, src/assets/brand/app-icon.svg, public/favicon.svg');
step('aucun fond, aucune pastille : les anneaux détourent les plaques blanches');
