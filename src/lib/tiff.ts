/**
 * TIFF — écriture (et lecture minimale du fond).
 *
 * TIFF est le format d'échange des imprimeurs et des retoucheurs : il accepte
 * les calques (pas ici), la transparence, la résolution et plusieurs méthodes de
 * compression. On écrit un TIFF **baseline non compressé**, celui que lisent
 * sans exception Photoshop, Lightroom, Capture One, GIMP, macOS et Windows :
 *
 *   • bandes uniques (RowsPerStrip = hauteur), plan entrelacé ;
 *   • RVB 8 bits, avec un canal alpha si le document en a un ;
 *   • niveaux de gris 8 bits si le document est en N&B ;
 *   • résolution X/Y en points par pouce, unité « pouce ».
 *
 * Le fichier reste lisible parce que chaque valeur est décrite par son tag :
 * aucune dépendance, aucune bibliothèque, et un octet de plus = un tag lu.
 */
import { ByteWriter } from './bytes';
import type { PhotoDoc } from './types';
import { canvasContext } from './utils';

export const TIFF_MIME = 'image/tiff';

interface Tag {
  id: number;
  type: number;
  count: number;
  /** Valeur directe (tient sur 4 octets) ou octets à écrire ailleurs. */
  value: number;
  bytes?: Uint8Array;
}

const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;

export interface TiffOptions {
  /** Résolution en points par pouce. */
  dpi: number;
  /** Forcer la présence d'un canal alpha. */
  alpha: boolean;
  /** Niveaux de gris au lieu de RVB. */
  grayscale: boolean;
}

/** Aplatit le document et renvoie les échantillons entrelacés demandés. */
export function tiffPixels(
  canvas: HTMLCanvasElement,
  { alpha, grayscale }: Pick<TiffOptions, 'alpha' | 'grayscale'>,
): { data: Uint8Array; samples: number; photometric: number } {
  const ctx = canvasContext(canvas);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const source = image.data;
  const count = canvas.width * canvas.height;

  if (grayscale) {
    // Luminance Rec. 709 : identique au mode N&B de l'éditeur.
    const out = new Uint8Array(count * (alpha ? 2 : 1));
    for (let index = 0; index < count; index += 1) {
      const r = source[index * 4] ?? 0;
      const g = source[index * 4 + 1] ?? 0;
      const b = source[index * 4 + 2] ?? 0;
      const value = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
      out[index * (alpha ? 2 : 1)] = value;
      if (alpha) out[index * 2 + 1] = source[index * 4 + 3] ?? 255;
    }
    return { data: out, samples: alpha ? 2 : 1, photometric: 1 };
  }

  const samples = alpha ? 4 : 3;
  const out = new Uint8Array(count * samples);
  for (let index = 0; index < count; index += 1) {
    out[index * samples] = source[index * 4] ?? 0;
    out[index * samples + 1] = source[index * 4 + 1] ?? 0;
    out[index * samples + 2] = source[index * 4 + 2] ?? 0;
    if (alpha) out[index * samples + 3] = source[index * 4 + 3] ?? 255;
  }
  return { data: out, samples, photometric: 2 };
}

function rational(value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, Math.round(value * 100) >>> 0, true);
  view.setUint32(4, 100, true);
  return bytes;
}

