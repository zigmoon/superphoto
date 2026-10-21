import { cloneMask, drawMaskedLayer } from './mask';
import type {
  ColorMode,
  Layer,
  LayerKind,
  PathData,
  PhotoDoc,
  Rect,
  TextData,
} from './types';
import { canvasContext, createCanvas, deepClone, uid } from './utils';
import { t } from './i18n';

export const DEFAULT_FONT = 'Inter';

export function createLayer(
  name: string,
  width: number,
  height: number,
  kind: LayerKind = 'raster',
  fill?: string,
): Layer {
  const canvas = createCanvas(width, height);
  if (fill) {
    const ctx = canvasContext(canvas);
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, width, height);
  }
  return {
    id: uid(),
    name,
    kind,
    visible: true,
    opacity: 1,
    blend: 'source-over',
    canvas,
  };
}

export function createDocument(
  width: number,
  height: number,
  dpi: number,
  background: PhotoDoc['background'],
  name = t('new.untitled'),
  colorMode: ColorMode = 'rgb',
): PhotoDoc {
  const layers: Layer[] = [];
  if (background !== 'transparent') {
    const backgroundLayer = createLayer(
      t('layers.background'),
      width,
      height,
      'raster',
      background === 'white' ? '#ffffff' : '#000000',
    );
    // Comme dans Photoshop : le fond est verrouillé à la création. On le
    // déverrouille d'un clic sur le cadenas, ou on duplique le calque.
    backgroundLayer.locked = true;
    layers.push(backgroundLayer);
  }
  const paintLayer = createLayer(`${t('layers.placeholder')} 1`, width, height, 'raster');
  layers.push(paintLayer);
  return {
    name,
    width,
    height,
    dpi,
    background,
    colorMode,
    layers,
    activeLayerId: paintLayer.id,
  };
}

export function buildPath2D(path: PathData): Path2D {
  const p = new Path2D();
  const anchors = path.anchors;
  if (anchors.length === 0) return p;
  const first = anchors[0];
  if (!first) return p;
  p.moveTo(first.x, first.y);
  for (let i = 0; i < anchors.length - 1; i += 1) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (!a || !b) continue;
    p.bezierCurveTo(
      a.x + a.outX,
      a.y + a.outY,
      b.x + b.inX,
      b.y + b.inY,
      b.x,
      b.y,
    );
  }
  if (path.closed && anchors.length > 1) {
    const last = anchors[anchors.length - 1];
    if (last) {
      p.bezierCurveTo(
        last.x + last.outX,
        last.y + last.outY,
        first.x + first.inX,
        first.y + first.inY,
        first.x,
        first.y,
      );
      p.closePath();
    }
  }
  return p;
}

export function pathToSvg(path: PathData): string {
  const anchors = path.anchors;
  const first = anchors[0];
  if (!first) return '';
  const parts = [`M ${first.x} ${first.y}`];
  for (let i = 0; i < anchors.length - 1; i += 1) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (!a || !b) continue;
    parts.push(
      `C ${a.x + a.outX} ${a.y + a.outY}, ${b.x + b.inX} ${b.y + b.inY}, ${b.x} ${b.y}`,
    );
  }
  if (path.closed && anchors.length > 1) {
    const last = anchors[anchors.length - 1];
    if (last) {
      parts.push(
        `C ${last.x + last.outX} ${last.y + last.outY}, ${first.x + first.inX} ${first.y + first.inY}, ${first.x} ${first.y}`,
      );
      parts.push('Z');
    }
  }
  return parts.join(' ');
}

