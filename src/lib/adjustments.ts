import type {
  AdjustmentId,
  CurveChannel,
  CurvePoint,
  Selection,
} from './types';
import { clamp, selectionContains } from './utils';

export interface AdjustmentParam {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
  default: number;
}

/** Libellés des réglages : ce sont des clés i18n, pas du texte figé. */
export const ADJUSTMENT_TITLES: Record<AdjustmentId, string> = {
  tonality: 'adjust.tonality',
  contrast: 'adjust.contrast',
  color: 'adjust.color',
  levels: 'adjust.levels',
  curves: 'adjust.curves',
};

export const ADJUSTMENT_PARAMS: Record<AdjustmentId, AdjustmentParam[]> = {
  tonality: [
    { key: 'exposure', label: 'Exposition', min: -2, max: 2, step: 0.01, unit: 'EV', default: 0 },
    { key: 'brightness', label: 'Luminosité', min: -100, max: 100, step: 1, unit: '', default: 0 },
    { key: 'blacks', label: 'Noirs', min: -100, max: 100, step: 1, unit: '', default: 0 },
  ],
  contrast: [
    { key: 'contrast', label: 'Contraste', min: -100, max: 100, step: 1, unit: '', default: 0 },
  ],
  color: [
    { key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1, unit: '', default: 0 },
    { key: 'hue', label: 'Teinte', min: -180, max: 180, step: 1, unit: '°', default: 0 },
    { key: 'temperature', label: 'Température', min: -100, max: 100, step: 1, unit: '', default: 0 },
    { key: 'tint', label: 'Tint', min: -100, max: 100, step: 1, unit: '', default: 0 },
  ],
  levels: [
    { key: 'inBlack', label: 'Point noir', min: 0, max: 254, step: 1, unit: '', default: 0 },
    { key: 'inWhite', label: 'Point blanc', min: 1, max: 255, step: 1, unit: '', default: 255 },
    { key: 'gamma', label: 'Gamma', min: 0.1, max: 3, step: 0.01, unit: '', default: 1 },
    { key: 'outBlack', label: 'Sortie noire', min: 0, max: 255, step: 1, unit: '', default: 0 },
    { key: 'outWhite', label: 'Sortie blanche', min: 0, max: 255, step: 1, unit: '', default: 255 },
  ],
  curves: [],
};

export function defaultParams(id: AdjustmentId): Record<string, number> {
  const params: Record<string, number> = {};
  for (const param of ADJUSTMENT_PARAMS[id]) params[param.key] = param.default;
  return params;
}

export function defaultCurves(): Record<CurveChannel, CurvePoint[]> {
  return {
    rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
    r: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
    g: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
    b: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
  };
}

/**
 * Courbe lissée, façon Photoshop.
 *
 * Une interpolation linéaire entre les points donnerait une succession de
 * segments droits (le défaut visible). On calcule des tangentes par la méthode
 * **monotone cubique de Fritsch–Carlson** (PCHIP) : la courbe passe par tous les
 * points, reste C¹ (aucun angle), et ne dépasse jamais les valeurs saisies —
 * contrairement à une spline de Catmull-Rom qui peut produire des anneaux et des
 * noirs bouchés.
 */
