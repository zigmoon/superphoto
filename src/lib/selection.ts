import type { Point, Selection } from './types';
import { canvasContext } from './utils';

/**
 * Baguette magique.
 *
 * Le remplissage par diffusion produit un masque binaire ; on en extrait les
 * contours (segments de frontière entre pixel pris et pixel non pris) pour
 * obtenir une **sélection polygonale à plusieurs anneaux**. Tout le reste de
 * l'éditeur — détourage, clip, inversion, réglages — continue donc de travailler
 * avec le même type `Selection`, sans code parallèle.
 */

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const MAX_RING_POINTS = 2600;

export function magicWandSelection(
  source: HTMLCanvasElement,
  x: number,
  y: number,
  tolerance: number,
  contiguous: boolean,
): Selection | null {
  const width = source.width;
  const height = source.height;
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  const ctx = canvasContext(source);
  const data = ctx.getImageData(0, 0, width, height).data;
  const startIndex = (y * width + x) * 4;
  const tr = data[startIndex] ?? 0;
  const tg = data[startIndex + 1] ?? 0;
  const tb = data[startIndex + 2] ?? 0;
  const ta = data[startIndex + 3] ?? 0;
  const limit = Math.max(0, Math.min(255, tolerance));

  const matches = (index: number): boolean => {
    const dr = Math.abs((data[index] ?? 0) - tr);
    const dg = Math.abs((data[index + 1] ?? 0) - tg);
    const db = Math.abs((data[index + 2] ?? 0) - tb);
    const da = Math.abs((data[index + 3] ?? 0) - ta);
    return Math.max(dr, dg, db, da) <= limit;
  };

  const mask = new Uint8Array(width * height);
  let count = 0;

  if (contiguous) {
    // Diffusion 4-connexe en profondeur : une pile d'indices, aucun objet.
    const stack: number[] = [y * width + x];
    mask[y * width + x] = 1;
    count = 1;
    while (stack.length > 0) {
      const current = stack.pop() as number;
      const cx = current % width;
      const cy = (current - cx) / width;
      if (cx > 0) {
        const next = current - 1;
        if (mask[next] === 0 && matches(next * 4)) {
          mask[next] = 1;
          count += 1;
          stack.push(next);
        }
      }
      if (cx < width - 1) {
        const next = current + 1;
        if (mask[next] === 0 && matches(next * 4)) {
          mask[next] = 1;
          count += 1;
          stack.push(next);
        }
      }
      if (cy > 0) {
        const next = current - width;
        if (mask[next] === 0 && matches(next * 4)) {
          mask[next] = 1;
          count += 1;
          stack.push(next);
        }
      }
      if (cy < height - 1) {
        const next = current + width;
        if (mask[next] === 0 && matches(next * 4)) {
          mask[next] = 1;
          count += 1;
          stack.push(next);
        }
      }
    }
  } else {
    for (let i = 0; i < width * height; i += 1) {
      if (matches(i * 4)) {
        mask[i] = 1;
        count += 1;
      }
    }
  }

  if (count === 0) return null;
  if (count === width * height) {
    return { type: 'rect', rect: { x: 0, y: 0, w: width, h: height }, invert: false };
  }

  const rings = traceRings(mask, width, height);
  if (rings.length === 0) return null;

  let total = rings.reduce((sum, ring) => sum + ring.length, 0);
  let epsilon = 1.1;
  let simplified = rings.map((ring) => simplifyRing(ring, epsilon));
  total = simplified.reduce((sum, ring) => sum + ring.length, 0);
  while (total > MAX_RING_POINTS && epsilon < 24) {
    epsilon *= 1.6;
    simplified = rings.map((ring) => simplifyRing(ring, epsilon));
    total = simplified.reduce((sum, ring) => sum + ring.length, 0);
  }

  const cleaned = simplified
    .filter((ring) => ring.length >= 3)
    .sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)));
  const outer = cleaned[0];
  if (!outer) return null;
  return { type: 'poly', points: outer, rings: cleaned, invert: false };
}

