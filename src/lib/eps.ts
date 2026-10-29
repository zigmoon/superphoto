/**
 * EPS — PostScript encapsulé, niveau 3.
 *
 * L'EPS n'est pas une image matricielle : c'est un programme PostScript. On
 * écrit donc un en-tête conforme (BoundingBox, DocumentData, couleurs), puis on
 * confie les pixels à l'opérateur `image`, qui les lit directement dans le
 * fichier.
 *
 * Trois détails font la différence entre un EPS « qui s'ouvre » et un EPS
 * exploitable en PAO :
 *
 *   • les données sont en **hexadécimal**, pas en ASCII85. Un filtre créé sur
 *     `currentfile` peut consommer par avance les jetons qui suivent et casser
 *     l'interprétation ; `currentfile` évalué à l'intérieur de la procédure
 *     (au moment où `image` s'exécute) est la seule forme garantie partout ;
 *   • le fond doit être **aplati sur du blanc** — l'EPS ne connaît pas la
 *     transparence, et ce qui est transparent sortirait noir chez certains RIP ;
 *   • l'`ImageMatrix` porte le miroir vertical et la mise à l'échelle en points
 *     (1/72"), l'origine PostScript étant en bas à gauche.
 */
import type { PhotoDoc } from './types';
import { canvasContext } from './utils';

export const EPS_MIME = 'application/postscript';

const HEX = '0123456789ABCDEF';

function escapeTitle(text: string): string {
  return text.replace(/[()\\]/g, (character) => `\\${character}`).replace(/[\r\n]+/g, ' ');
}

export interface EpsOptions {
  title: string;
  dpi: number;
  /** Aplatit la transparence sur du blanc. */
  flatten: boolean;
}

/** Écrit un EPS niveau 3 depuis un canvas déjà composé. */
export function encodeEps(canvas: HTMLCanvasElement, { title, dpi, flatten }: EpsOptions): Blob {
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvasContext(canvas);
  const image = ctx.getImageData(0, 0, width, height);
  const source = image.data;

  // 1 point PostScript = 1/72". Un pixel vaut 72/dpi points.
  const scale = 72 / (dpi > 0 ? dpi : 72);
  const boxWidth = Math.max(1, Math.round(width * scale));
  const boxHeight = Math.max(1, Math.round(height * scale));

  const rgb = new Uint8Array(width * height * 3);
  for (let index = 0; index < width * height; index += 1) {
    const alpha = (source[index * 4 + 3] ?? 255) / 255;
    for (let channel = 0; channel < 3; channel += 1) {
      const value = source[index * 4 + channel] ?? 0;
      // Composition « par-dessus du blanc » : les pixels opaques restent intacts.
      rgb[index * 3 + channel] = flatten ? Math.round(value * alpha + 255 * (1 - alpha)) : value;
    }
  }

  // Hexadécimal, 32 octets par ligne : lisible dans un éditeur de texte et
  // accepté sans réserve par `readhexstring`, qui ignore les blancs.
  const hex: string[] = [];
  let line = '';
  for (let index = 0; index < rgb.length; index += 1) {
    const byte = rgb[index] ?? 0;
    line += HEX[byte >> 4] ?? '0';
    line += HEX[byte & 0x0f] ?? '0';
    if (line.length >= 64) {
      hex.push(line);
      line = '';
    }
  }
  if (line) hex.push(line);

  const header = [
    '%!PS-Adobe-3.0 EPSF-3.0',
    `%%BoundingBox: 0 0 ${boxWidth} ${boxHeight}`,
    `%%HiResBoundingBox: 0 0 ${(width * scale).toFixed(3)} ${(height * scale).toFixed(3)}`,
    '%%Creator: SuperPhoto',
    `%%Title: (${escapeTitle(title)})`,
    `%%CreationDate: (${new Date().toISOString().slice(0, 10)})`,
    '%%Pages: 1',
    '%%DocumentProcessColors: Cyan Magenta Yellow Black',
    '%%DocumentData: Clean7Bit',
    '%%LanguageLevel: 3',
    '%%EndComments',
    '%%BeginProlog',
    '/spdict 24 dict def',
    'spdict begin',
    `/width ${width} def`,
    `/height ${height} def`,
    `/res ${scale.toFixed(6)} def`,
    '/picstr width 3 mul string def',
    '%%EndProlog',
    '%%Page: 1 1',
    'gsave',
    'res res scale',
    '<<',
    '  /ImageType 1',
    '  /Width width',
    '  /Height height',
    '  /BitsPerComponent 8',
    '  /Decode [0 1 0 1 0 1]',
    // Hauteur négative : l'origine PostScript est en bas à gauche alors que les
    // pixels arrivent par la première ligne en haut. L'`ImageMatrix` porte donc
    // le miroir vertical *et* le décalage d'une hauteur — c'est l'idiome du
    // PostScript Language Reference, et le seul qui garde l'image dans la
    // BoundingBox (un `1 -1 scale` séparé la décalait d'un point au lieu d'une
    // hauteur complète).
    `  /ImageMatrix [${width} 0 0 -${height} 0 ${height}]`,
    '  /DataSource { currentfile picstr readhexstring pop }',
    '>> image',
  ].join('\n');

  // L'épilogue vient *après* les pixels : `image` lit le fichier au fil de
  // `readhexstring`, donc tout ce qui suit `image` dans le fichier est avalé
  // comme des données. Placé avant, il ne serait jamais exécuté (`showpage`
  // compris) et ses lettres hexadécimales corrompraient l'image.
  const epilogue = ['grestore', 'showpage', 'end', '%%EOF'].join('\n');

  // Un saut de ligne sépare les pixels de l'épilogue : `readhexstring` s'arrête
  // après le dernier octet attendu, la suite du fichier est du PostScript.
  const body = `${header}\n${hex.join('\n')}\n${epilogue}\n`;
  return new Blob([body], { type: EPS_MIME });
}

export function epsFromDocument(doc: PhotoDoc, canvas: HTMLCanvasElement): Blob {
  return encodeEps(canvas, {
    title: doc.name || 'SuperPhoto',
    dpi: doc.dpi,
    flatten: true,
  });
}