export function renderTextLayer(layer: Layer): void {
  const ctx = canvasContext(layer.canvas);
  ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
  const text = layer.text;
  if (!text) return;
  const family = text.fontFamily.includes(' ') ? `"${text.fontFamily}"` : text.fontFamily;
  const font = `${text.fontWeight} ${text.fontSize}px ${family}, sans-serif`;
  ctx.font = font;
  ctx.textBaseline = 'top';
  ctx.textAlign = text.align;
  ctx.fillStyle = text.color;

  const lines = text.content.split('\n');
  const lineHeight = text.fontSize * text.lineHeight;
  let maxWidth = 0;
  for (const line of lines) {
    maxWidth = Math.max(maxWidth, ctx.measureText(line || ' ').width);
  }
  lines.forEach((line, index) => {
    ctx.fillText(line, text.x, text.y + index * lineHeight);
  });

  const totalHeight = Math.max(lineHeight, lines.length * lineHeight);
  const left = text.align === 'center'
    ? text.x - maxWidth / 2
    : text.align === 'right'
      ? text.x - maxWidth
      : text.x;
  text.bounds = {
    x: left,
    y: text.y,
    w: maxWidth,
    h: totalHeight,
  };
}

export function renderPathLayer(layer: Layer): void {
  const ctx = canvasContext(layer.canvas);
  ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
  const path = layer.path;
  if (!path || path.anchors.length === 0) return;
  const p = buildPath2D(path);
  if (path.fill) {
    ctx.fillStyle = path.fill;
    ctx.fill(p);
  }
  if (path.stroke && path.strokeWidth > 0) {
    ctx.strokeStyle = path.stroke;
    ctx.lineWidth = path.strokeWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke(p);
  }
}

export function renderLayer(layer: Layer): void {
  if (layer.kind === 'text') renderTextLayer(layer);
  else if (layer.kind === 'path') renderPathLayer(layer);
}

/**
 * Contexte d'affichage SANS `willReadFrequently` : sur Chromium, ce drapeau
 * force le rendu logiciel du canvas. La toile composite est dessinée à chaque
 * frame — elle doit rester accélérée par le GPU.
 */
function renderContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponible');
  return ctx;
}

export function renderDocument(
  doc: PhotoDoc,
  target: HTMLCanvasElement,
  background?: string | null,
): void {
  if (target.width !== doc.width) target.width = doc.width;
  if (target.height !== doc.height) target.height = doc.height;
  const ctx = renderContext(target);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, target.width, target.height);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, target.width, target.height);
  }
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blend;
    drawMaskedLayer(ctx, layer, 0, 0);
    ctx.restore();
  }
}

export function compositeCanvas(doc: PhotoDoc, background?: string | null): HTMLCanvasElement {
  const canvas = createCanvas(doc.width, doc.height);
  renderDocument(doc, canvas, background);
  return canvas;
}

export interface LayerGeometryState {
  layer: Layer;
  canvas: HTMLCanvasElement;
  mask?: HTMLCanvasElement;
  text?: TextData;
  path?: PathData;
}

export interface DocGeometrySnapshot {
  width: number;
  height: number;
  dpi: number;
  states: LayerGeometryState[];
}

export function snapshotGeometry(doc: PhotoDoc): DocGeometrySnapshot {
  return {
    width: doc.width,
    height: doc.height,
    dpi: doc.dpi,
    states: doc.layers.map((layer) => ({
      layer,
      canvas: layer.canvas,
      mask: layer.mask,
      text: layer.text ? deepClone(layer.text) : undefined,
      path: layer.path ? deepClone(layer.path) : undefined,
    })),
  };
}

export function restoreGeometry(doc: PhotoDoc, snapshot: DocGeometrySnapshot): void {
  doc.width = snapshot.width;
  doc.height = snapshot.height;
  doc.dpi = snapshot.dpi;
  for (const state of snapshot.states) {
    state.layer.canvas = state.canvas;
    state.layer.mask = state.mask;
    state.layer.text = state.text ? deepClone(state.text) : undefined;
    state.layer.path = state.path ? deepClone(state.path) : undefined;
  }
}

