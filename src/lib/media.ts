/**
 * Décodage des médias ouverts par glisser-déposer ou par la boîte de dialogue.
 *
 * Tous les formats que le moteur graphique de la plateforme sait décoder sont
 * acceptés (PNG, JPEG, WebP, AVIF, GIF — première image —, BMP, ICO, SVG), plus
 * les cas particuliers :
 *   • SVG : `createImageBitmap` refuse parfois un SVG, on passe par `<img>` ;
 *   • vidéo (MP4, WebM, MOV…) : on dessine la première image décodable ;
 *   • HEIC/HEIF : le décodeur système peut répondre, sinon on explique.
 */
import { looksLikeTiff, parseTiff, TIFF_MIME } from './tiff';

export const IMAGE_EXTENSIONS = [
  'png', 'jpg', 'jpeg', 'jpe', 'jfif', 'webp', 'avif', 'gif', 'bmp', 'dib',
  'tif', 'tiff', 'svg', 'svgz', 'ico', 'cur', 'heic', 'heif', 'jxl', 'jp2',
  'j2k', 'pnm', 'pbm', 'pgm', 'ppm', 'tga', 'dds', 'exr', 'hdr',
  'psd', 'psb',
];

export const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'webm', 'mov', 'ogv', 'mkv', 'avi'];

/** Projets : `.sps` (document seul) et `.spp` (paquet, archive ZIP). */
export const PROJECT_EXTENSIONS = ['sps', 'spp', 'zip'];

export const OPEN_ACCEPT = [
  'image/*',
  'image/vnd.adobe.photoshop',
  'application/zip',
  ...IMAGE_EXTENSIONS.map((extension) => `.${extension}`),
  ...VIDEO_EXTENSIONS.map((extension) => `.${extension}`),
  ...PROJECT_EXTENSIONS.map((extension) => `.${extension}`),
].join(',');

function extensionOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

export function isVideoFile(file: { name: string; type?: string }): boolean {
  if (file.type?.startsWith('video/')) return true;
  return VIDEO_EXTENSIONS.includes(extensionOf(file.name));
}

export function isSupportedMedia(file: { name: string; type?: string }): boolean {
  if (file.type?.startsWith('image/') || file.type?.startsWith('video/')) return true;
  const extension = extensionOf(file.name);
  return IMAGE_EXTENSIONS.includes(extension) || VIDEO_EXTENSIONS.includes(extension);
}

export interface DecodedMedia {
  width: number;
  height: number;
  /** Résolution déclarée par le fichier, quand il en porte une. */
  dpi?: number;
  /** Dessine le média dans un contexte 2D, à la taille demandée. */
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
  /** Libère les ressources (Bitmap, ImageBitmap, URL temporaire…). */
  release: () => void;
}

async function decodeWithImageElement(blob: Blob): Promise<DecodedMedia> {
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  try {
    await image.decode();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  return {
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
    draw: (ctx, width, height) => ctx.drawImage(image, 0, 0, width, height),
    release: () => URL.revokeObjectURL(url),
  };
}

async function decodeWithBitmap(blob: Blob): Promise<DecodedMedia> {
  const bitmap = await createImageBitmap(blob);
  return {
    width: bitmap.width,
    height: bitmap.height,
    draw: (ctx, width, height) => ctx.drawImage(bitmap, 0, 0, width, height),
    release: () => bitmap.close(),
  };
}

async function decodeVideo(blob: Blob): Promise<DecodedMedia> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('Vidéo trop lente à décoder')), 15000);
      const done = (): void => {
        window.clearTimeout(timer);
        resolve();
      };
      video.addEventListener('loadeddata', done, { once: true });
      video.addEventListener('error', () => {
        window.clearTimeout(timer);
        reject(new Error('Vidéo illisible'));
      }, { once: true });
      video.load();
    });
    // Certains conteneurs n'exposent la première image qu'après un petit saut.
    if (video.readyState < 2) {
      await new Promise<void>((resolve) => {
        video.addEventListener('loadeddata', () => resolve(), { once: true });
        video.currentTime = 0.05;
      });
    }
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) {
    URL.revokeObjectURL(url);
    throw new Error('Vidéo sans image exploitable');
  }
  return {
    width,
    height,
    draw: (ctx, targetWidth, targetHeight) => ctx.drawImage(video, 0, 0, targetWidth, targetHeight),
    release: () => {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    },
  };
}

/**
 * Un TIFF n'est décodé par aucun navigateur : on le lit nous-mêmes. Le format
 * revient souvent dans un atelier (scan, appareil, export d'un confrère), donc
 * l'ouverture doit marcher pour de vrai, LZW et prédicteur compris.
 */
async function decodeTiffBlob(blob: Blob): Promise<DecodedMedia> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const { canvas, dpi } = await parseTiff(bytes);
  return {
    width: canvas.width,
    height: canvas.height,
    dpi,
    draw: (ctx, width, height) => ctx.drawImage(canvas, 0, 0, width, height),
    release: () => {},
  };
}

async function sniffTiff(blob: Blob): Promise<boolean> {
  if (blob.size < 4) return false;
  return looksLikeTiff(new Uint8Array(await blob.slice(0, 4).arrayBuffer()));
}

/**
 * Décode un média. `name` sert à choisir la bonne stratégie : le type MIME
 * fourni par le système de fichiers est souvent vide pour HEIC ou TIFF.
 */
export async function decodeMedia(blob: Blob, name: string): Promise<DecodedMedia> {
  if (isVideoFile({ name, type: blob.type })) return decodeVideo(blob);

  const extension = extensionOf(name);
  if (extension === 'svg' || extension === 'svgz' || blob.type === 'image/svg+xml') {
    return decodeWithImageElement(blob);
  }
  if (extension === 'tif' || extension === 'tiff' || blob.type === TIFF_MIME) {
    return decodeTiffBlob(blob);
  }

  try {
    return await decodeWithBitmap(blob);
  } catch (error) {
    // Repli : `<img>` couvre l'ICO, certains SVG et les codecs natifs que
    // `createImageBitmap` n'expose pas (HEIC sur Safari, par exemple).
    try {
      return await decodeWithImageElement(blob);
    } catch {
      // Dernier filet : un TIFF renommé, ou livré sans extension.
      if (await sniffTiff(blob)) return decodeTiffBlob(blob);
      throw error;
    }
  }
}
