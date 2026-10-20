/**
 * Modes chromatiques du document : RVB, CMJN, niveaux de gris.
 *
 * SuperPhoto travaille en RVB 8 bits en interne — c'est ce que les canvas
 * savent faire sans perte et sans profil ICC. Le mode du document décrit donc
 * la **conversion** appliquée aux pixels :
 *
 *   • RVB → CMJN  : simulation d'impression (limite d'encre + gain de point),
 *                   puis retour en RVB. Les couleurs hors gamut sont écrasées,
 *                   comme dans un vrai passage CMJN : revenir en RVB ne les
 *                   restaure pas.
 *   • → Niveaux de gris : luminance Rec. 709, identique à un désaturation
 *                   perceptuelle.
 *
 * Convertir vers un mode plus large (CMJN → RVB, gris → RVB) ne change pas les
 * pixels : l'information perdue ne revient pas, exactement comme dans Photoshop.
 */
import type { ColorMode, PhotoDoc } from './types';
import { canvasContext } from './utils';
import { t } from './i18n';

/** Limite de couverture totale d'encre, en fraction (≈ 300 %). */
const TOTAL_INK_LIMIT = 3;
/** Gain de point : l'encre imprimée bave, les valeurs montent légèrement. */
const DOT_GAIN = 0.88;
/** Densité maximale d'une encre : le papier n'est jamais parfaitement noir, donc
 *  un aplat 100 % imprime plus clair (et moins saturé) qu'un rouge RVB. */
const MAX_INK_DENSITY = 0.93;

export const COLOR_MODES: ColorMode[] = ['rgb', 'cmyk', 'gray'];

export function colorModeLabelKey(mode: ColorMode): string {
  if (mode === 'cmyk') return 'mode.cmyk';
  if (mode === 'gray') return 'mode.gray';
  return 'mode.rgb';
}

/** Libellé court utilisé dans la barre de titre et le résumé d'export. */
export function colorModeShort(mode: ColorMode | undefined): string {
  // Traduit : « RGB / CMYK / Gray » devient « RVB / CMJN / N&B » en français.
  return t(colorModeLabelKey(mode ?? 'rgb'));
}

/**
 * Applique la conversion à un `ImageData` en place.
 * Renvoie `true` si au moins un pixel a changé.
 */
function convertPixels(data: Uint8ClampedArray, from: ColorMode, to: ColorMode): boolean {
  if (from === to) return false;

  const luminance = to === 'gray';
  const toInk = to === 'cmyk';
  // Revenir d'un mode plus étroit ne restaure rien : aucun calcul.
  if (!luminance && !toInk) return false;

  let changed = false;
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3] ?? 0;
    if (alpha === 0) continue;
    const r = (data[index] ?? 0) / 255;
    const g = (data[index + 1] ?? 0) / 255;
    const b = (data[index + 2] ?? 0) / 255;

    let nr: number;
    let ng: number;
    let nb: number;

    if (luminance) {
      const value = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      nr = value;
      ng = value;
      nb = value;
    } else {
      // RVB → CMJN (retrait du noir en sous-couleur, GCR complet).
      const k = 1 - Math.max(r, g, b);
      let c = 0;
      let m = 0;
      let y = 0;
      if (k < 1) {
        const scale = 1 - k;
        c = (1 - r - k) / scale;
        m = (1 - g - k) / scale;
        y = (1 - b - k) / scale;
      }
      // Limite d'encre : au-delà de 300 % de couverture, on réduit la trichromie.
      const total = c + m + y;
      if (total > TOTAL_INK_LIMIT) {
        const factor = TOTAL_INK_LIMIT / total;
        c *= factor;
        m *= factor;
        y *= factor;
      }
      // Gain de point : une valeur d'encre de 50 % imprime plus sombre.
      // Puis densité maximale : un aplat 100 % reste plus clair que le noir
      // théorique, ce qui délave légèrement les couleurs très saturées.
      c = Math.pow(Math.max(0, c), DOT_GAIN) * MAX_INK_DENSITY;
      m = Math.pow(Math.max(0, m), DOT_GAIN) * MAX_INK_DENSITY;
      y = Math.pow(Math.max(0, y), DOT_GAIN) * MAX_INK_DENSITY;
      const ink = (1 - k) * MAX_INK_DENSITY;
      nr = (1 - c) * ink;
      ng = (1 - m) * ink;
      nb = (1 - y) * ink;
    }

    const outR = Math.round(Math.min(1, Math.max(0, nr)) * 255);
    const outG = Math.round(Math.min(1, Math.max(0, ng)) * 255);
    const outB = Math.round(Math.min(1, Math.max(0, nb)) * 255);
    if (outR !== data[index] || outG !== data[index + 1] || outB !== data[index + 2]) changed = true;
    data[index] = outR;
    data[index + 1] = outG;
    data[index + 2] = outB;
  }
  return changed;
}

/** Convertit un canvas en place. Renvoie `true` si des pixels ont changé. */
export function convertCanvasMode(
  canvas: HTMLCanvasElement,
  from: ColorMode,
  to: ColorMode,
): boolean {
  if (from === to) return false;
  if (to === 'rgb') return false;
  const ctx = canvasContext(canvas);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const changed = convertPixels(image.data, from, to);
  if (changed) ctx.putImageData(image, 0, 0);
  return changed;
}

/**
 * Change le mode du document et convertit tous ses calques.
 * Les masques sont laissés tels quels : ce sont des canaux alpha.
 */
export function convertDocumentMode(doc: PhotoDoc, mode: ColorMode): boolean {
  const from = doc.colorMode ?? 'rgb';
  if (from === mode) return false;
  let anyChange = false;
  for (const layer of doc.layers) {
    const changed = convertCanvasMode(layer.canvas, from, mode);
    if (changed) anyChange = true;
    // Un texte ou un tracé doit être réaffiché dans le nouveau mode : on les
    // rasterise, sinon leurs métadonnées décriraient l'ancienne couleur et le
    // prochain rendu annulerait la conversion.
    if (changed && (layer.kind === 'text' || layer.kind === 'path')) {
      layer.kind = 'raster';
      layer.text = undefined;
      layer.path = undefined;
    }
  }
  doc.colorMode = mode;
  return anyChange;
}
