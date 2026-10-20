import { OPEN_ACCEPT, VIDEO_EXTENSIONS } from './media';
import { SPP_EXTENSION, SPP_MIME } from './package';
import { SPS_MIME } from './project';
import { PSD_MIME } from './psd';
import { TIFF_MIME } from './tiff';
import { EPS_MIME } from './eps';
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

export function mimeFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    png: 'image/png',
    apng: 'image/apng',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    jpe: 'image/jpeg',
    jfif: 'image/jpeg',
    webp: 'image/webp',
    avif: 'image/avif',
    gif: 'image/gif',
    bmp: 'image/bmp',
    dib: 'image/bmp',
    tif: 'image/tiff',
    tiff: 'image/tiff',
    svg: 'image/svg+xml',
    svgz: 'image/svg+xml',
    ico: 'image/x-icon',
    cur: 'image/x-icon',
    heic: 'image/heic',
    heif: 'image/heif',
    jxl: 'image/jxl',
    jp2: 'image/jp2',
    tga: 'image/x-tga',
    exr: 'image/x-exr',
    hdr: 'image/vnd.radiance',
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    ogv: 'video/ogg',
    mkv: 'video/x-matroska',
    avi: 'video/x-msvideo',
    sps: SPS_MIME,
    spp: SPP_MIME,
    zip: SPP_MIME,
    psd: PSD_MIME,
    psb: PSD_MIME,
    eps: EPS_MIME,
    ps: EPS_MIME,
  };
  return map[ext] ?? 'application/octet-stream';
}

async function pickWithBrowser(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => finish([...(input.files ?? [])]));
    input.addEventListener('cancel', () => finish([]));
    window.addEventListener(
      'focus',
      () => {
        window.setTimeout(() => {
          if (!input.files || input.files.length === 0) finish([]);
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
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  const mime = payload.mime && payload.mime !== 'application/octet-stream'
    ? payload.mime
    : mimeFromName(path);
  // Un `.sps` est du JSON : on garde le type applicatif pour que l'ouverture
  // sache qu'il faut lire un projet et non une image.
  const type = extension === 'sps' ? SPS_MIME : extension === SPP_EXTENSION || extension === 'zip' ? SPP_MIME : mime;
  return {
    name: payload.name,
    blob: base64ToBlob(payload.dataBase64, type),
  };
}

/** Ouvre un ou plusieurs fichiers (images, vidéos, projets `.sps`). */
export async function openImages(): Promise<OpenedImage[]> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      multiple: true,
      directory: false,
      title: 'Ouvrir dans SuperPhoto',
      filters: [
        {
          name: 'Images et projets',
          extensions: [
            'png', 'jpg', 'jpeg', 'jpe', 'jfif', 'webp', 'avif', 'gif', 'bmp', 'dib',
            'tif', 'tiff', 'svg', 'svgz', 'ico', 'cur', 'heic', 'heif', 'jxl', 'jp2',
            'psd', 'psb', 'eps', 'ps',
            'mp4', 'm4v', 'webm', 'mov', 'ogv', 'mkv', 'avi', 'sps', 'spp', 'zip',
          ],
        },
        { name: 'Tous les fichiers', extensions: ['*'] },
      ],
    });
    const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
    const opened: OpenedImage[] = [];
    for (const path of paths) opened.push(await readNativeImage(path));
    return opened;
  }

  const files = await pickWithBrowser(OPEN_ACCEPT, true);
  const opened: OpenedImage[] = [];
  for (const file of files) {
    // Un fichier glissé depuis le bureau peut arriver sans type MIME (HEIC,
    // TIFF, `.sps`) : on le déduit de l'extension.
    opened.push(
      file.type
        ? { name: file.name, blob: file }
        : { name: file.name, blob: new Blob([await file.arrayBuffer()], { type: mimeFromName(file.name) }) },
    );
  }
  return opened;
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
      (mime === 'image/jpeg'
        ? 'jpg'
        : mime === 'image/webp'
          ? 'webp'
          : mime === SPS_MIME
            ? 'sps'
            : mime === SPP_MIME
              ? SPP_EXTENSION
              : mime === PSD_MIME
                ? 'psd'
                : mime === TIFF_MIME
                  ? 'tiff'
                  : mime === EPS_MIME
                    ? 'eps'
                    : 'png');
    const target = await save({
      title: 'Enregistrer depuis SuperPhoto',
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
  if (mime === 'image/avif') return 'avif';
  if (mime === 'image/bmp') return 'bmp';
  if (mime === SPS_MIME) return 'sps';
  if (mime === SPP_MIME) return SPP_EXTENSION;
  if (mime === PSD_MIME) return 'psd';
  if (mime === TIFF_MIME) return 'tiff';
  if (mime === EPS_MIME) return 'eps';
  return 'png';
}

export type ExportMime =
  | 'png'
  | 'jpeg'
  | 'webp'
  | 'avif'
  | 'bmp'
  | 'sps'
  | 'spp'
  | 'psd'
  | 'tiff'
  | 'eps';

export function mimeForFormat(format: ExportMime): string {
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'webp') return 'image/webp';
  if (format === 'avif') return 'image/avif';
  if (format === 'bmp') return 'image/bmp';
  if (format === 'sps') return SPS_MIME;
  if (format === 'spp') return SPP_MIME;
  if (format === 'psd') return PSD_MIME;
  if (format === 'tiff') return TIFF_MIME;
  if (format === 'eps') return EPS_MIME;
  return 'image/png';
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'superphoto';
}

/**
 * Tous les navigateurs ne savent pas **encoder** l'AVIF : `toBlob` retombe
 * alors silencieusement sur du PNG, ce qui produirait un fichier `.avif` qui
 * n'en est pas un. On sonde donc une fois, et l'interface masque le format
 * quand il n'est pas réellement disponible.
 */
let avifSupport: boolean | null = null;

export async function supportsAvifExport(): Promise<boolean> {
  if (avifSupport !== null) return avifSupport;
  if (typeof document === 'undefined') return false;
  const probe = document.createElement('canvas');
  probe.width = 2;
  probe.height = 2;
  const blob = await new Promise<Blob | null>((resolve) => {
    probe.toBlob((value) => resolve(value), 'image/avif', 0.8);
  });
  avifSupport = Boolean(blob && blob.type === 'image/avif');
  return avifSupport;
}

export { VIDEO_EXTENSIONS };
