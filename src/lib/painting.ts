import type { BrushSettings, Point } from './types';
import { canvasContext, clamp, createCanvas, hexToRgb, withAlpha } from './utils';

/**
 * Moteur de peinture.
 *
 * Trois familles de tampons, toutes composées en dur dans un canvas de travail
 * de la taille du pinceau (jamais du document) :
 *   • `strokeBrush` / `paintStamp` — pinceau doux, dureté et espacement réglables ;
 *   • `strokePencil` — trait net sans lissage ;
 *   • `cloneStamp` / `healStamp` — tampon et correcteur (copie + harmonisation).
 *
 * `composite` porte le mode : `source-over` peint, `destination-out` efface
 * (gomme et masque).
 */

const TAU = Math.PI * 2;

let buffer: HTMLCanvasElement | null = null;
let bufferSize = 0;

function stampBuffer(size: number): HTMLCanvasElement {
  if (!buffer) buffer = createCanvas(size, size);
  if (bufferSize !== size) {
    buffer.width = size;
    buffer.height = size;
    bufferSize = size;
  }
  return buffer;
}

/**
 * Tampon d'encre pré-rendu.
 *
 * Un dégradé radial était recréé à chaque tampon — soit plusieurs dizaines de
 * fois par trait. On le dessine une fois dans un petit canvas, puis chaque
 * tampon n'est plus qu'un `drawImage` : même rendu, coût divisé.
 */
let stamp: HTMLCanvasElement | null = null;
let stampKey = '';

function stampFor(radius: number, hardness: number, color: string): HTMLCanvasElement {
  const size = Math.max(2, Math.ceil(radius * 2) + 2);
  const key = `${size}|${radius.toFixed(2)}|${hardness.toFixed(3)}|${color}`;
  if (stamp && stampKey === key) return stamp;
  const canvas = createCanvas(size, size);
  const ctx = canvasContext(canvas);
  const center = size / 2;
  if (hardness >= 0.995 || radius <= 1.5) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, TAU);
    ctx.fill();
  } else {
    const gradient = ctx.createRadialGradient(
      center,
      center,
      radius * clamp(hardness, 0, 0.98),
      center,
      center,
      radius,
    );
    gradient.addColorStop(0, withAlpha(color, 1));
    gradient.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, TAU);
    ctx.fill();
  }
  stamp = canvas;
  stampKey = key;
  return canvas;
}

export function paintStamp(
  ctx: CanvasRenderingContext2D,
  point: Point,
  brush: BrushSettings,
  color: string,
  composite: GlobalCompositeOperation,
  alpha: number,
): void {
  const radius = Math.max(0.5, brush.size / 2);
  const bitmap = stampFor(radius, brush.hardness, color);
  ctx.save();
  ctx.globalCompositeOperation = composite;
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.drawImage(bitmap, point.x - bitmap.width / 2, point.y - bitmap.height / 2);
  ctx.restore();
}

/**
 * Tamponne le long d'un segment en conservant la distance restante d'un
 * événement pointeur à l'autre : la densité du trait ne dépend pas de la
 * fréquence de la souris.
 */
export function walkStroke(
  from: Point,
  to: Point,
  size: number,
  spacing: number,
  carry: number,
  stamp: (point: Point) => void,
): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 0.01) return carry;
  const step = Math.max(0.75, size * clamp(spacing, 0.02, 1));
  const ux = dx / distance;
  const uy = dy / distance;
  let travelled = carry;
  let position = 0;
  let guard = 4096;
  while (guard > 0) {
    guard -= 1;
    const next = step - travelled;
    if (position + next > distance) {
      travelled += distance - position;
      break;
    }
    position += next;
    stamp({ x: from.x + ux * position, y: from.y + uy * position });
    travelled = 0;
  }
  return travelled;
}

export function strokeBrush(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  brush: BrushSettings,
  color: string,
  composite: GlobalCompositeOperation,
  alpha: number,
  carry: number,
): number {
  return walkStroke(from, to, brush.size, brush.spacing, carry, (point) =>
    paintStamp(ctx, point, brush, color, composite, alpha),
  );
}

export function strokePencil(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  size: number,
  color: string,
  composite: GlobalCompositeOperation,
  alpha: number,
): void {
  ctx.save();
  ctx.globalCompositeOperation = composite;
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1, size);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  if (Math.abs(to.x - from.x) < 0.01 && Math.abs(to.y - from.y) < 0.01) {
    ctx.lineTo(to.x + 0.01, to.y + 0.01);
  } else {
    ctx.lineTo(to.x, to.y);
  }
  ctx.stroke();
  ctx.restore();
}

export interface ColorShift {
  r: number;
  g: number;
  b: number;
}

