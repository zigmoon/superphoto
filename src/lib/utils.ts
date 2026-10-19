import type { Point, Rect, Selection } from './types';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function uid(prefix = 'layer'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

export function cloneCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const copy = createCanvas(source.width, source.height);
  const ctx = copy.getContext('2d');
  if (ctx) ctx.drawImage(source, 0, 0);
  return copy;
}

export function canvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D indisponible');
  return ctx;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number; a: number } {
  const clean = hex.replace('#', '').trim();
  const full = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean.padEnd(6, '0').slice(0, 6);
  const value = Number.parseInt(full, 16);
  if (Number.isNaN(value)) return { r: 0, g: 0, b: 0, a: 1 };
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
    a: 1,
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

export function clampRect(rect: Rect, width: number, height: number): Rect {
  const x = clamp(rect.x, 0, width);
  const y = clamp(rect.y, 0, height);
  return {
    x,
    y,
    w: clamp(rect.w, 0, width - x),
    h: clamp(rect.h, 0, height - y),
  };
}

export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

export function pointInRect(x: number, y: number, rect: Rect): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

export function pointInPolygon(x: number, y: number, points: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const pi = points[i];
    const pj = points[j];
    if (!pi || !pj) continue;
    if (
      (pi.y > y) !== (pj.y > y) &&
      x < ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y || 1e-9) + pi.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export function selectionContains(
  selection: Selection | null,
  x: number,
  y: number,
): boolean {
  if (!selection) return true;
  let inside = false;
  if (selection.type === 'rect') {
    inside = pointInRect(x, y, selection.rect);
  } else if (selection.type === 'ellipse') {
    const { rect } = selection;
    const rx = rect.w / 2;
    const ry = rect.h / 2;
    if (rx > 0 && ry > 0) {
      const dx = (x - (rect.x + rx)) / rx;
      const dy = (y - (rect.y + ry)) / ry;
      inside = dx * dx + dy * dy <= 1;
    }
  } else if (selection.rings && selection.rings.length > 0) {
    // Remplissage pair-impair sur tous les anneaux : un trou annule la zone.
    let crossings = 0;
    for (const ring of selection.rings) {
      if (pointInPolygon(x, y, ring)) crossings += 1;
    }
    inside = crossings % 2 === 1;
  } else {
    inside = pointInPolygon(x, y, selection.points);
  }
  return selection.invert ? !inside : inside;
}

/** Boîte englobante d'une sélection, sans parcourir les pixels. */
export function selectionBounds(selection: Selection): Rect {
  if (selection.type !== 'poly') return selection.rect;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const rings = selection.rings && selection.rings.length > 0 ? selection.rings : [selection.points];
  for (const ring of rings) {
    for (const point of ring) {
      if (point.x < minX) minX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.x > maxX) maxX = point.x;
      if (point.y > maxY) maxY = point.y;
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function selectionRings(selection: Selection): Point[][] {
  if (selection.type !== 'poly') return [];
  return selection.rings && selection.rings.length > 0 ? selection.rings : [selection.points];
}

/** Rayon du contour progressif, en pixels du document. */
export function selectionFeather(selection: Selection): number {
  return Math.max(0, Math.round(selection.feather ?? 0));
}

/**
 * Géométrie d'une sélection sous forme de `Path2D`. Pour une sélection
 * inversée, le rectangle extérieur est ajouté au chemin : il suffit ensuite de
 * remplir en pair-impair.
 */
export function selectionPath(
  selection: Selection,
  width: number,
  height: number,
): { path: Path2D; rule: CanvasFillRule } {
  const path = new Path2D();
  let rule: CanvasFillRule = 'nonzero';
  if (selection.type === 'rect') {
    path.rect(selection.rect.x, selection.rect.y, selection.rect.w, selection.rect.h);
  } else if (selection.type === 'ellipse') {
    path.ellipse(
      selection.rect.x + selection.rect.w / 2,
      selection.rect.y + selection.rect.h / 2,
      Math.max(0.1, selection.rect.w / 2),
      Math.max(0.1, selection.rect.h / 2),
      0,
      0,
      Math.PI * 2,
    );
  } else {
    const rings = selectionRings(selection);
    for (const ring of rings) {
      const first = ring[0];
      if (!first) continue;
      path.moveTo(first.x, first.y);
      for (let i = 1; i < ring.length; i += 1) {
        const point = ring[i];
        if (point) path.lineTo(point.x, point.y);
      }
      path.closePath();
    }
    if (rings.length > 1) rule = 'evenodd';
  }
  if (selection.invert) {
    const outer = new Path2D();
    outer.rect(0, 0, width, height);
    outer.addPath(path);
    return { path: outer, rule: 'evenodd' };
  }
  return { path, rule };
}

export interface SelectionMask {
  /** Blanc + alpha : la couverture, utilisable avec `destination-in`. */
  canvas: HTMLCanvasElement;
  /** Couverture 0 → 255 par pixel, pour les réglages qui lisent des ImageData. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
  feather: number;
}

let canvasFilterSupport: boolean | null = null;

function supportsCanvasFilter(): boolean {
  if (canvasFilterSupport !== null) return canvasFilterSupport;
  const probe = document.createElement('canvas');
  probe.width = 2;
  probe.height = 2;
  const ctx = probe.getContext('2d');
  if (!ctx) return (canvasFilterSupport = false);
  ctx.filter = 'blur(1px)';
  canvasFilterSupport = ctx.filter !== 'none';
  return canvasFilterSupport;
}

function boxBlurAlpha(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): void {
  const alpha = new Uint8ClampedArray(width * height);
  for (let i = 0; i < alpha.length; i += 1) alpha[i] = data[i * 4 + 3] ?? 0;
  const temp = new Uint8ClampedArray(alpha.length);
  const span = radius * 2 + 1;
  for (let pass = 0; pass < 3; pass += 1) {
    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      let sum = 0;
      for (let x = -radius; x <= radius; x += 1) {
        sum += alpha[row + clamp(x, 0, width - 1)] ?? 0;
      }
      for (let x = 0; x < width; x += 1) {
        temp[row + x] = sum / span;
        sum +=
          (alpha[row + clamp(x + radius + 1, 0, width - 1)] ?? 0) -
          (alpha[row + clamp(x - radius, 0, width - 1)] ?? 0);
      }
    }
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let y = -radius; y <= radius; y += 1) {
        sum += temp[clamp(y, 0, height - 1) * width + x] ?? 0;
      }
      for (let y = 0; y < height; y += 1) {
        alpha[y * width + x] = sum / span;
        sum +=
          (temp[clamp(y + radius + 1, 0, height - 1) * width + x] ?? 0) -
          (temp[clamp(y - radius, 0, height - 1) * width + x] ?? 0);
      }
    }
  }
  for (let i = 0; i < alpha.length; i += 1) data[i * 4 + 3] = alpha[i] ?? 0;
}

/**
 * Construit le masque de contour progressif d'une sélection : blanc opaque au
 * centre, dégradé sur `feather` pixels. Renvoie `null` quand la sélection est
 * nette (aucun travail supplémentaire n'est alors nécessaire).
 */
export function buildSelectionMask(
  selection: Selection,
  width: number,
  height: number,
): SelectionMask | null {
  const feather = selectionFeather(selection);
  if (feather <= 0 || width < 1 || height < 1) return null;

  const base = createCanvas(width, height);
  const baseCtx = canvasContext(base);
  const geometry = selectionPath({ ...selection, invert: false }, width, height);
  baseCtx.fillStyle = '#ffffff';
  baseCtx.fill(geometry.path, geometry.rule);

  const canvas = createCanvas(width, height);
  const ctx = canvasContext(canvas);
  if (supportsCanvasFilter()) {
    ctx.filter = `blur(${feather / 2}px)`;
    ctx.drawImage(base, 0, 0);
    ctx.filter = 'none';
  } else {
    ctx.drawImage(base, 0, 0);
    const image = ctx.getImageData(0, 0, width, height);
    boxBlurAlpha(image.data, width, height, Math.max(1, Math.round(feather / 3)));
    ctx.putImageData(image, 0, 0);
  }

  let image = ctx.getImageData(0, 0, width, height);
  if (selection.invert) {
    for (let i = 3; i < image.data.length; i += 4) {
      image.data[i] = 255 - (image.data[i] ?? 0);
    }
    ctx.putImageData(image, 0, 0);
    image = ctx.getImageData(0, 0, width, height);
  }

  const data = new Uint8ClampedArray(width * height);
  for (let i = 0; i < data.length; i += 1) data[i] = image.data[i * 4 + 3] ?? 0;
  return { canvas, data, width, height, feather };
}

/**
 * Recombine `before` et `after` à travers un masque : `after * m + before * (1 - m)`.
 * L'addition du canvas (`lighter`) travaille en couleurs prémultipliées, ce qui
 * donne exactement le mélange attendu, y compris pour une gomme.
 */
export function blendThroughMask(
  before: HTMLCanvasElement,
  after: HTMLCanvasElement,
  mask: HTMLCanvasElement,
): HTMLCanvasElement {
  const maskedAfter = cloneCanvas(after);
  const afterCtx = canvasContext(maskedAfter);
  afterCtx.globalCompositeOperation = 'destination-in';
  afterCtx.drawImage(mask, 0, 0, after.width, after.height);

  const maskedBefore = cloneCanvas(before);
  const beforeCtx = canvasContext(maskedBefore);
  beforeCtx.globalCompositeOperation = 'destination-out';
  beforeCtx.drawImage(mask, 0, 0, after.width, after.height);

  const output = createCanvas(after.width, after.height);
  const ctx = canvasContext(output);
  ctx.drawImage(maskedAfter, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(maskedBefore, 0, 0);
  return output;
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Encodage impossible'))),
      type,
      quality,
    );
  });
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Lecture impossible'));
    reader.readAsDataURL(blob);
  });
}

export function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function decodeImage(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} Mo`;
}

export function debounce<T extends unknown[]>(
  fn: (...args: T) => void,
  delay: number,
): (...args: T) => void {
  let timer = 0;
  return (...args: T) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
}

export function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}