export function buildCurveLut(points: CurvePoint[]): Uint8Array {
  const lut = new Uint8Array(256);
  const sorted = [...points]
    .map((point) => ({ x: clamp(point.x, 0, 255), y: clamp(point.y, 0, 255) }))
    .sort((a, b) => a.x - b.x)
    // Deux points sur la même abscisse rendraient la pente infinie : on ne
    // garde que le dernier saisi.
    .filter((point, index, list) => index === list.length - 1 || point.x !== list[index + 1]!.x);

  if (sorted.length === 0) {
    for (let i = 0; i < 256; i += 1) lut[i] = i;
    return lut;
  }
  if (sorted.length === 1) {
    lut.fill(Math.round(sorted[0]!.y));
    return lut;
  }

  const n = sorted.length;
  const xs = sorted.map((point) => point.x);
  const ys = sorted.map((point) => point.y);

  // Pentes des segments.
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const dx = xs[i + 1]! - xs[i]!;
    slopes.push(dx <= 0 ? 0 : (ys[i + 1]! - ys[i]!) / dx);
  }

  // Tangentes : moyenne des pentes voisines, bornée pour rester monotone.
  const tangents: number[] = new Array(n).fill(0);
  tangents[0] = slopes[0] ?? 0;
  tangents[n - 1] = slopes[n - 2] ?? 0;
  for (let i = 1; i < n - 1; i += 1) {
    const before = slopes[i - 1] ?? 0;
    const after = slopes[i] ?? 0;
    if (before * after <= 0) {
      tangents[i] = 0;
      continue;
    }
    const dxBefore = xs[i]! - xs[i - 1]!;
    const dxAfter = xs[i + 1]! - xs[i]!;
    const weight = 3 * (dxBefore + dxAfter);
    tangents[i] = weight / ((weight / (2 * dxAfter + dxBefore)) / before + (weight / (dxAfter + 2 * dxBefore)) / after);
  }
  for (let i = 0; i < n - 1; i += 1) {
    const slope = slopes[i] ?? 0;
    if (slope === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const a = tangents[i]! / slope;
    const b = tangents[i + 1]! / slope;
    const distance = a * a + b * b;
    if (distance > 9) {
      const scale = 3 / Math.sqrt(distance);
      tangents[i] = scale * a * slope;
      tangents[i + 1] = scale * b * slope;
    }
  }

  // Évaluation Hermite sur chaque segment ; hors bornes, on tient la valeur.
  let segment = 0;
  for (let x = 0; x < 256; x += 1) {
    while (segment < n - 2 && x > xs[segment + 1]!) segment += 1;
    const x0 = xs[segment]!;
    const x1 = xs[segment + 1]!;
    if (x <= x0) {
      lut[x] = Math.round(clamp(ys[segment]!, 0, 255));
      continue;
    }
    if (x >= x1) {
      lut[x] = Math.round(clamp(ys[segment + 1]!, 0, 255));
      continue;
    }
    const h = x1 - x0;
    const t = (x - x0) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    const value =
      h00 * ys[segment]! +
      h10 * h * tangents[segment]! +
      h01 * ys[segment + 1]! +
      h11 * h * tangents[segment + 1]!;
    lut[x] = Math.round(clamp(value, 0, 255));
  }
  return lut;
}

/** Chemin SVG de la courbe lissée, dans l'espace 256 × 256 (y inversé). */
export function curveToPath(points: CurvePoint[]): string {
  const lut = buildCurveLut(points);
  const commands: string[] = [];
  for (let x = 0; x < 256; x += 1) {
    commands.push(`${x === 0 ? 'M' : 'L'} ${x} ${255 - lut[x]!}`);
  }
  return commands.join(' ');
}

/**
 * Histogramme (R, G, B et luminance) de l'aperçu.
 *
 * Il sert de repère dans les courbes et les niveaux : sans lui on règle à
 * l'aveugle, et c'est ce qui distingue un outil de retouche d'un jouet.
 */
export function computeHistogram(image: ImageData): Record<'r' | 'g' | 'b' | 'rgb', Uint32Array> {
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  const rgb = new Uint32Array(256);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 3] ?? 0) === 0) continue;
    const red = data[i] ?? 0;
    const green = data[i + 1] ?? 0;
    const blue = data[i + 2] ?? 0;
    r[red] = (r[red] ?? 0) + 1;
    g[green] = (g[green] ?? 0) + 1;
    b[blue] = (b[blue] ?? 0) + 1;
    const luma = Math.round(0.2126 * red + 0.7152 * green + 0.0722 * blue);
    rgb[luma] = (rgb[luma] ?? 0) + 1;
  }
  return { r, g, b, rgb };
}

