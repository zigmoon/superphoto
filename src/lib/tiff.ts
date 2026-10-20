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
import { ByteWriter, inflate, unpackBits } from './bytes';
import type { PhotoDoc } from './types';
import { canvasContext, createCanvas } from './utils';

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

// ─────────────────────────────────────────────────────────────────────────────
// Lecture
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Décodeur LZW du TIFF (spec TIFF 6.0, §13).
 *
 * Les codes font 9 bits au départ et grandissent d'un bit « un code trop tôt »
 * par rapport à la taille de table — c'est le fameux *early change* que
 * Photoshop et libtiff appliquent tous les deux. Sans cette règle, un TIFF LZW
 * se décode en bouillie après les 500 premiers pixels.
 */
function decodeLzw(input: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  const totalBits = input.length * 8;
  let written = 0;
  let bitPos = 0;

  const readCode = (width: number): number => {
    if (bitPos + width > totalBits) return -1;
    let value = 0;
    for (let index = 0; index < width; index += 1) {
      const position = bitPos + index;
      const bit = ((input[position >> 3] ?? 0) >> (7 - (position & 7))) & 1;
      value = (value << 1) | bit;
    }
    bitPos += width;
    return value;
  };

  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4096);
  for (let code = 0; code < 256; code += 1) {
    prefix[code] = -1;
    suffix[code] = code;
  }

  let width = 9;
  let next = 258;
  let previous = -1;

  while (written < expected) {
    const code = readCode(width);
    if (code < 0) break;
    if (code === 256) {
      width = 9;
      next = 258;
      previous = -1;
      continue;
    }
    if (code === 257) break;

    // Cas « KwKwK » : le code demandé est celui qu'on est en train de créer, il
    // vaut donc « chaîne précédente + premier caractère de celle-ci ».
    const pending = code >= next;
    if (pending && previous < 0) break;
    let current = pending ? previous : code;
    let depth = 0;
    while (current >= 0 && depth < 4096) {
      stack[depth] = suffix[current] ?? 0;
      depth += 1;
      current = prefix[current] ?? -1;
    }
    // `stack` est rempli à l'envers : la tête de chaîne est au dernier indice.
    const first = depth > 0 ? (stack[depth - 1] ?? 0) : 0;
    for (let index = depth - 1; index >= 0 && written < expected; index -= 1) {
      out[written] = stack[index] ?? 0;
      written += 1;
    }
    if (pending && written < expected) {
      out[written] = first;
      written += 1;
    }

    if (previous >= 0 && next < 4096) {
      prefix[next] = previous;
      suffix[next] = first;
      next += 1;
      // « Early change » : on élargit un code avant saturation de la table.
      if (next === (1 << width) - 1 && width < 12) width += 1;
    }
    previous = code;
  }
  return out;
}

/** Prédicteur horizontal (tag 317 = 2), utilisé avec LZW et Deflate. */
function undoPredictor(data: Uint8Array, width: number, height: number, samples: number): void {
  const stride = width * samples;
  for (let row = 0; row < height; row += 1) {
    const start = row * stride;
    for (let index = samples; index < stride; index += 1) {
      const position = start + index;
      data[position] = ((data[position] ?? 0) + (data[position - samples] ?? 0)) & 0xff;
    }
  }
}

const COMPRESSION_NONE = 1;
const COMPRESSION_LZW = 5;
const COMPRESSION_JPEG = 7;
const COMPRESSION_DEFLATE = 8;
const COMPRESSION_PACKBITS = 32773;

interface TiffDirectory {
  width: number;
  height: number;
  bits: number[];
  compression: number;
  photometric: number;
  samples: number;
  rowsPerStrip: number;
  predictor: number;
  planar: number;
  extraSamples: number[];
  stripOffsets: number[];
  stripCounts: number[];
  tileWidth: number;
  tileLength: number;
  tileOffsets: number[];
  tileCounts: number[];
  dpi: number;
}

function readEntries(
  view: DataView,
  bytes: Uint8Array,
  offset: number,
  little: boolean,
): Map<number, { type: number; count: number; offset: number }> {
  const entries = new Map<number, { type: number; count: number; offset: number }>();
  if (offset + 2 > bytes.length) return entries;
  const count = view.getUint16(offset, little);
  for (let index = 0; index < count; index += 1) {
    const position = offset + 2 + index * 12;
    if (position + 12 > bytes.length) break;
    const tag = view.getUint16(position, little);
    const type = view.getUint16(position + 2, little);
    const amount = view.getUint32(position + 4, little);
    const sizes: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
    const size = (sizes[type] ?? 1) * amount;
    // Une valeur de 4 octets ou moins est stockée dans le champ lui-même.
    const valueOffset = size <= 4 ? position + 8 : view.getUint32(position + 8, little);
    entries.set(tag, { type, count: amount, offset: valueOffset });
  }
  return entries;
}

