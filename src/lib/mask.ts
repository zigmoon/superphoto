import type { Layer, PhotoDoc } from './types';
import { canvasContext, createCanvas } from './utils';

/**
 * Masques de fusion.
 *
 * Un masque est un canvas de la taille du document dont l'**alpha** porte la
 * visibilité : opaque = visible, transparent = masqué. Peindre en clair
 * (`source-over`) révèle, peindre en sombre (`destination-out`) masque — les
 * deux opérations sont donc des compositions natives, sans calcul par pixel.
 */

let scratch: HTMLCanvasElement | null = null;

function scratchCanvas(width: number, height: number): HTMLCanvasElement {
  if (!scratch) scratch = createCanvas(width, height);
  if (scratch.width !== width) scratch.width = width;
  if (scratch.height !== height) scratch.height = height;
  return scratch;
}

export function createMask(width: number, height: number): HTMLCanvasElement {
  const canvas = createCanvas(width, height);
  const ctx = canvasContext(canvas);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  return canvas;
}

export function maskIsActive(layer: Layer): boolean {
  return Boolean(layer.mask) && layer.maskEnabled !== false;
}

/**
 * Dessine un calque dans `ctx` en appliquant son masque. Le calque est composé
 * dans un canvas de travail : les opérations `destination-in` ne touchent donc
 * jamais la toile finale ni l'opacité globale du calque.
 */
export function drawMaskedLayer(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  dx = 0,
  dy = 0,
): void {
  if (!maskIsActive(layer) || !layer.mask) {
    ctx.drawImage(layer.canvas, dx, dy);
    return;
  }
  const width = layer.canvas.width;
  const height = layer.canvas.height;
  const work = scratchCanvas(width, height);
  const workCtx = canvasContext(work);
  workCtx.setTransform(1, 0, 0, 1, 0, 0);
  workCtx.globalAlpha = 1;
  workCtx.globalCompositeOperation = 'source-over';
  workCtx.clearRect(0, 0, width, height);
  workCtx.drawImage(layer.canvas, 0, 0);
  workCtx.globalCompositeOperation = 'destination-in';
  workCtx.drawImage(layer.mask, 0, 0, width, height);
  workCtx.globalCompositeOperation = 'source-over';
  ctx.drawImage(work, dx, dy);
}

/** Applique un masque à un canvas complet (aperçu, export, aplatissement). */
export function applyMaskToCanvas(
  canvas: HTMLCanvasElement,
  mask: HTMLCanvasElement,
): void {
  const ctx = canvasContext(canvas);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-over';
}

/** Vignette du masque : noir = masqué, blanc = visible. */
export function drawMaskThumb(
  thumb: HTMLCanvasElement,
  mask: HTMLCanvasElement,
): void {
  const ctx = thumb.getContext('2d');
  if (!ctx) return;
  const scale = Math.min(thumb.width / mask.width, thumb.height / mask.height);
  const width = Math.max(1, mask.width * scale);
  const height = Math.max(1, mask.height * scale);
  ctx.clearRect(0, 0, thumb.width, thumb.height);
  ctx.fillStyle = '#1b1b20';
  ctx.fillRect((thumb.width - width) / 2, (thumb.height - height) / 2, width, height);
  ctx.drawImage(mask, (thumb.width - width) / 2, (thumb.height - height) / 2, width, height);
}

export function cloneMask(mask: HTMLCanvasElement): HTMLCanvasElement {
  const copy = createCanvas(mask.width, mask.height);
  const ctx = canvasContext(copy);
  ctx.drawImage(mask, 0, 0);
  return copy;
}

/** Aplatit le masque dans les pixels : le calque garde exactement son rendu. */
export function flattenMask(layer: Layer): void {
  if (!layer.mask) return;
  const flat = createCanvas(layer.canvas.width, layer.canvas.height);
  const ctx = canvasContext(flat);
  ctx.drawImage(layer.canvas, 0, 0);
  if (layer.maskEnabled !== false) {
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(layer.mask, 0, 0, flat.width, flat.height);
  }
  layer.canvas = flat;
  layer.mask = undefined;
  layer.maskEnabled = undefined;
  layer.maskEditing = false;
}

export function docHasMask(doc: PhotoDoc | null): boolean {
  return Boolean(doc?.layers.some((layer) => Boolean(layer.mask)));
}
