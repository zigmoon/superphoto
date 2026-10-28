/**
 * Format de projet SuperPhoto : `.sps`
 *
 * Un seul fichier, autonome : un manifeste JSON contenant les calques, leurs
 * masques et leurs métadonnées, avec les pixels encodés en PNG (base64). Les
 * textes et les tracés restent éditables à la réouverture.
 *
 * Aucun décodage image n'est nécessaire pour lire l'en-tête : les premières
 * octets sont du JSON, ce qui permet d'identifier un `.sps` même quand le
 * serveur FTP sert le fichier en `application/octet-stream`.
 */
import type { BlendMode, ColorMode, Layer, LayerKind, PathData, PhotoDoc, ShapeData, TextData } from './types';
import { base64ToBlob, blobToBase64, canvasContext, canvasToBlob, createCanvas } from './utils';

export const SPS_MIME = 'application/x-superphoto';
export const SPS_EXTENSION = 'sps';
export const SPS_VERSION = 1;

interface SpsLayer {
  id: string;
  name: string;
  kind: LayerKind;
  visible: boolean;
  opacity: number;
  blend: BlendMode;
  locked?: boolean;
  maskEnabled?: boolean;
  maskEditing?: boolean;
  /** Masque d'écretage (calque limité à l'alpha de celui du dessous). */
  clipToBelow?: boolean;
  text?: TextData;
  path?: PathData;
  shape?: ShapeData;
  /** PNG du calque, en base64 (sans préfixe data:). */
  image: string;
  mask?: string | null;
}

interface SpsFile {
  format: 'superphoto';
  version: number;
  app: string;
  savedAt: string;
  name: string;
  width: number;
  height: number;
  dpi: number;
  background: PhotoDoc['background'];
  /** Absent des projets enregistrés avant la 0.2.4 : RVB par défaut. */
  colorMode?: ColorMode;
  activeLayerId: string;
  layers: SpsLayer[];
}

function cloneMetadata<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export async function serializeProject(doc: PhotoDoc): Promise<Blob> {
  const layers: SpsLayer[] = [];
  for (const layer of doc.layers) {
    layers.push({
      id: layer.id,
      name: layer.name,
      kind: layer.kind,
      visible: layer.visible,
      opacity: layer.opacity,
      blend: layer.blend,
      locked: layer.locked,
      maskEnabled: layer.maskEnabled,
      maskEditing: layer.maskEditing,
      clipToBelow: layer.clipToBelow,
      text: layer.text ? cloneMetadata(layer.text) : undefined,
      path: layer.path ? cloneMetadata(layer.path) : undefined,
      shape: layer.shape ? cloneMetadata(layer.shape) : undefined,
      image: await blobToBase64(await canvasToBlob(layer.canvas, 'image/png', 1)),
      mask: layer.mask ? await blobToBase64(await canvasToBlob(layer.mask, 'image/png', 1)) : null,
    });
  }
  const file: SpsFile = {
    format: 'superphoto',
    version: SPS_VERSION,
    app: 'SuperPhoto',
    savedAt: new Date().toISOString(),
    name: doc.name,
    width: doc.width,
    height: doc.height,
    dpi: doc.dpi,
    background: doc.background,
    colorMode: doc.colorMode ?? 'rgb',
    activeLayerId: doc.activeLayerId,
    layers,
  };
  return new Blob([JSON.stringify(file)], { type: SPS_MIME });
}

export function looksLikeProject(name: string): boolean {
  return name.toLowerCase().endsWith(`.${SPS_EXTENSION}`);
}

async function base64ToCanvas(base64: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const blob = base64ToBlob(base64, 'image/png');
  const bitmap = await createImageBitmap(blob);
  const canvas = createCanvas(width, height);
  const ctx = canvasContext(canvas);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

export async function parseProject(blob: Blob): Promise<PhotoDoc> {
  let raw: SpsFile;
  try {
    raw = JSON.parse(await blob.text()) as SpsFile;
  } catch {
    throw new Error('Ce fichier n’est pas un projet SuperPhoto.');
  }
  if (!raw || raw.format !== 'superphoto' || !Array.isArray(raw.layers)) {
    throw new Error('Ce fichier n’est pas un projet SuperPhoto.');
  }
  if (raw.version > SPS_VERSION) {
    throw new Error('Ce projet a été enregistré par une version plus récente de SuperPhoto.');
  }
  const width = Math.max(1, Math.round(Number(raw.width) || 1));
  const height = Math.max(1, Math.round(Number(raw.height) || 1));
  const layers: Layer[] = [];
  for (const stored of raw.layers) {
    if (!stored?.image) continue;
    const layer: Layer = {
      id: stored.id,
      name: stored.name,
      kind: stored.kind ?? 'raster',
      visible: stored.visible !== false,
      opacity: typeof stored.opacity === 'number' ? stored.opacity : 1,
      blend: stored.blend ?? 'source-over',
      locked: Boolean(stored.locked),
      canvas: await base64ToCanvas(stored.image, width, height),
      maskEnabled: stored.maskEnabled,
      maskEditing: stored.maskEditing,
      clipToBelow: stored.clipToBelow,
      text: stored.text,
      path: stored.path,
      shape: stored.shape,
    };
    if (stored.mask) layer.mask = await base64ToCanvas(stored.mask, width, height);
    layers.push(layer);
  }
  if (layers.length === 0) throw new Error('Ce projet ne contient aucun calque.');
  return {
    name: raw.name || 'Projet',
    width,
    height,
    dpi: Number(raw.dpi) || 72,
    background: raw.background ?? 'transparent',
    colorMode: raw.colorMode ?? 'rgb',
    layers,
    activeLayerId: layers.some((layer) => layer.id === raw.activeLayerId)
      ? raw.activeLayerId
      : (layers[layers.length - 1]?.id ?? ''),
  };
}