function readValues(
  view: DataView,
  bytes: Uint8Array,
  entry: { type: number; count: number; offset: number } | undefined,
  little: boolean,
): number[] {
  if (!entry) return [];
  const sizes: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
  const size = sizes[entry.type] ?? 1;
  const values: number[] = [];
  for (let index = 0; index < entry.count; index += 1) {
    const position = entry.offset + index * size;
    if (entry.type === 5) {
      if (position + 8 > bytes.length) break;
      const numerator = view.getUint32(position, little);
      const denominator = view.getUint32(position + 4, little) || 1;
      values.push(numerator / denominator);
      continue;
    }
    if (position + size > bytes.length) break;
    if (entry.type === 3) values.push(view.getUint16(position, little));
    else if (entry.type === 4) values.push(view.getUint32(position, little));
    else if (entry.type === 8) values.push(view.getInt16(position, little));
    else if (entry.type === 9) values.push(view.getInt32(position, little));
    else values.push(bytes[position] ?? 0);
  }
  return values;
}

function readDirectory(
  view: DataView,
  bytes: Uint8Array,
  offset: number,
  little: boolean,
): TiffDirectory {
  const entries = readEntries(view, bytes, offset, little);
  const first = (tag: number): number => readValues(view, bytes, entries.get(tag), little)[0] ?? 0;
  const dpiValue = readValues(view, bytes, entries.get(282), little)[0] ?? 0;
  return {
    width: first(256),
    height: first(257),
    bits: readValues(view, bytes, entries.get(258), little),
    compression: first(259) || COMPRESSION_NONE,
    photometric: first(262),
    samples: first(277) || 1,
    rowsPerStrip: first(278) || 0,
    predictor: first(317) || 1,
    planar: first(284) || 1,
    extraSamples: readValues(view, bytes, entries.get(338), little),
    stripOffsets: readValues(view, bytes, entries.get(273), little),
    stripCounts: readValues(view, bytes, entries.get(279), little),
    tileWidth: first(322),
    tileLength: first(323),
    tileOffsets: readValues(view, bytes, entries.get(324), little),
    tileCounts: readValues(view, bytes, entries.get(325), little),
    dpi: dpiValue >= 1 && dpiValue <= 1200 ? Math.round(dpiValue) : 72,
  };
}

export interface ParsedTiff {
  canvas: HTMLCanvasElement;
  dpi: number;
}

/**
 * TIFF à compression JPEG : chaque bande (ou tuile) est un JPEG en pièces
 * détachées. Le tag 347 « JPEGTables » porte les tables de quantification et
 * de Huffman, et les bandes ne contiennent que les données d'image : il faut
 * donc recoller l'en-tête du fichier de tables devant chaque bande, faute de
 * quoi rien ne se décode. C'est la structure qu'utilisent les scanners et
 * libvips par défaut.
 */
function joinJpegTables(tables: Uint8Array, strip: Uint8Array): Uint8Array {
  const isSoi = strip.length >= 2 && strip[0] === 0xff && strip[1] === 0xd8;
  const hasTables = tables.length >= 4 && tables[0] === 0xff && tables[1] === 0xd8;
  if (!hasTables) return strip;
  // On retire l'EOI des tables et le SOI de la bande, puis on soude.
  let tableEnd = tables.length;
  if (tableEnd >= 2 && tables[tableEnd - 2] === 0xff && tables[tableEnd - 1] === 0xd9) {
    tableEnd -= 2;
  }
  const head = tables.subarray(0, tableEnd);
  const body = isSoi ? strip.subarray(2) : strip;
  const joined = new Uint8Array(head.length + body.length);
  joined.set(head, 0);
  joined.set(body, head.length);
  return joined;
}