/** Écrit un TIFF baseline non compressé depuis un canvas déjà composé. */
export function encodeTiff(
  canvas: HTMLCanvasElement,
  { dpi, alpha, grayscale }: TiffOptions,
): Blob {
  const width = canvas.width;
  const height = canvas.height;
  const { data, samples, photometric } = tiffPixels(canvas, { alpha, grayscale });
  const hasAlpha = samples === 4 || (grayscale && samples === 2);

  // Champs annexes stockés juste après les pixels.
  const bitsPerSample = new Uint8Array(samples * 2);
  const bitsView = new DataView(bitsPerSample.buffer);
  for (let index = 0; index < samples; index += 1) bitsView.setUint16(index * 2, 8, true);

  const xResolution = rational(dpi);
  const yResolution = rational(dpi);

  const tags: Tag[] = [
    { id: 256, type: TYPE_LONG, count: 1, value: width }, // ImageWidth
    { id: 257, type: TYPE_LONG, count: 1, value: height }, // ImageLength
    { id: 258, type: TYPE_SHORT, count: samples, value: 0, bytes: bitsPerSample },
    { id: 259, type: TYPE_SHORT, count: 1, value: 1 }, // Compression = none
    { id: 262, type: TYPE_SHORT, count: 1, value: photometric },
    { id: 273, type: TYPE_LONG, count: 1, value: 0 }, // StripOffsets (corrigé plus bas)
    { id: 277, type: TYPE_SHORT, count: 1, value: samples },
    { id: 278, type: TYPE_LONG, count: 1, value: height }, // RowsPerStrip
    { id: 279, type: TYPE_LONG, count: 1, value: data.length }, // StripByteCounts
    { id: 282, type: TYPE_RATIONAL, count: 1, value: 0, bytes: xResolution },
    { id: 283, type: TYPE_RATIONAL, count: 1, value: 0, bytes: yResolution },
    { id: 284, type: TYPE_SHORT, count: 1, value: 1 }, // PlanarConfiguration = chunky
    { id: 296, type: TYPE_SHORT, count: 1, value: 2 }, // ResolutionUnit = inch
  ];
  if (hasAlpha) {
    // 1 = donnée associée (prémultipliée), 2 = non associée : nos canvas sont
    // non prémultipliés, donc 2, sinon les bords se retrouvent assombris.
    tags.push({ id: 338, type: TYPE_SHORT, count: 1, value: 2 });
    tags.push({ id: 339, type: TYPE_SHORT, count: samples, value: 0, bytes: (() => {
      const sampleFormat = new Uint8Array(samples * 2);
      const view = new DataView(sampleFormat.buffer);
      for (let index = 0; index < samples; index += 1) view.setUint16(index * 2, 1, true);
      return sampleFormat;
    })() });
  }
  tags.sort((a, b) => a.id - b.id);

  const headerSize = 8;
  const ifdSize = 2 + tags.length * 12 + 4;
  const extraStart = headerSize + ifdSize;

  // Les valeurs qui ne tiennent pas sur 4 octets sont écrites à la suite de l'IFD.
  let extraOffset = extraStart;
  const extra = new ByteWriter(256);
  for (const tag of tags) {
    if (!tag.bytes) continue;
    tag.value = extraOffset;
    extra.bytes(tag.bytes);
    if (tag.bytes.length % 2 === 1) extra.u8(0);
    extraOffset += tag.bytes.length + (tag.bytes.length % 2);
  }

  const pixelOffset = extraStart + extra.size;
  const stripTag = tags.find((tag) => tag.id === 273);
  if (stripTag) stripTag.value = pixelOffset;

  const writer = new ByteWriter(pixelOffset + data.length);
  writer.ascii('II'); // little-endian
  writer.u16(42, true);
  writer.u32(headerSize, true);

  writer.u16(tags.length, true);
  for (const tag of tags) {
    writer.u16(tag.id, true);
    writer.u16(tag.type, true);
    writer.u32(tag.count, true);
    if (tag.bytes) {
      writer.u32(tag.value, true);
      continue;
    }
    // Les SHORT tiennent deux par 4 octets : on écrit la valeur puis un zéro.
    if (tag.type === TYPE_SHORT) {
      writer.u16(tag.value, true).u16(0, true);
    } else {
      writer.u32(tag.value, true);
    }
  }
  writer.u32(0, true); // pas d'IFD suivante

  writer.bytes(extra.toUint8Array());
  writer.bytes(data);

  return writer.toBlob(TIFF_MIME);
}

/** TIFF depuis un document (calques fusionnés, fond blanc si demandé). */
export function tiffFromDocument(doc: PhotoDoc, canvas: HTMLCanvasElement): Blob {
  const grayscale = doc.colorMode === 'gray';
  const alpha = doc.background === 'transparent' && !grayscale;
  return encodeTiff(canvas, {
    dpi: doc.dpi,
    alpha,
    grayscale,
  });
}
