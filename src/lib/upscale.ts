/**
 * Agrandissement (upscale) ×2 / ×4 — JavaScript pur, sans dépendance.
 *
 * Un seul `drawImage` vers une taille double donne un résultat mou : le
 * rééchantillonnage bicubique du navigateur lisse les transitions mais ne
 * recrée aucune micro-contraste. Le pipeline fait donc deux choses :
 *
 *   1. **doublements successifs** (2× par étape, `imageSmoothingQuality: high`).
 *      Passer par 2× plutôt que directement 4× évite un seul grand noyau
 *      approximé : chaque étage reste proche d'un bicubique propre.
 *   2. **masque flou** (unsharp mask) appliqué par bandes, avec seuil : les
 *      contours regagnent leur netteté, le bruit plat n'est pas amplifié.
 *
 * Tout est fait sur les pixels (`ImageData`), sans WebGL ni WASM. Le travail est
 * découpé en bandes avec un `await` entre chaque : l'interface reste vivante et
 * peut afficher sa progression.
 */
import type { PhotoDoc } from './types';
import { canvasContext, createCanvas } from './utils';

export interface UpscaleOptions {
  /** Force du masque flou, 0 → 2. 0 = agrandissement pur. */
  detail?: number;
  /** Progression 0 → 1, appelée entre deux bandes. */
  onProgress?: (value: number) => void;
}

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      resolve();
    };
    // Un onglet en arrière-plan ne reçoit aucune frame : le minuteur garantit
    // que le travail continue même sans rendu visible.
    const timer = window.setTimeout(finish, 16);
    window.requestAnimationFrame(finish);
  });

/**
 * Rend la main à l'interface **seulement si** le dernier rendu date de plus de
 * 24 ms. Sur une petite image, aucun aller-retour n'est nécessaire ; sur une
 * grande, le travail est découpé en tranches et la barre de progression suit.
 */
let lastBreath = 0;
async function breathe(): Promise<void> {
  // Onglet caché : personne ne regarde, et les minuteurs y sont limités à
  // environ une seconde. Y céder la main rendrait l'agrandissement des dizaines
  // de fois plus lent ; on travaille donc d'une traite.
  if (document.visibilityState !== 'visible') return;
  const now = performance.now();
  if (now - lastBreath < 24) return;
  lastBreath = now;
  await nextFrame();
}

function drawScaled(
  source: HTMLCanvasElement,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = createCanvas(width, height);
  const ctx = canvasContext(canvas);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

/** Doublement successif : 1 → 2 → 4, chaque étage restant un bicubique propre. */
async function progressiveScale(
  source: HTMLCanvasElement,
  targetWidth: number,
  targetHeight: number,
  onStep: () => void,
): Promise<HTMLCanvasElement> {
  let current = source;
  let width = source.width;
  let height = source.height;
  let guard = 0;
  while (width * 2 <= targetWidth && height * 2 <= targetHeight && guard < 4) {
    width *= 2;
    height *= 2;
    current = drawScaled(current, width, height);
    onStep();
    await breathe();
    guard += 1;
  }
  if (width !== targetWidth || height !== targetHeight) {
    current = drawScaled(current, targetWidth, targetHeight);
  }
  return current;
}

/** Flou moyen horizontal + vertical, en place sur un canal flottant. */
async function boxBlur(
  source: Float32Array,
  target: Float32Array,
  width: number,
  height: number,
  radius: number,
): Promise<void> {
  const span = radius * 2 + 1;
  // Horizontal, ligne par ligne : la tranche de travail reste courte.
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    for (let i = -radius; i <= radius; i += 1) {
      const x = Math.min(width - 1, Math.max(0, i));
      sum += source[row + x]!;
    }
    for (let x = 0; x < width; x += 1) {
      target[row + x] = sum / span;
      const out = Math.min(width - 1, Math.max(0, x - radius));
      const next = Math.min(width - 1, Math.max(0, x + radius + 1));
      sum += source[row + next]! - source[row + out]!;
    }
    if ((y & 127) === 127) await breathe();
  }
  // Vertical, colonne par colonne : même découpage, un axe à la fois.
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let i = -radius; i <= radius; i += 1) {
      const y = Math.min(height - 1, Math.max(0, i));
      sum += target[y * width + x]!;
    }
    for (let y = 0; y < height; y += 1) {
      source[y * width + x] = sum / span;
      const out = Math.min(height - 1, Math.max(0, y - radius));
      const next = Math.min(height - 1, Math.max(0, y + radius + 1));
      sum += target[next * width + x]! - target[out * width + x]!;
    }
    if ((x & 127) === 127) await breathe();
  }
}

/**
 * Masque flou par bandes : `pixel = pixel + force × (pixel − flou)` au-delà du
 * seuil. Les pixels transparents sont laissés tels quels, sinon un liseré
 * sombre apparaîtrait sur les bords.
 *
 * Traitement **par bandes horizontales** : deux `Float32Array` à la taille de
 * l'image demanderaient 760 Mo sur un ×4 de 12 000 × 8 000 et feraient tomber
 * l'onglet. Chaque bande est lue avec une marge égale au rayon du flou, seules
 * ses lignes intérieures sont réécrites, et la mémoire reste bornée.
 */