async function decodeJpegChunks(
  bytes: Uint8Array,
  chunks: Array<{ offset: number; count: number; x: number; y: number; w: number; h: number }>,
  tables: Uint8Array,
): Promise<HTMLCanvasElement> {
  const decode = (globalThis as { createImageBitmap?: typeof createImageBitmap }).createImageBitmap;
  if (!decode) throw new Error('TIFF JPEG : décodeur JPEG indisponible dans cet environnement');
  const width = chunks.reduce((max, chunk) => Math.max(max, chunk.x + chunk.w), 0);
  const height = chunks.reduce((max, chunk) => Math.max(max, chunk.y + chunk.h), 0);
  const canvas = createCanvas(width, height);
  const ctx = canvasContext(canvas);
  for (const chunk of chunks) {
    const strip = bytes.subarray(chunk.offset, chunk.offset + chunk.count);
    const jpeg = joinJpegTables(tables, strip);
    const copy = new Uint8Array(jpeg.length);
    copy.set(jpeg);
    let bitmap: ImageBitmap;
    try {
      bitmap = await decode(new Blob([copy.buffer as ArrayBuffer], { type: 'image/jpeg' }));
    } catch {
      throw new Error('TIFF JPEG : ce JPEG intégré (CMJN ?) n’est pas décodable par le navigateur');
    }
    // Une tuile de bord est stockée en pleine taille : on ne prend que la
    // partie utile, sans rééchantillonner.
    ctx.drawImage(bitmap, 0, 0, chunk.w, chunk.h, chunk.x, chunk.y, chunk.w, chunk.h);
    bitmap.close();
  }
  return canvas;
}

/**
 * Lit un TIFF et renvoie un canvas.
 *
 * Couverture volontairement large, parce qu'un TIFF vient rarement de nous :
 * Photoshop écrit du LZW avec prédicteur, Lightroom du ZIP, un scanner du
 * PackBits ou rien du tout. On accepte donc les quatre compressions, les
 * bandes comme les tuiles, RVB / RVBA / niveaux de gris / CMJN, 8 et 16 bits.
 * Les cas non couverts (JPEG dans TIFF, palette, YCbCr) sont signalés
 * explicitement plutôt que rendus de travers.
 */
