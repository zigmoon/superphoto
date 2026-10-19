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

export const ADJUSTMENT_TITLES: Record<AdjustmentId, string> = {
  tonality: 'Tonalité',
  contrast: 'Contraste',
  color: 'Couleur',
  levels: 'Niveaux',
  curves: 'Courbes',
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

export function buildCurveLut(points: CurvePoint[]): Uint8Array {
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const lut = new Uint8Array(256);
  if (sorted.length === 0) {
    for (let i = 0; i < 256; i += 1) lut[i] = i;
    return lut;
  }
  let cursor = 0;
  for (let x = 0; x < 256; x += 1) {
    while (cursor < sorted.length - 2 && x > (sorted[cursor + 1]?.x ?? 255)) cursor += 1;
    const a = sorted[cursor] ?? { x: 0, y: 0 };
    const b = sorted[cursor + 1] ?? a;
    const span = b.x - a.x;
    const t = span <= 0 ? 0 : clamp((x - a.x) / span, 0, 1);
    lut[x] = Math.round(clamp(a.y + (b.y - a.y) * t, 0, 255));
  }
  return lut;
}

function hueMatrix(degrees: number): number[] {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
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
}

export interface AdjustOptions {
  id: AdjustmentId;
  params: Record<string, number>;
  selection: Selection | null;
  curves: Record<CurveChannel, CurvePoint[]>;
  channel: CurveChannel;
}

export function adjustImageData(original: ImageData, options: AdjustOptions): ImageData {
  const { width, height } = original;
  const result = new ImageData(new Uint8ClampedArray(original.data), width, height);
  const data = result.data;
  const { id, params, selection } = options;

  const exposureFactor = Math.pow(2, params.exposure ?? 0);
  const brightness = (params.brightness ?? 0) * 1.27;
  const blacks = (params.blacks ?? 0) / 100;
  const contrast = (params.contrast ?? 0) * 2.55;
  const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  const saturation = Math.max(0, 1 + (params.saturation ?? 0) / 100);
  const matrix = hueMatrix(params.hue ?? 0);
  const temperature = (params.temperature ?? 0) * 0.55;
  const tint = (params.tint ?? 0) * 0.45;
  const inBlack = params.inBlack ?? 0;
  const inWhite = params.inWhite ?? 255;
  const gamma = params.gamma ?? 1;
  const outBlack = params.outBlack ?? 0;
  const outWhite = params.outWhite ?? 255;
  const curveLuts: Record<CurveChannel, Uint8Array> | null = id === 'curves'
    ? {
        rgb: buildCurveLut(options.curves.rgb),
        r: buildCurveLut(options.curves.r),
        g: buildCurveLut(options.curves.g),
        b: buildCurveLut(options.curves.b),
      }
    : null;
  const activeChannel = options.channel;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (selection && !selectionContains(selection, x, y)) continue;
      const index = (y * width + x) * 4;
      let r = data[index] ?? 0;
      let g = data[index + 1] ?? 0;
      let b = data[index + 2] ?? 0;

      if (id === 'tonality') {
        r = r * exposureFactor + brightness;
        g = g * exposureFactor + brightness;
        b = b * exposureFactor + brightness;
        if (blacks > 0) {
          r += (255 - r) * blacks * 0.45;
          g += (255 - g) * blacks * 0.45;
          b += (255 - b) * blacks * 0.45;
        } else if (blacks < 0) {
          r += r * blacks * 0.45;
          g += g * blacks * 0.45;
          b += b * blacks * 0.45;
        }
      } else if (id === 'contrast') {
        r = contrastFactor * (r - 128) + 128;
        g = contrastFactor * (g - 128) + 128;
        b = contrastFactor * (b - 128) + 128;
      } else if (id === 'color') {
        const nr = clamp(
          matrix[0]! * r + matrix[1]! * g + matrix[2]! * b,
          0,
          255,
        );
        const ng = clamp(
          matrix[3]! * r + matrix[4]! * g + matrix[5]! * b,
          0,
          255,
        );
        const nb = clamp(
          matrix[6]! * r + matrix[7]! * g + matrix[8]! * b,
          0,
          255,
        );
        r = nr;
        g = ng;
        b = nb;
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = luma + (r - luma) * saturation;
        g = luma + (g - luma) * saturation;
        b = luma + (b - luma) * saturation;
        r += temperature;
        b -= temperature;
        g += tint;
      } else if (id === 'levels') {
        const normalize = (value: number) => {
          const t = clamp((value - inBlack) / Math.max(1, inWhite - inBlack), 0, 1);
          return outBlack + Math.pow(t, 1 / Math.max(0.05, gamma)) * (outWhite - outBlack);
        };
        r = normalize(r);
        g = normalize(g);
        b = normalize(b);
      } else if (id === 'curves' && curveLuts) {
        if (activeChannel === 'rgb') {
          r = curveLuts.rgb[r] ?? r;
          g = curveLuts.rgb[g] ?? g;
          b = curveLuts.rgb[b] ?? b;
        } else if (activeChannel === 'r') {
          r = curveLuts.r[r] ?? r;
        } else if (activeChannel === 'g') {
          g = curveLuts.g[g] ?? g;
        } else {
          b = curveLuts.b[b] ?? b;
        }
      }

      data[index] = clamp(r, 0, 255);
      data[index + 1] = clamp(g, 0, 255);
      data[index + 2] = clamp(b, 0, 255);
    }
  }
  return result;
}
