/**
 * Lassos : polygonal et magnétique.
 *
 * Le lasso simple (main levée) n'a besoin d'aucun calcul : il enregistre les
 * points du geste. Le lasso **polygonal** non plus — il empile des sommets au
 * clic. Le lasso **magnétique**, lui, demande une carte de contours : on la
 * calcule une fois au début du geste, puis chaque déplacement du pointeur est
 * aimanté vers le maximum de contraste dans un petit rayon.
 *
 * La carte est calculée sur une copie réduite (au plus `MAX_SIDE`), ce qui la
 * garde rapide même sur une photo de 30 Mpx : un Sobel pleine résolution
 * coûterait plusieurs dizaines de millisecondes à chaque prise en main, pour un
 * gain invisible à l'écran.
 */
import type { Point } from './types';
import { canvasContext, createCanvas } from './utils';

/** Contraste minimal pour qu'un point soit considéré comme un bord. */
const MIN_STRENGTH = 26;

/** Côté maximal de la carte : au-delà, on réduit (précision ≈ 1 px écran). */
const MAX_SIDE = 1400;

export interface EdgeMap {
  /** Pixels du document → pixels de la carte (et inversement). */
  scale: number;
  width: number;
  height: number;
  strength: Uint8Array;
}

/**
 * Carte de contours (magnitude de Sobel sur la luminance prémultipliée).
 *
 * La luminance est multipliée par l'alpha : sans cela, un calque détouré
 * n'aurait aucun contour sur ses bords transparents, et le lasso magnétique
 * refuserait justement le détourage pour lequel il existe.
 */
export function buildEdgeMap(source: HTMLCanvasElement): EdgeMap {
  const longest = Math.max(source.width, source.height);
  const scale = longest > MAX_SIDE ? MAX_SIDE / longest : 1;
  const width = Math.max(2, Math.round(source.width * scale));
  const height = Math.max(2, Math.round(source.height * scale));

  const small = createCanvas(width, height);
  const ctx = canvasContext(small);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'low';
  ctx.drawImage(source, 0, 0, width, height);

  const data = ctx.getImageData(0, 0, width, height).data;
  const luma = new Float32Array(width * height);
  for (let index = 0; index < luma.length; index += 1) {
    const alpha = (data[index * 4 + 3] ?? 0) / 255;
    if (alpha === 0) continue;
    const r = data[index * 4] ?? 0;
    const g = data[index * 4 + 1] ?? 0;
    const b = data[index * 4 + 2] ?? 0;
    luma[index] = (0.299 * r + 0.587 * g + 0.114 * b) * alpha;
  }

  const strength = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const up = Math.max(0, y - 1);
    const down = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - 1);
      const right = Math.min(width - 1, x + 1);
      const tl = luma[up * width + left] ?? 0;
      const tc = luma[up * width + x] ?? 0;
      const tr = luma[up * width + right] ?? 0;
      const ml = luma[y * width + left] ?? 0;
      const mr = luma[y * width + right] ?? 0;
      const bl = luma[down * width + left] ?? 0;
      const bc = luma[down * width + x] ?? 0;
      const br = luma[down * width + right] ?? 0;
      const gx = tr + 2 * mr + br - (tl + 2 * ml + bl);
      const gy = bl + 2 * bc + br - (tl + 2 * tc + tr);
      const magnitude = Math.sqrt(gx * gx + gy * gy) / 4;
      strength[y * width + x] = Math.min(255, Math.round(magnitude));
    }
  }
  return { scale, width, height, strength };
}

/**
 * Aimante un point vers le contour le plus marqué dans un rayon donné.
 *
 * Le score mêle le contraste et la distance : un bord très franc peut attirer
 * depuis plus loin, un bord faible ne prend la main que sous le curseur. On
 * parcourt des anneaux (et non tout le disque) pour rester bon marché.
 */
export function snapToEdge(map: EdgeMap, point: Point, radius: number): Point {
  const cx = point.x * map.scale;
  const cy = point.y * map.scale;
  const limit = Math.max(1.5, radius * map.scale);
  const rings = Math.max(1, Math.ceil(limit));
  let bestX = -1;
  let bestY = -1;
  let bestScore = -Infinity;
  for (let ring = 1; ring <= rings; ring += 1) {
    const steps = Math.max(8, Math.round(ring * 7));
    for (let step = 0; step < steps; step += 1) {
      const angle = (step / steps) * Math.PI * 2;
      const x = Math.round(cx + Math.cos(angle) * ring);
      const y = Math.round(cy + Math.sin(angle) * ring);
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
      const value = map.strength[y * map.width + x] ?? 0;
      if (value < MIN_STRENGTH) continue;
      // Pénalité de distance : le contour doit « gagner » sa distance au curseur.
      const score = value - ring * 5;
      if (score > bestScore) {
        bestScore = score;
        bestX = x;
        bestY = y;
      }
    }
  }
  if (bestX < 0) return { ...point };
  // Le centre de la cellule est plus juste que son coin supérieur gauche.
  return { x: (bestX + 0.5) / map.scale, y: (bestY + 0.5) / map.scale };
}

/**
 * Interpole un segment en pas réguliers : le lasso magnétique saute d'un bord à
 * l'autre, et sans ces points intermédiaires la sélection couperait les angles.
 */
export function densify(from: Point, to: Point, step: number): Point[] {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  if (distance < step) return [];
  const count = Math.min(512, Math.floor(distance / step));
  const points: Point[] = [];
  for (let index = 1; index <= count; index += 1) {
    const t = index / (count + 1);
    points.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  }
  return points;
}
