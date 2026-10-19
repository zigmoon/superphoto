#!/usr/bin/env node
/**
 * Fabrique les fichiers de marque à partir de l'export Illustrator officiel
 * `super_photo_blanc.svg`, déposé à la racine du projet (source unique).
 *
 * Cet export contient 40+ calques masqués, un DOCTYPE avec DTD externe (qui rend
 * le SVG « non-origin-clean » : impossible à lire dans un canvas) et 250 Ko de
 * métadonnées. On ne garde que le calque visible, puis on recompose la marque :
 *   • les 5 feuilles (polygones) sont l'encre — recolorée en `currentColor` ;
 *   • les 5 anneaux (chemins) séparent les feuilles ; dans l'export ils sont
 *     peints avec la couleur du fond, ce qui donnerait une plaque opaque. Ils
 *     deviennent donc de vrais **trous** (masques), empilés dans le même ordre
 *     de peinture que l'original pour retrouver exactement le dessin officiel.
 *
 *   node scripts/brand.mjs
 *
 * Sorties :
 *   public/brand/mark.svg        marque adaptative (currentColor)
 *   public/brand/mark-light.svg  marque sombre  (<img>, e-mails)
 *   public/brand/mark-dark.svg   marque claire
 *   public/brand/app-icon.svg    icône carrée, marque ajustée au cadre
 *   public/favicon.svg           favicon (suit `prefers-color-scheme`)
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public', 'brand');

const SOURCE = path.join(root, 'super_photo_blanc.svg');

function step(message) {
  process.stdout.write(`\u2022 ${message}\n`);
}

/** Retire prolog, DOCTYPE (DTD externe), commentaires et métadonnées. */
function cleanSource(source) {
  return source
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?\]>/g, '')
    .replace(/<!DOCTYPE[^>]*>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<metadata[\s\S]*?<\/metadata>/g, '')
    .replace(/<title[\s\S]*?<\/title>/g, '')
    .replace(/<desc[\s\S]*?<\/desc>/g, '');
}

function findMatching(source, openIndex, tag) {
  const re = new RegExp(`<${tag}\\b|</${tag}>`, 'g');
  re.lastIndex = openIndex;
  let depth = 0;
  let match;
  while ((match = re.exec(source))) {
    if (match[0].startsWith(`</`)) depth -= 1;
    else depth += 1;
    if (depth === 0) return { start: openIndex, end: re.lastIndex };
  }
  return null;
}

/** Supprime tous les groupes masqués (`display="none"`), imbrication comprise. */
function dropHiddenGroups(source) {
  let output = source;
  for (;;) {
    const match = /<g\b[^>]*display="none"[^>]*>/i.exec(output);
    if (!match) return output;
    const span = findMatching(output, match.index, 'g');
    if (!span) return output;
    output = output.slice(0, span.start) + output.slice(span.end);
  }
}

/** Retire l'enveloppe `<switch>` / `<foreignObject>` propre à Illustrator. */
function unwrapSwitch(source) {
  return source
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/g, '')
    .replace(/<\/?switch\b[^>]*>/g, '')
    .replace(/<i:aipgf[\s\S]*?<\/i:aipgf>/g, '');
}

function extractShapes(source) {
  const body = unwrapSwitch(dropHiddenGroups(cleanSource(source)));
  const shapes = [];
  for (const match of body.matchAll(/<(path|polygon|rect|circle)\b([^>]*?)\/?>/g)) {
    const tag = match[1];
    const attrs = match[2] ?? '';
    const geometry = {
      path: /d="([^"]*)"/,
      polygon: /points="([^"]*)"/,
      rect: /(x|x)="([^"]*)"/,
      circle: /cx="([^"]*)"/,
    }[tag];
    if (!geometry || !geometry.test(attrs)) continue;
    const fill = /fill="([^"]*)"/.exec(attrs)?.[1]?.toUpperCase() ?? '';
    shapes.push({ tag, attrs, fill });
  }
  return shapes;
}