async function sharpen(
  canvas: HTMLCanvasElement,
  amount: number,
  onProgress: (value: number) => void,
): Promise<void> {
  if (amount <= 0.001) return;
  const { width, height } = canvas;
  const ctx = canvasContext(canvas);
  const radius = Math.max(1, Math.round(Math.min(width, height) / 900));
  // Une bande de 256 lignes plus la marge : quelques mégaoctets, pas gigaoctets.
  const bandHeight = 256;
  const margin = radius + 1;
  const threshold = 2;
  const bands = Math.max(1, Math.ceil(height / bandHeight));
  for (let band = 0; band < bands; band += 1) {
    const top = band * bandHeight;
    const bottom = Math.min(height, top + bandHeight);
    const readTop = Math.max(0, top - margin);
    const readBottom = Math.min(height, bottom + margin);
    const rows = readBottom - readTop;
    const image = ctx.getImageData(0, readTop, width, rows);
    const data = image.data;
    const size = width * rows;
    const channel = new Float32Array(size);
    const blurred = new Float32Array(size);
    // Netteté par **luminance** : un seul flou au lieu de trois. C'est le
    // réglage classique (pas de franges colorées) et trois fois moins de calcul.
    for (let i = 0; i < size; i += 1) {
      const r = data[i * 4]!;
      const g = data[i * 4 + 1]!;
      const b = data[i * 4 + 2]!;
      channel[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
    await boxBlur(channel, blurred, width, rows, radius);
    const first = top - readTop;
    const last = bottom - readTop;
    for (let y = first; y < last; y += 1) {
      const row = y * width;
      for (let x = 0; x < width; x += 1) {
        const i = row + x;
        if (data[i * 4 + 3]! < 8) continue;
        const delta = channel[i]! - blurred[i]!;
        if (Math.abs(delta) < threshold) continue;
        const boost = delta * amount;
        data[i * 4] = data[i * 4]! + boost;
        data[i * 4 + 1] = data[i * 4 + 1]! + boost;
        data[i * 4 + 2] = data[i * 4 + 2]! + boost;
      }
    }
    ctx.putImageData(image, 0, readTop, 0, first, width, last - first);
    onProgress((band + 1) / bands);
    await breathe();
  }
}

/**
 * Agrandit un canvas jusqu'à la taille demandée.
 *
 * Le facteur réel est déduit des dimensions : un document non carré garde ses
 * proportions, l'agrandissement travaille donc étage par étage sur les deux
 * axes.
 */
export async function upscaleCanvas(
  source: HTMLCanvasElement,
  targetWidth: number,
  targetHeight: number,
  options: UpscaleOptions = {},
): Promise<HTMLCanvasElement> {
  const width = Math.max(1, Math.round(targetWidth));
  const height = Math.max(1, Math.round(targetHeight));
  const steps = Math.max(
    1,
    Math.ceil(Math.log2(Math.max(width / source.width, height / source.height))),
  );
  let done = 0;
  const scaled = await progressiveScale(source, width, height, () => {
    done += 1;
    options.onProgress?.(Math.min(0.6, done / (steps + 2)));
  });
  await sharpen(scaled, options.detail ?? 0.6, (value) => {
    options.onProgress?.(0.6 + value * 0.4);
  });
  const output = createCanvas(width, height);
  canvasContext(output).drawImage(scaled, 0, 0);
  return output;
}

/**
 * Agrandit un document entier : chaque calque, chaque masque, et la géométrie
 * des textes et tracés. Équivalent de `resizeDocumentImage`, mais avec le
 * pipeline d'agrandissement au lieu du seul rééchantillonnage du navigateur.
 */
export async function upscaleDocument(
  doc: PhotoDoc,
  newWidth: number,
  newHeight: number,
  dpi: number,
  options: UpscaleOptions = {},
): Promise<void> {
  const sx = newWidth / doc.width;
  const sy = newHeight / doc.height;
  const scale = (sx + sy) / 2;
  const layers = doc.layers.length || 1;
  for (let index = 0; index < doc.layers.length; index += 1) {
    const layer = doc.layers[index];
    if (!layer) continue;
    const base = index / layers;
    layer.colorSource = undefined;
    layer.canvas = await upscaleCanvas(layer.canvas, newWidth, newHeight, {
      detail: options.detail,
      onProgress: (value) => options.onProgress?.((base + value / layers) * 0.9),
    });
    if (layer.mask) {
      layer.mask = await upscaleCanvas(layer.mask, newWidth, newHeight, {
        detail: 0,
      });
    }
    if (layer.text) {
      layer.text.x *= sx;
      layer.text.y *= sy;
      layer.text.fontSize *= scale;
      layer.text.bounds = undefined;
    }
    if (layer.path) {
      for (const anchor of layer.path.anchors) {
        anchor.x *= sx;
        anchor.y *= sy;
        anchor.inX *= sx;
        anchor.inY *= sy;
        anchor.outX *= sx;
        anchor.outY *= sy;
      }
      layer.path.strokeWidth *= scale;
    }
  }
  doc.width = newWidth;
  doc.height = newHeight;
  doc.dpi = dpi;
  options.onProgress?.(1);
}