/** Chemin SVG d'un histogramme, normalisé sur la hauteur `height`. */
export function histogramPath(histogram: Uint32Array, width = 256, height = 256): string {
  let max = 0;
  // La première et la dernière classe sont souvent écrasées (noirs purs,
  // blancs purs) : les ignorer garde le reste lisible.
  for (let i = 1; i < 255; i += 1) max = Math.max(max, histogram[i] ?? 0);
  if (max <= 0) return '';
  const commands: string[] = [`M 0 ${height}`];
  for (let i = 0; i < 256; i += 1) {
    const value = Math.min(1, (histogram[i] ?? 0) / max);
    // Échelle racine carrée : les pics n'écrasent pas les queues.
    const y = height - Math.sqrt(value) * height;
    commands.push(`L ${(i / 255) * width} ${y.toFixed(1)}`);
  }
  commands.push(`L ${width} ${height} Z`);
  return commands.join(' ');
}

export interface AdjustOptions {
  id: AdjustmentId;
  params: Record<string, number>;
  selection: Selection | null;
  /** Couverture du contour progressif (0 → 255), à la taille de l'ImageData. */
  mask?: Uint8ClampedArray | null;
  curves: Record<CurveChannel, CurvePoint[]>;
  channel: CurveChannel;
}

/** Courbe de tons par canal, sous forme de table de 256 entrées. */
function toneLut(id: AdjustmentId, params: Record<string, number>): Uint8Array | null {
  const lut = new Uint8Array(256);
  if (id === 'tonality') {
    const exposureFactor = Math.pow(2, params.exposure ?? 0);
    const brightness = (params.brightness ?? 0) * 1.27;
    const blacks = (params.blacks ?? 0) / 100;
    for (let v = 0; v < 256; v += 1) {
      let value = v * exposureFactor + brightness;
      // « Noirs » resserre ou débouche les basses lumières, sans toucher aux
      // hautes : + pousse vers le blanc, − écrase vers le noir.
      if (blacks > 0) value += (255 - value) * blacks * 0.45;
      else if (blacks < 0) value += value * blacks * 0.45;
      lut[v] = clamp(value, 0, 255);
    }
    return lut;
  }
  if (id === 'contrast') {
    const contrast = (params.contrast ?? 0) * 2.55;
    const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
    for (let v = 0; v < 256; v += 1) lut[v] = clamp(factor * (v - 128) + 128, 0, 255);
    return lut;
  }
  if (id === 'levels') {
    const inBlack = params.inBlack ?? 0;
    const inWhite = params.inWhite ?? 255;
    const gamma = params.gamma ?? 1;
    const outBlack = params.outBlack ?? 0;
    const outWhite = params.outWhite ?? 255;
    const span = Math.max(1, inWhite - inBlack);
    const inverseGamma = 1 / Math.max(0.05, gamma);
    for (let v = 0; v < 256; v += 1) {
      const t = clamp((v - inBlack) / span, 0, 1);
      lut[v] = clamp(outBlack + Math.pow(t, inverseGamma) * (outWhite - outBlack), 0, 255);
    }
    return lut;
  }
  return null;
}

/**
 * Matrice 3 × 3 combinant rotation de teinte et saturation.
 *
 * Les deux opérations sont linéaires : les composer une fois pour toutes évite
 * deux passes par pixel et supprime l'ordre arbitraire « teinte puis
 * saturation » qui faisait baver les couleurs vives.
 */
function colorMatrix(hueDegrees: number, saturation: number): Float32Array {
  const rad = (hueDegrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hue = [
    0.213 + cos * 0.787 - sin * 0.213,
    0.715 - cos * 0.715 - sin * 0.715,
    0.072 - cos * 0.072 + sin * 0.928,
    0.213 - cos * 0.213 + sin * 0.143,
    0.715 + cos * 0.285 + sin * 0.14,
    0.072 - cos * 0.072 - sin * 0.283,
    0.213 - cos * 0.213 - sin * 0.787,
    0.715 - cos * 0.715 + sin * 0.715,
    0.072 + cos * 0.928 + sin * 0.072,
  ];
  // Saturation autour de la luminance Rec.709 : M = S + (1 - S) · L
  const lr = 0.2126;
  const lg = 0.7152;
  const lb = 0.0722;
  const sat = [
    lr + (1 - lr) * saturation, lg - lg * saturation, lb - lb * saturation,
    lr - lr * saturation, lg + (1 - lg) * saturation, lb - lb * saturation,
    lr - lr * saturation, lg - lg * saturation, lb + (1 - lb) * saturation,
  ];
  const out = new Float32Array(9);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      out[row * 3 + col] =
        sat[row * 3]! * hue[col]! +
        sat[row * 3 + 1]! * hue[3 + col]! +
        sat[row * 3 + 2]! * hue[6 + col]!;
    }
  }
  return out;
}