function numbersIn(value) {
  return (value.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

function boundingBox(shapes) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const shape of shapes) {
    if (shape.tag === 'polygon') {
      const points = numbersIn(/points="([^"]*)"/.exec(shape.attrs)?.[1] ?? '');
      for (let i = 0; i + 1 < points.length; i += 2) {
        minX = Math.min(minX, points[i]);
        maxX = Math.max(maxX, points[i]);
        minY = Math.min(minY, points[i + 1]);
        maxY = Math.max(maxY, points[i + 1]);
      }
    } else if (shape.tag === 'path') {
      // Approximation : toutes les coordonnées du tracé, sans distinction
      // absolu/relatif. Suffisant pour un logo dont les courbes sont déjà
      // exprimées en coordonnées absolues.
      const numbers = numbersIn(/d="([^"]*)"/.exec(shape.attrs)?.[1] ?? '');
      const xs = numbers.filter((_, index) => index % 2 === 0);
      const ys = numbers.filter((_, index) => index % 2 === 1);
      for (const x of xs) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
      for (const y of ys) {
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 500, h: 500 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Géométrie seule d'une forme, sans attribut de remplissage. */
function geometryOf(shape) {
  if (shape.tag === 'path') return `d="${/d="([^"]*)"/.exec(shape.attrs)?.[1] ?? ''}"`;
  if (shape.tag === 'polygon') return `points="${/points="([^"]*)"/.exec(shape.attrs)?.[1] ?? ''}"`;
  if (shape.tag === 'circle') {
    const cx = /cx="([^"]*)"/.exec(shape.attrs)?.[1] ?? '0';
    const cy = /cy="([^"]*)"/.exec(shape.attrs)?.[1] ?? '0';
    const r = /r="([^"]*)"/.exec(shape.attrs)?.[1] ?? '0';
    return `cx="${cx}" cy="${cy}" r="${r}"`;
  }
  const x = /x="([^"]*)"/.exec(shape.attrs)?.[1] ?? '0';
  const y = /y="([^"]*)"/.exec(shape.attrs)?.[1] ?? '0';
  const w = /width="([^"]*)"/.exec(shape.attrs)?.[1] ?? '0';
  const h = /height="([^"]*)"/.exec(shape.attrs)?.[1] ?? '0';
  return `x="${x}" y="${y}" width="${w}" height="${h}"`;
}

/**
 * Marque sur fond **transparent**.
 *
 * L'ordre de peinture officiel est : feuille 1, anneau 1, feuille 2, anneau 2…
 * chaque anneau étant peint par-dessus tout ce qui précède. Un masque unique
 * appliqué à la fin creuserait donc les anneaux à travers *toutes* les feuilles,
 * y compris celles qui doivent repeindre par-dessus — d'où des bords dentelés.
 *
 * On reproduit l'empilement réel avec des groupes imbriqués :
 *   G1 = masque(anneau 1)[ feuille 1 ]
 *   Gn = masque(anneau n)[ G(n-1), feuille n ]
 * Le résultat est identique à l'export Illustrator, mais sans couleur de fond.
 */
function knockoutMark(sheets, ink, { idPrefix = 'sp-ko' } = {}) {
  const mask = (ring, index) => `    <mask id="${idPrefix}-${index}" maskUnits="userSpaceOnUse" x="0" y="0" width="${ARTBOARD}" height="${ARTBOARD}">
      <rect x="0" y="0" width="${ARTBOARD}" height="${ARTBOARD}" fill="#fff"/>
      <${ring.tag} ${geometryOf(ring)} fill="#000"/>
    </mask>`;

  const layer = (index) => {
    const sheet = sheets[index];
    const upper = index === 0 ? [] : [layer(index - 1)];
    upper.push(`  <${sheet.ink.tag} ${geometryOf(sheet.ink)} fill="${ink}"/>`);
    const inner = upper.join('\n').replace(/^/gm, '  ');
    return `<g mask="url(#${idPrefix}-${index + 1})">\n${inner}\n</g>`;
  };

  const body = layer(sheets.length - 1).replace(/^/gm, '    ');
  return `  <defs>\n${sheets.map((sheet, index) => mask(sheet.ring, index + 1)).join('\n')}\n  </defs>\n${body}`;
}