export async function parseTiff(bytes: Uint8Array): Promise<ParsedTiff> {
  if (bytes.length < 8) throw new Error('TIFF tronqué');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const order = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0);
  const little = order === 'II';
  if (!little && order !== 'MM') throw new Error('TIFF : ordre des octets inconnu');
  if (view.getUint16(2, little) !== 42) throw new Error('TIFF : en-tête invalide');

  const ifdOffset = view.getUint32(4, little);
  const entries = readEntries(view, bytes, ifdOffset, little);
  const directory = readDirectory(view, bytes, ifdOffset, little);
  const { width, height, samples, photometric } = directory;
  if (!width || !height) throw new Error('TIFF : dimensions absentes');

  const bitsPerSample = directory.bits[0] ?? 8;
  const depth = bitsPerSample > 8 ? 2 : 1;
  const hasAlpha = directory.extraSamples.length > 0 || samples === 2 || samples === 4;
  const isGray = photometric === 0 || photometric === 1;
  const isCmyk = photometric === 5;
  if (photometric === 3) throw new Error('TIFF à palette : non pris en charge');
  if (directory.planar === 2) throw new Error('TIFF à plans séparés : non pris en charge');

  const bytesPerPixel = Math.max(1, samples * depth);
  const rowBytes = width * bytesPerPixel;
  const raw = new Uint8Array(rowBytes * height);

  const isTiled =
    directory.tileOffsets.length > 0 && directory.tileWidth > 0 && directory.tileLength > 0;
  const chunks: Array<{ offset: number; count: number; x: number; y: number; w: number; h: number }> = [];
  if (isTiled) {
    const across = Math.ceil(width / directory.tileWidth);
    for (let index = 0; index < directory.tileOffsets.length; index += 1) {
      const tileX = (index % across) * directory.tileWidth;
      const tileY = Math.floor(index / across) * directory.tileLength;
      chunks.push({
        offset: directory.tileOffsets[index] ?? 0,
        count: directory.tileCounts[index] ?? 0,
        x: tileX,
        y: tileY,
        w: Math.min(directory.tileWidth, width - tileX),
        h: Math.min(directory.tileLength, height - tileY),
      });
    }
  } else {
    const perStrip = directory.rowsPerStrip || height;
    let strip = 0;
    for (let y = 0; y < height; y += perStrip) {
      chunks.push({
        offset: directory.stripOffsets[strip] ?? 0,
        count: directory.stripCounts[strip] ?? 0,
        x: 0,
        y,
        w: width,
        h: Math.min(perStrip, height - y),
      });
      strip += 1;
    }
  }

  // Une tuile de bord est toujours stockée à sa taille pleine (le reste est du
  // remplissage) : la largeur de lecture n'est donc pas la largeur utile.
  const storageWidth = isTiled ? directory.tileWidth : width;
  const storageHeight = isTiled ? directory.tileLength : directory.rowsPerStrip || height;

  if (directory.compression === COMPRESSION_JPEG) {
    // Un JPEG CMJN est décodé par le navigateur selon ses propres conventions
    // (Adobe ou non), et le résultat est faux une fois sur deux. Mieux vaut
    // refuser franchement que peindre des couleurs inversées.
    if (photometric === 5) {
      throw new Error('TIFF CMJN compressé en JPEG : réenregistrez-le en RVB ou en LZW');
    }
    const tables = new Uint8Array(readValues(view, bytes, entries.get(347), little));
    return {
      canvas: await decodeJpegChunks(bytes, chunks, tables),
      dpi: directory.dpi,
    };
  }

  for (const chunk of chunks) {
    const slice = bytes.subarray(chunk.offset, chunk.offset + chunk.count);
    const chunkRowBytes = chunk.w * bytesPerPixel;
    // La longueur attendue suit la taille de stockage, pas la taille utile.
    const expected = isTiled
      ? storageWidth * bytesPerPixel * storageHeight
      : chunkRowBytes * chunk.h;
    let decoded: Uint8Array;
    if (directory.compression === COMPRESSION_NONE) decoded = slice;
    else if (directory.compression === COMPRESSION_PACKBITS) {
      decoded = new Uint8Array(expected);
      unpackBits(slice, 0, slice.length, decoded, 0);
    } else if (directory.compression === COMPRESSION_LZW) {
      decoded = decodeLzw(slice, expected);
    } else if (directory.compression === COMPRESSION_DEFLATE) {
      decoded = await inflate(slice);
    } else {
      throw new Error(`TIFF : compression ${directory.compression} non prise en charge`);
    }

    const decodeWidth = isTiled ? storageWidth : chunk.w;
    const decodeHeight = isTiled ? storageHeight : chunk.h;
    if (directory.predictor === 2) {
      undoPredictor(decoded, decodeWidth, decodeHeight, samples);
    }

    // Recopie dans le tampon du document, ligne par ligne : ni les tuiles ni
    // les bandes ne sont contiguës dans le fichier.
    const sourceStride = decodeWidth * bytesPerPixel;
    for (let row = 0; row < chunk.h; row += 1) {
      const source = row * sourceStride;
      const target = (chunk.y + row) * rowBytes + chunk.x * bytesPerPixel;
      raw.set(decoded.subarray(source, source + chunkRowBytes), target);
    }
  }

  const canvas = createCanvas(width, height);
  const ctx = canvasContext(canvas);
  const image = ctx.createImageData(width, height);
  const data = image.data;
  const total = width * height;
  const step = depth; // 2 octets par échantillon en 16 bits
  const offsetOf = (index: number, sample: number): number =>
    index * bytesPerPixel + sample * step;
  const sample = (index: number, channel: number): number =>
    raw[offsetOf(index, channel)] ?? 0;

  for (let index = 0; index < total; index += 1) {
    const target = index * 4;
    if (isGray) {
      const value = photometric === 0 ? 255 - sample(index, 0) : sample(index, 0);
      data[target] = value;
      data[target + 1] = value;
      data[target + 2] = value;
      data[target + 3] = samples >= 2 ? sample(index, 1) : 255;
    } else if (isCmyk) {
      const k = samples >= 4 ? sample(index, 3) : 0;
      data[target] = 255 - Math.min(255, sample(index, 0) + k);
      data[target + 1] = 255 - Math.min(255, sample(index, 1) + k);
      data[target + 2] = 255 - Math.min(255, sample(index, 2) + k);
      data[target + 3] = 255;
    } else {
      data[target] = sample(index, 0);
      data[target + 1] = sample(index, 1);
      data[target + 2] = sample(index, 2);
      data[target + 3] = hasAlpha && samples >= 4 ? sample(index, 3) : 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return { canvas, dpi: directory.dpi };
}

export function looksLikeTiff(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const order = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0);
  if (order === 'II') return (bytes[2] ?? 0) === 42 && (bytes[3] ?? 0) === 0;
  if (order === 'MM') return (bytes[2] ?? 0) === 0 && (bytes[3] ?? 0) === 42;
  return false;
}

export function isTiffName(name: string): boolean {
  return /\.(tif|tiff)$/i.test(name);
}