export function adjustImageData(original: ImageData, options: AdjustOptions): ImageData {
  const { width, height } = original;
  const result = new ImageData(new Uint8ClampedArray(original.data), width, height);
  const data = result.data;
  const { id, params, selection } = options;

  const tone = toneLut(id, params);
  const temperature = (params.temperature ?? 0) * 0.55;
  const tint = (params.tint ?? 0) * 0.45;
  const matrix = id === 'color'
    ? colorMatrix(params.hue ?? 0, Math.max(0, 1 + (params.saturation ?? 0) / 100))
    : null;
  // Les quatre courbes s'appliquent : la composite d'abord, puis chaque canal.
  // (Avant, seule la courbe du canal affiché était appliquée — les réglages
  // saisis sur R, G et B étaient perdus.)
  const curves = id === 'curves'
    ? {
        rgb: buildCurveLut(options.curves.rgb),
        r: buildCurveLut(options.curves.r),
        g: buildCurveLut(options.curves.g),
        b: buildCurveLut(options.curves.b),
      }
    : null;
  const identity = (value: number): boolean => value === 0 || value === 255;

  const identityCurves = curves
    ? identity(curves.rgb[1]!) && identity(curves.rgb[254]!) &&
      identity(curves.r[1]!) && identity(curves.g[1]!) && identity(curves.b[1]!)
    : false;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let coverage = 1;
      if (options.mask) {
        coverage = (options.mask[y * width + x] ?? 0) / 255;
        if (coverage <= 0) continue;
      } else if (selection && !selectionContains(selection, x, y)) {
        continue;
      }
      const index = (y * width + x) * 4;
      let r = data[index] ?? 0;
      let g = data[index + 1] ?? 0;
      let b = data[index + 2] ?? 0;

      if (tone) {
        r = tone[r] ?? r;
        g = tone[g] ?? g;
        b = tone[b] ?? b;
      } else if (matrix) {
        const nr = matrix[0]! * r + matrix[1]! * g + matrix[2]! * b;
        const ng = matrix[3]! * r + matrix[4]! * g + matrix[5]! * b;
        const nb = matrix[6]! * r + matrix[7]! * g + matrix[8]! * b;
        r = nr;
        g = ng;
        b = nb;
        // Balance blancs : la température déplace l'axe bleu/rouge, le tint
        // l'axe vert/magenta, proportionnellement à la luminance pour ne pas
        // écraser les noirs.
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const weight = luma / 255;
        r += temperature * weight;
        b -= temperature * weight;
        g += tint * weight;
        r -= tint * weight * 0.35;
        b -= tint * weight * 0.35;
      } else if (curves && !identityCurves) {
        r = curves.rgb[r] ?? r;
        g = curves.rgb[g] ?? g;
        b = curves.rgb[b] ?? b;
        r = curves.r[r] ?? r;
        g = curves.g[g] ?? g;
        b = curves.b[b] ?? b;
      }

      if (coverage >= 1) {
        data[index] = clamp(r, 0, 255);
        data[index + 1] = clamp(g, 0, 255);
        data[index + 2] = clamp(b, 0, 255);
      } else {
        const source = original.data;
        data[index] = (source[index] ?? 0) + (clamp(r, 0, 255) - (source[index] ?? 0)) * coverage;
        data[index + 1] = (source[index + 1] ?? 0) +
          (clamp(g, 0, 255) - (source[index + 1] ?? 0)) * coverage;
        data[index + 2] = (source[index + 2] ?? 0) +
          (clamp(b, 0, 255) - (source[index + 2] ?? 0)) * coverage;
      }
    }
  }
  return result;
}