function svgDocument({ viewBox, body, width, extra = '' }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${width ? ` width="${width}" height="${width}"` : ''} role="img"${extra}>
${body}
</svg>
`;
}

function trim(value) {
  return Number(value.toFixed(2));
}

const source = await readFile(SOURCE, 'utf8').catch(() => {
  process.stderr.write('\u2716 super_photo_blanc.svg introuvable à la racine du projet.\n');
  process.exit(1);
});

const shapes = extractShapes(source);
step(`super_photo_blanc.svg : ${shapes.length} formes visibles`);
if (shapes.length === 0) {
  process.stderr.write('\u2716 Aucune forme visible trouvée dans super_photo_blanc.svg\n');
  process.exit(1);
}

// Le plan de travail Illustrator (0 0 500 500) est conservé tel quel : c'est le
// cadre officiel du logo, avec ses marges optiques.
const ARTBOARD = 500;
const viewBox = `0 0 ${ARTBOARD} ${ARTBOARD}`;
step(`plan de travail : ${viewBox}`);

// Structure officielle du logo : les feuilles sont des `<polygon>` (l'encre),
// les séparations sont des `<path>` peints avec la couleur du fond. On se fie
// au type de forme et non à la couleur : dans l'export « blanc », les polygones
// sont explicitement blancs et les anneaux n'ont aucun `fill`.
const INK = shapes.filter((shape) => shape.tag === 'polygon' || shape.tag === 'rect' || shape.tag === 'circle');
const RINGS = shapes.filter((shape) => shape.tag === 'path');
step(`encre : ${INK.length} feuilles · détourages : ${RINGS.length} anneaux`);
if (INK.length !== RINGS.length) {
  process.stderr.write('\u2716 Feuilles et anneaux ne se correspondent pas — vérifiez le SVG source.\n');
  process.exit(1);
}

/** Feuilles appariées à leur anneau, dans l'ordre de peinture. */
const SHEETS = INK.map((ink, index) => ({ ink, ring: RINGS[index] }));

/**
 * Cadre serré autour de la marque : les icônes occupent toute la surface
 * demandée (« utilise l'espace avec mon logo »), avec 3 % de marge optique.
 */
function fitTransform(shapes, padding = 0.03) {
  const box = boundingBox(shapes);
  const size = Math.max(box.w, box.h);
  if (!Number.isFinite(size) || size <= 0) return '';
  const scale = (ARTBOARD * (1 - padding * 2)) / size;
  const offsetX = (ARTBOARD - box.w * scale) / 2 - box.x * scale;
  const offsetY = (ARTBOARD - box.h * scale) / 2 - box.y * scale;
  return `translate(${trim(offsetX)} ${trim(offsetY)}) scale(${trim(scale)})`;
}

/** Marque mise à l'échelle pour remplir le carré de l'icône. */
function fittedIcon(ink, { padding = 0.03 } = {}) {
  const body = knockoutMark(SHEETS, ink);
  const transform = fitTransform(INK, padding);
  return `  <g transform="${transform}">
${body.replace(/^/gm, '  ')}
  </g>`;
}

await mkdir(outDir, { recursive: true });

// Marque adaptative : les feuilles suivent `currentColor`, les anneaux creusent
// de vrais trous (masques) — aucun fond, aucune pastille.
await writeFile(
  path.join(outDir, 'mark.svg'),
  svgDocument({
    viewBox,
    body: `  <title>SuperPhoto</title>\n${knockoutMark(SHEETS, 'var(--brand-ink, currentColor)')}`,
  }),
);

await writeFile(
  path.join(outDir, 'mark-light.svg'),
  svgDocument({ viewBox, body: knockoutMark(SHEETS, '#111114') }),
);

await writeFile(
  path.join(outDir, 'mark-dark.svg'),
  svgDocument({ viewBox, body: knockoutMark(SHEETS, '#ffffff') }),
);

// Icône d'application : plus de carré sombre, la marque remplit le cadre.
await writeFile(
  path.join(outDir, 'app-icon.svg'),
  svgDocument({ viewBox, body: `  <title>SuperPhoto</title>\n${fittedIcon('#111114')}` }),
);

// Copie importable par les composants (`?raw`), en plus de la copie publique :
// la marque est ainsi inlinée dans la page, sans requête réseau. Elle suit la
// couleur du texte (`currentColor`), donc le thème clair comme le sombre.
const assetDir = path.join(root, 'src', 'assets', 'brand');
await mkdir(assetDir, { recursive: true });
await writeFile(
  path.join(assetDir, 'app-icon.svg'),
  svgDocument({
    viewBox,
    body: `  <title>SuperPhoto</title>\n${fittedIcon('currentColor')}`,
  }),
);

// Favicon : fond transparent, et encre qui suit le thème du navigateur. Les
// navigateurs récents appliquent `prefers-color-scheme` au favicon SVG.
const box = boundingBox(INK);
const faviconTransform = fitTransform(INK, 0.02);
await writeFile(
  path.join(root, 'public', 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img">
  <title>SuperPhoto</title>
  <style>
    .sp-ink { fill: #111114; }
    @media (prefers-color-scheme: dark) { .sp-ink { fill: #ffffff; } }
  </style>
  <g transform="${faviconTransform}">
${knockoutMark(SHEETS, 'currentColor')
  .replace(/fill="currentColor"/g, 'class="sp-ink"')
  .replace(/^/gm, '    ')}
  </g>
</svg>
`,
);

step(
  'écrit : public/brand/{mark,mark-light,mark-dark,app-icon}.svg, src/assets/brand/app-icon.svg, public/favicon.svg',
);
step(`boîte de la marque : ${Math.round(box.w)} × ${Math.round(box.h)} sur ${ARTBOARD}`);
