import type { BlendMode, Layer, LayerKind, PathData, PhotoDoc, TextData } from './types';
import { canvasContext, createCanvas } from './utils';

/**
 * Sauvegarde automatique de la session.
 *
 * Les calques sont stockés en PNG (Blob) dans IndexedDB : pas de base64, pas de
 * limite de 5 Mo comme `localStorage`, et la sérialisation passe par `toBlob`
 * qui n'immobilise pas l'interface (contrairement à `toDataURL`).
 *
 * La session contient **tous les onglets ouverts** et l'onglet actif. Les
 * sessions version 1 (un seul document) restent lisibles.
 */

const DB_NAME = 'superphoto';
const DB_VERSION = 2;
const STORE = 'sessions';
const KEY = 'current';

export interface SessionLayer {
  id: string;
  name: string;
  kind: LayerKind;
  visible: boolean;
  opacity: number;
  blend: BlendMode;
  maskEnabled: boolean;
  maskEditing: boolean;
  text?: TextData;
  path?: PathData;
  image: Blob;
  mask: Blob | null;
}

export interface SessionDocument {
  name: string;
  width: number;
  height: number;
  dpi: number;
  background: PhotoDoc['background'];
  activeLayerId: string;
  layers: SessionLayer[];
}

export interface SessionSnapshot {
  version: 2;
  savedAt: number;
  activeIndex: number;
  documents: SessionDocument[];
}

interface LegacySnapshot {
  version: 1;
  savedAt: number;
  name: string;
  width: number;
  height: number;
  dpi: number;
  background: PhotoDoc['background'];
  activeLayerId: string;
  layers: SessionLayer[];
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB indisponible'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Écriture impossible'));
    });
  } finally {
    db.close();
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Encodage PNG impossible'))),
      'image/png',
    );
  });
}

async function blobToCanvas(blob: Blob, width: number, height: number): Promise<HTMLCanvasElement> {
  const canvas = createCanvas(width, height);
  const bitmap = await createImageBitmap(blob);
  const ctx = canvasContext(canvas);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

export function isSessionAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

async function serializeDocument(doc: PhotoDoc): Promise<SessionDocument> {
  const layers: SessionLayer[] = [];
  for (const layer of doc.layers) {
    layers.push({
      id: layer.id,
      name: layer.name,
      kind: layer.kind,
      visible: layer.visible,
      opacity: layer.opacity,
      blend: layer.blend,
      maskEnabled: layer.maskEnabled !== false,
      maskEditing: Boolean(layer.maskEditing),
      text: layer.text ? JSON.parse(JSON.stringify(layer.text)) as TextData : undefined,
      path: layer.path ? JSON.parse(JSON.stringify(layer.path)) as PathData : undefined,
      image: await canvasToBlob(layer.canvas),
      mask: layer.mask ? await canvasToBlob(layer.mask) : null,
    });
  }
  return {
    name: doc.name,
    width: doc.width,
    height: doc.height,
    dpi: doc.dpi,
    background: doc.background,
    activeLayerId: doc.activeLayerId,
    layers,
  };
}

export async function saveSession(docs: PhotoDoc[], activeIndex = 0): Promise<SessionSnapshot> {
  const documents: SessionDocument[] = [];
  for (const doc of docs) documents.push(await serializeDocument(doc));
  const snapshot: SessionSnapshot = {
    version: 2,
    savedAt: Date.now(),
    activeIndex: Math.min(Math.max(0, activeIndex), Math.max(0, documents.length - 1)),
    documents,
  };
  await withStore('readwrite', (store) => store.put(snapshot, KEY));
  return snapshot;
}

function upgrade(raw: SessionSnapshot | LegacySnapshot | undefined): SessionSnapshot | null {
  if (!raw) return null;
  const modern = raw as SessionSnapshot;
  if (modern.version === 2 && Array.isArray(modern.documents)) {
    if (modern.documents.length === 0) return null;
    return {
      ...modern,
      activeIndex: Math.min(Math.max(0, modern.activeIndex ?? 0), modern.documents.length - 1),
    };
  }
  const legacy = raw as LegacySnapshot;
  if (!Array.isArray(legacy.layers) || legacy.layers.length === 0) return null;
  return {
    version: 2,
    savedAt: legacy.savedAt ?? Date.now(),
    activeIndex: 0,
    documents: [
      {
        name: legacy.name,
        width: legacy.width,
        height: legacy.height,
        dpi: legacy.dpi,
        background: legacy.background,
        activeLayerId: legacy.activeLayerId,
        layers: legacy.layers,
      },
    ],
  };
}

export async function loadSession(): Promise<SessionSnapshot | null> {
  if (!isSessionAvailable()) return null;
  try {
    const stored = await withStore<SessionSnapshot | LegacySnapshot | undefined>('readonly', (store) =>
      store.get(KEY),
    );
    return upgrade(stored);
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  if (!isSessionAvailable()) return;
  try {
    await withStore('readwrite', (store) => store.delete(KEY));
  } catch {
    /* Rien à effacer, ou stockage refusé : la session suivante réécrira. */
  }
}

export async function restoreDocument(snapshot: SessionDocument): Promise<PhotoDoc> {
  const layers: Layer[] = [];
  for (const stored of snapshot.layers) {
    const canvas = await blobToCanvas(stored.image, snapshot.width, snapshot.height);
    const layer: Layer = {
      id: stored.id,
      name: stored.name,
      kind: stored.kind,
      visible: stored.visible,
      opacity: stored.opacity,
      blend: stored.blend,
      canvas,
      maskEnabled: stored.maskEnabled,
      maskEditing: stored.maskEditing,
      text: stored.text,
      path: stored.path,
    };
    if (stored.mask) layer.mask = await blobToCanvas(stored.mask, snapshot.width, snapshot.height);
    layers.push(layer);
  }
  if (layers.length === 0) throw new Error('Session vide');
  return {
    name: snapshot.name,
    width: snapshot.width,
    height: snapshot.height,
    dpi: snapshot.dpi,
    background: snapshot.background,
    layers,
    activeLayerId: layers.some((layer) => layer.id === snapshot.activeLayerId)
      ? snapshot.activeLayerId
      : (layers[layers.length - 1]?.id ?? ''),
  };
}

export function formatSessionTime(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}
