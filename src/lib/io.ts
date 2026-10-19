import { blobToBase64, base64ToBlob, downloadBlob } from './utils';

export interface OpenedImage {
  name: string;
  blob: Blob;
}

interface NativeFilePayload {
  name: string;
  mime: string;
  dataBase64: string;
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

function mimeFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    bmp: 'image/bmp',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    svg: 'image/svg+xml',
  };
  return map[ext] ?? 'application/octet-stream';
}

async function pickWithBrowser(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => finish(null));
    window.addEventListener(
      'focus',
      () => {
        window.setTimeout(() => {
          if (!input.files || input.files.length === 0) finish(null);
        }, 700);
      },
      { once: true },
    );
    document.body.appendChild(input);
    input.click();
  });
}

export async function readNativeImage(path: string): Promise<OpenedImage> {
  const { invoke } = await import('@tauri-apps/api/core');
  const payload = await invoke<NativeFilePayload>('read_image_file', { path });
  return {
    name: payload.name,
    blob: base64ToBlob(payload.dataBase64, payload.mime),
  };
}

export async function openImage(): Promise<OpenedImage | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      multiple: false,
      directory: false,
      title: 'Ouvrir une image dans SuperPhoto',
      filters: [
        {
          name: 'Images',
          extensions: ['png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'bmp', 'gif'],
        },
      ],
    });
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (!path) return null;
    return readNativeImage(path);
  }

  const file = await pickWithBrowser('image/*');
  if (!file) return null;
  return { name: file.name, blob: file };
}

export async function saveExport(
  blob: Blob,
  filename: string,
  mime: string,
): Promise<boolean> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { invoke } = await import('@tauri-apps/api/core');
    const extension = filename.split('.').pop() ??
      (mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png');
    const target = await save({
      title: 'Exporter depuis SuperPhoto',
      defaultPath: filename,
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });
    if (!target) return false;
    const data = await blobToBase64(blob);
    await invoke('write_export_file', { path: target, dataBase64: data });
    return true;
  }

  downloadBlob(blob, filename);
  return true;
}

export function extensionForMime(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  return 'png';
}

export function mimeForFormat(format: 'png' | 'jpeg' | 'webp'): string {
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'webp') return 'image/webp';
  return 'image/png';
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'superphoto';
}

export { mimeFromName };