function traceRings(mask: Uint8Array, width: number, height: number): Point[][] {
  const segments: Segment[] = [];
  const at = (px: number, py: number): boolean =>
    px >= 0 && py >= 0 && px < width && py < height && mask[py * width + px] === 1;

  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      if (!at(px, py)) continue;
      if (!at(px, py - 1)) segments.push({ x1: px, y1: py, x2: px + 1, y2: py });
      if (!at(px + 1, py)) segments.push({ x1: px + 1, y1: py, x2: px + 1, y2: py + 1 });
      if (!at(px, py + 1)) segments.push({ x1: px + 1, y1: py + 1, x2: px, y2: py + 1 });
      if (!at(px - 1, py)) segments.push({ x1: px, y1: py + 1, x2: px, y2: py });
    }
  }
  if (segments.length === 0) return [];

  const gridWidth = width + 1;
  const buckets = new Map<number, number[]>();
  segments.forEach((segment, index) => {
    const key = segment.y1 * gridWidth + segment.x1;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(index);
    else buckets.set(key, [index]);
  });

  const used = new Uint8Array(segments.length);
  const rings: Point[][] = [];

  for (let index = 0; index < segments.length; index += 1) {
    if (used[index]) continue;
    const ring: Point[] = [];
    let current = index;
    let guard = segments.length + 4;
    const first = segments[index];
    if (!first) continue;
    let dirX = Math.sign(first.x2 - first.x1);
    let dirY = Math.sign(first.y2 - first.y1);
    while (current >= 0 && !used[current] && guard > 0) {
      guard -= 1;
      const segment = segments[current];
      if (!segment) break;
      used[current] = 1;
      ring.push({ x: segment.x1, y: segment.y1 });
      const key = segment.y2 * gridWidth + segment.x2;
      const candidates = buckets.get(key);
      let nextIndex = -1;
      if (candidates) {
        // On privilégie tout droit : sans cela, deux boucles qui se touchent
        // en diagonale se mélangent et le contour devient un zigzag.
        for (const candidate of candidates) {
          if (used[candidate]) continue;
          const candidateSegment = segments[candidate];
          if (!candidateSegment) continue;
          const sx = Math.sign(candidateSegment.x2 - candidateSegment.x1);
          const sy = Math.sign(candidateSegment.y2 - candidateSegment.y1);
          if (sx === dirX && sy === dirY) {
            nextIndex = candidate;
            break;
          }
          if (nextIndex < 0) nextIndex = candidate;
        }
      }
      if (nextIndex < 0) break;
      const nextSegment = segments[nextIndex];
      if (!nextSegment) break;
      dirX = Math.sign(nextSegment.x2 - nextSegment.x1);
      dirY = Math.sign(nextSegment.y2 - nextSegment.y1);
      current = nextIndex;
    }
    if (ring.length >= 4) rings.push(ring);
  }

  return rings;
}

function simplifyRing(points: Point[], epsilon: number): Point[] {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop() as [number, number];
    const first = points[start];
    const last = points[end];
    if (!first || !last || end <= start + 1) continue;
    let farthest = -1;
    let maxDistance = 0;
    for (let i = start + 1; i < end; i += 1) {
      const point = points[i];
      if (!point) continue;
      const distance = distanceToSegment(point, first, last);
      if (distance > maxDistance) {
        maxDistance = distance;
        farthest = i;
      }
    }
    if (farthest > 0 && maxDistance > epsilon) {
      keep[farthest] = 1;
      stack.push([start, farthest], [farthest, end]);
    }
  }
  const result: Point[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (keep[i] && point) result.push(point);
  }
  return result.length >= 3 ? result : points;
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function polygonArea(points: Point[]): number {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (!a || !b) continue;
    area += b.x * a.y - a.x * b.y;
  }
  return area / 2;
}