/** Moyenne d'un disque : sert à harmoniser un tampon ou une pièce. */
export function meanColorAround(
  source: HTMLCanvasElement,
  point: Point,
  radius: number,
): ColorShift {
  const ctx = canvasContext(source);
  const size = Math.max(1, Math.round(radius * 2));
  const x = clamp(Math.round(point.x - radius), 0, Math.max(0, source.width - 1));
  const y = clamp(Math.round(point.y - radius), 0, Math.max(0, source.height - 1));
  const width = Math.min(size, source.width - x);
  const height = Math.min(size, source.height - y);
  if (width < 1 || height < 1) return { r: 0, g: 0, b: 0 };
  const data = ctx.getImageData(x, y, width, height).data;
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  const stride = Math.max(4, Math.floor(Math.sqrt((width * height) / 256)) * 4);
  for (let i = 0; i < data.length; i += stride) {
    if ((data[i + 3] ?? 0) < 8) continue;
    r += data[i] ?? 0;
    g += data[i + 1] ?? 0;
    b += data[i + 2] ?? 0;
    count += 1;
  }
  if (count === 0) return { r: 0, g: 0, b: 0 };
  return { r: r / count, g: g / count, b: b / count };
}

export function colorShift(adapted: ColorShift, reference: ColorShift): ColorShift {
  return {
    r: reference.r - adapted.r,
    g: reference.g - adapted.g,
    b: reference.b - adapted.b,
  };
}

/** Applique un décalage RVB constant à un petit canvas (tampon uniquement). */
export function shiftCanvas(canvas: HTMLCanvasElement, shift: ColorShift): void {
  if (!shift.r && !shift.g && !shift.b) return;
  const ctx = canvasContext(canvas);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 3] ?? 0) === 0) continue;
    data[i] = clamp((data[i] ?? 0) + shift.r, 0, 255);
    data[i + 1] = clamp((data[i + 1] ?? 0) + shift.g, 0, 255);
    data[i + 2] = clamp((data[i + 2] ?? 0) + shift.b, 0, 255);
  }
  ctx.putImageData(image, 0, 0);
}

function softMask(bufferCtx: CanvasRenderingContext2D, size: number, hardness: number): void {
  if (hardness >= 0.995) return;
  const radius = size / 2;
  const gradient = bufferCtx.createRadialGradient(
    radius,
    radius,
    radius * clamp(hardness, 0, 0.98),
    radius,
    radius,
    radius,
  );
  gradient.addColorStop(0, 'rgba(0,0,0,1)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  bufferCtx.globalCompositeOperation = 'destination-in';
  bufferCtx.fillStyle = gradient;
  bufferCtx.fillRect(0, 0, size, size);
  bufferCtx.globalCompositeOperation = 'source-over';
}

export interface CloneOptions {
  size: number;
  hardness: number;
  alpha: number;
  shift?: ColorShift;
}

/** Tampon : copie une zone de `source` autour de `src` vers `dst`. */
export function cloneStamp(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  src: Point,
  dst: Point,
  options: CloneOptions,
): void {
  const size = Math.max(1, Math.round(options.size));
  const radius = options.size / 2;
  const buffer = stampBuffer(size);
  const bufferCtx = canvasContext(buffer);
  bufferCtx.setTransform(1, 0, 0, 1, 0, 0);
  bufferCtx.globalAlpha = 1;
  bufferCtx.globalCompositeOperation = 'source-over';
  bufferCtx.clearRect(0, 0, size, size);
  bufferCtx.imageSmoothingEnabled = true;
  bufferCtx.drawImage(
    source,
    src.x - radius,
    src.y - radius,
    options.size,
    options.size,
    0,
    0,
    size,
    size,
  );
  if (options.shift) shiftCanvas(buffer, options.shift);
  softMask(bufferCtx, size, options.hardness);
  ctx.save();
  ctx.globalAlpha = clamp(options.alpha, 0, 1);
  ctx.drawImage(buffer, dst.x - radius, dst.y - radius, options.size, options.size);
  ctx.restore();
}

/**
 * Pièce : copie le contenu d'une zone vers une autre. `shift` harmonise la
 * couleur de la copie sur celle de la zone d'accueil (le « correcteur »).
 */
export function patchRegion(
  target: HTMLCanvasElement,
  source: HTMLCanvasElement,
  source_rect: { x: number; y: number; w: number; h: number },
  dst: Point,
  shift: ColorShift | null,
): void {
  const width = Math.max(1, Math.round(source_rect.w));
  const height = Math.max(1, Math.round(source_rect.h));
  const patch = createCanvas(width, height);
  const patchCtx = canvasContext(patch);
  patchCtx.drawImage(
    source,
    Math.round(dst.x),
    Math.round(dst.y),
    width,
    height,
    0,
    0,
    width,
    height,
  );
  if (shift) shiftCanvas(patch, shift);
  const ctx = canvasContext(target);
  ctx.save();
  ctx.beginPath();
  ctx.rect(source_rect.x, source_rect.y, width, height);
  ctx.clip();
  ctx.clearRect(source_rect.x, source_rect.y, width, height);
  ctx.drawImage(patch, Math.round(source_rect.x), Math.round(source_rect.y));
  ctx.restore();
}

export function brushColorForMask(color: string): 'reveal' | 'hide' {
  const { r, g, b } = hexToRgb(color);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance >= 128 ? 'reveal' : 'hide';
}