export function resizeDocumentImage(
  doc: PhotoDoc,
  newWidth: number,
  newHeight: number,
  dpi: number,
  quality: ImageSmoothingQuality = 'high',
): DocGeometrySnapshot {
  const sx = newWidth / doc.width;
  const sy = newHeight / doc.height;
  const scale = (sx + sy) / 2;
  for (const layer of doc.layers) {
    // La géométrie a changé : la source chromatique décrit une autre taille.
    layer.colorSource = undefined;
    const next = createCanvas(newWidth, newHeight);
    const ctx = canvasContext(next);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = quality;
    ctx.drawImage(layer.canvas, 0, 0, newWidth, newHeight);
    layer.canvas = next;
    if (layer.mask) {
      const mask = createCanvas(newWidth, newHeight);
      const maskCtx = canvasContext(mask);
      maskCtx.imageSmoothingEnabled = true;
      maskCtx.imageSmoothingQuality = quality;
      maskCtx.drawImage(layer.mask, 0, 0, newWidth, newHeight);
      layer.mask = mask;
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
  return snapshotGeometry(doc);
}

export function resizeDocumentCanvas(
  doc: PhotoDoc,
  newWidth: number,
  newHeight: number,
  anchorX: number,
  anchorY: number,
): DocGeometrySnapshot {
  const offsetX = (newWidth - doc.width) * anchorX;
  const offsetY = (newHeight - doc.height) * anchorY;
  for (const layer of doc.layers) {
    // La géométrie a changé : la source chromatique décrit une autre taille.
    layer.colorSource = undefined;
    const next = createCanvas(newWidth, newHeight);
    const ctx = canvasContext(next);
    ctx.drawImage(layer.canvas, offsetX, offsetY);
    layer.canvas = next;
    if (layer.mask) {
      const mask = createCanvas(newWidth, newHeight);
      const maskCtx = canvasContext(mask);
      maskCtx.drawImage(layer.mask, offsetX, offsetY);
      layer.mask = mask;
    }
    if (layer.text) {
      layer.text.x += offsetX;
      layer.text.y += offsetY;
      layer.text.bounds = undefined;
    }
    if (layer.path) {
      for (const anchor of layer.path.anchors) {
        anchor.x += offsetX;
        anchor.y += offsetY;
      }
    }
  }
  doc.width = newWidth;
  doc.height = newHeight;
  return snapshotGeometry(doc);
}

export function cropDocument(doc: PhotoDoc, rect: Rect): DocGeometrySnapshot {
  const x = Math.max(0, Math.round(rect.x));
  const y = Math.max(0, Math.round(rect.y));
  const width = Math.max(1, Math.min(Math.round(rect.w), doc.width - x));
  const height = Math.max(1, Math.min(Math.round(rect.h), doc.height - y));
  for (const layer of doc.layers) {
    // La géométrie a changé : la source chromatique décrit une autre taille.
    layer.colorSource = undefined;
    const next = createCanvas(width, height);
    const ctx = canvasContext(next);
    ctx.drawImage(layer.canvas, -x, -y);
    layer.canvas = next;
    if (layer.mask) {
      const mask = createCanvas(width, height);
      const maskCtx = canvasContext(mask);
      maskCtx.drawImage(layer.mask, -x, -y);
      layer.mask = mask;
    }
    if (layer.text) {
      layer.text.x -= x;
      layer.text.y -= y;
      layer.text.bounds = undefined;
    }
    if (layer.path) {
      for (const anchor of layer.path.anchors) {
        anchor.x -= x;
        anchor.y -= y;
      }
    }
  }
  doc.width = width;
  doc.height = height;
  return snapshotGeometry(doc);
}

export function duplicateLayer(layer: Layer): Layer {
  return {
    ...layer,
    id: uid(),
    name: `${layer.name} copie`,
    // Un calque verrouillé se duplique en calque libre : sinon la copie serait
    // immédiatement inutilisable.
    locked: false,
    canvas: (() => {
      const copy = createCanvas(layer.canvas.width, layer.canvas.height);
      const ctx = canvasContext(copy);
      ctx.drawImage(layer.canvas, 0, 0);
      return copy;
    })(),
    mask: layer.mask ? cloneMask(layer.mask) : undefined,
    text: layer.text ? deepClone(layer.text) : undefined,
    path: layer.path ? deepClone(layer.path) : undefined,
    shape: layer.shape ? deepClone(layer.shape) : undefined,
  };
}
