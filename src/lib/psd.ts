/**
 * PSD — lecture (import) et écriture (export).
 *
 * Le format est documenté par Adobe (« Photoshop File Format ») : un en-tête,
 * trois sections (données de mode couleur, ressources, calques et masques) puis
 * l'image fusionnée. Chaque calque stocke ses pixels par canal, compressés en
 * RLE (PackBits) le plus souvent, parfois en ZIP ou sans compression.
 *
 * Ce que l'on relit :
 *   • tous les calques de pixels, 8 et 16 bits, RVB / CMJN / niveaux de gris ;
 *   • opacité, modes de fusion, visibilité, noms Unicode, verrouillage ;
 *   • masques de fusion (canaux -2 / -3), y compris désactivés, inversés ou
 *     sans rectangle déclaré ;
 *   • masques d'écretage (drapeau de clipping du calque) ;
 *   • les groupes sont dépliés — un dossier devient ses calques, dans l'ordre.
 *
 * Ce que l'on écrit : un PSD conforme, calques RVB 8 bits compressés en RLE,
 * masques et écretages inclus, plus l'image fusionnée en fin de fichier (celle
 * que lisent les visionneuses et les systèmes d'exploitation).
 */
import { ByteWriter, inflate, packBits, planarChannels, unpackBits } from './bytes';
import { t } from './i18n';
import type { BlendMode, ColorMode, Layer, PhotoDoc } from './types';
import { canvasContext, createCanvas } from './utils';

export const PSD_MIME = 'image/vnd.adobe.photoshop';

/** Signature et version acceptées. */
const SIGNATURE = 0x38425053; // '8BPS'

/** Modes couleur PSD. */
const PSD_COLOR_MODE = { bitmap: 0, gray: 1, indexed: 2, rgb: 3, cmyk: 4, multichannel: 7, duotone: 8, lab: 9 } as const;

/** Clé de fusion PSD → mode canvas. */
const PSD_TO_BLEND: Record<string, BlendMode> = {
  norm: 'source-over',
  pass: 'source-over',
  mul: 'multiply',
  scrn: 'screen',
  over: 'overlay',
  dark: 'darken',
  lite: 'lighten',
  hLit: 'hard-light',
  sLit: 'soft-light',
  diff: 'difference',
  smud: 'exclusion',
  div: 'color-dodge',
  idiv: 'color-burn',
  hue: 'hue',
  sat: 'saturation',
  colr: 'color',
  lum: 'luminosity',
};

/**
 * Mode canvas → clé de fusion PSD.
 *
 * Les clés font **quatre caractères**, complétées par une espace quand
 * Photoshop en utilise moins (`mul `, `div `, `hue `…) : une clé de trois
 * caractères décalerait tout l'enregistrement du calque d'un octet.
 */
const BLEND_TO_PSD: Record<BlendMode, string> = {
  'source-over': 'norm',
  multiply: 'mul ',
  screen: 'scrn',
  overlay: 'over',
  darken: 'dark',
  lighten: 'lite',
  'color-dodge': 'div ',
  'color-burn': 'idiv',
  'hard-light': 'hLit',
  'soft-light': 'sLit',
  difference: 'diff',
  exclusion: 'smud',
  hue: 'hue ',
  saturation: 'sat ',
  color: 'colr',
  luminosity: 'lum ',
};

class Reader {
  private readonly view: DataView;
  offset = 0;

  constructor(
    private readonly bytes: Uint8Array,
    start = 0,
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = start;
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  u8(): number {
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  u16(): number {
    const value = this.view.getUint16(this.offset, false);
    this.offset += 2;
    return value;
  }

  i16(): number {
    const value = this.view.getInt16(this.offset, false);
    this.offset += 2;
    return value;
  }

  u32(): number {
    const value = this.view.getUint32(this.offset, false);
    this.offset += 4;
    return value;
  }

  i32(): number {
    const value = this.view.getInt32(this.offset, false);
    this.offset += 4;
    return value;
  }

  ascii(length: number): string {
    let text = '';
    for (let index = 0; index < length; index += 1) text += String.fromCharCode(this.u8());
    return text;
  }

  skip(length: number): void {
    this.offset += length;
  }

  sub(length: number): Uint8Array {
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }
}

interface PsdChannel {
  id: number;
  length: number;
}

interface PsdLayerRecord {
  name: string;
  top: number;
  left: number;
  bottom: number;
  right: number;
  channels: PsdChannel[];
  opacity: number;
  blend: BlendMode;
  visible: boolean;
  locked: boolean;
  /** Masque d'écretage : le calque est limité à l'alpha de celui du dessous. */
  clipping: boolean;
  maskRect: { top: number; left: number; bottom: number; right: number } | null;
  /** Le bloc masque existe, même si son rectangle est vide (masque plein calque). */
  hasMaskData: boolean;
  /** Drapeaux Photoshop du masque : bit 1 = désactivé, bit 2 = inversé. */
  maskFlags: number;
  sectionType: number;
}

function decodeRow(
  data: Uint8Array,
  start: number,
  end: number,
  rowBytes: number,
  depth: number,
  prediction: boolean,
  target: Uint8Array,
  offset: number,
): void {
  unpackBits(data, start, end, target, offset);
  if (!prediction) return;
  // ZIP avec prédiction : chaque octet est un delta du précédent.
  for (let index = 1; index < rowBytes; index += 1) {
    target[offset + index] = ((target[offset + index] ?? 0) + (target[offset + index - 1] ?? 0)) & 0xff;
  }
  void depth;
}

async function readChannel(
  data: Uint8Array,
  width: number,
  height: number,
  depth: number,
): Promise<Uint8Array> {
  const reader = new Reader(data);
  const compression = reader.u16();
  const bytesPerSample = depth === 16 ? 2 : 1;
  const rowBytes = width * bytesPerSample;
  const raw = new Uint8Array(rowBytes * height);

  if (compression === 0) {
    raw.set(data.subarray(2, 2 + Math.min(raw.length, data.length - 2)));
  } else if (compression === 1) {
    const counts: number[] = [];
    for (let row = 0; row < height; row += 1) counts.push(reader.u16());
    let cursor = reader.offset;
    for (let row = 0; row < height; row += 1) {
      const count = counts[row] ?? 0;
      decodeRow(data, cursor, cursor + count, rowBytes, depth, false, raw, row * rowBytes);
      cursor += count;
    }
  } else if (compression === 2 || compression === 3) {
    const inflated = await inflate(data.subarray(2));
    if (compression === 2) {
      raw.set(inflated.subarray(0, Math.min(raw.length, inflated.length)));
    } else {
      // Prédiction : le premier échantillon est brut, les suivants sont des deltas.
      let source = 0;
      for (let row = 0; row < height; row += 1) {
        const target = row * rowBytes;
        for (let index = 0; index < rowBytes; index += 1) {
          const value = inflated[source] ?? 0;
          source += 1;
          raw[target + index] = index < bytesPerSample
            ? value
            : ((value + (raw[target + index - bytesPerSample] ?? 0)) & 0xff);
        }
      }
    }
  } else {
    throw new Error(`Compression PSD ${compression} non prise en charge.`);
  }

  if (depth === 16) {
    // 16 bits → 8 bits : on garde l'octet fort, comme un arrondi de dynamique.
    const narrow = new Uint8Array(width * height);
    for (let index = 0; index < narrow.length; index += 1) narrow[index] = raw[index * 2] ?? 0;
    return narrow;
  }
  return raw;
}

function readPascalName(reader: Reader): string {
  const length = reader.u8();
  let text = '';
  for (let index = 0; index < length; index += 1) text += String.fromCharCode(reader.u8());
  // Les noms sont bourrés pour que la structure retombe sur un multiple de 4.
  const padding = (4 - ((length + 1) % 4)) % 4;
  reader.skip(padding);
  return text;
}

function readUnicodeName(data: Uint8Array): string {
  const reader = new Reader(data);
  const count = reader.u32();
  let text = '';
  for (let index = 0; index < count; index += 1) text += String.fromCharCode(reader.u16());
  return text.replace(/\u0000/g, '');
}

function parseLayerRecord(reader: Reader): PsdLayerRecord {
  const top = reader.i32();
  const left = reader.i32();
  const bottom = reader.i32();
  const right = reader.i32();
  const channelCount = reader.u16();
  const channels: PsdChannel[] = [];
  for (let index = 0; index < channelCount; index += 1) {
    channels.push({ id: reader.i16(), length: reader.u32() });
  }
  const blendSignature = reader.ascii(4);
  if (blendSignature !== '8BIM') {
    throw new Error('Enregistrement de calque PSD invalide.');
  }
  const blendKey = reader.ascii(4);
  const opacity = reader.u8();
  const clipping = reader.u8() === 1;
  const flags = reader.u8();
  reader.u8(); // filler
  const extraLength = reader.u32();
  const extraEnd = reader.offset + extraLength;

  let maskRect: PsdLayerRecord['maskRect'] = null;
  let maskFlags = 0;
  const maskLength = reader.u32();
  const hasMaskData = maskLength > 0;
  if (hasMaskData) {
    const maskTop = reader.i32();
    const maskLeft = reader.i32();
    const maskBottom = reader.i32();
    const maskRight = reader.i32();
    reader.u8(); // couleur par défaut
    maskFlags = reader.u8();
    if (maskLength > 18) reader.skip(maskLength - 18);
    // Un rectangle nul signifie « le masque couvre tout le calque » : on
    // laissera l'import choisir la bonne taille plutôt que de perdre le masque.
    if (maskBottom > maskTop && maskRight > maskLeft) {
      maskRect = { top: maskTop, left: maskLeft, bottom: maskBottom, right: maskRight };
    }
  }
  const blendingLength = reader.u32();
  reader.skip(blendingLength);

  let name = readPascalName(reader);
  let sectionType = 0;

  while (reader.offset + 12 <= extraEnd) {
    const blockSignature = reader.ascii(4);
    if (blockSignature !== '8BIM' && blockSignature !== '8B64') break;
    const key = reader.ascii(4);
    const length = reader.u32();
    const start = reader.offset;
    if (key === 'luni') {
      const unicode = readUnicodeName(reader.sub(length));
      if (unicode.trim()) name = unicode;
    } else if (key === 'lsct') {
      sectionType = reader.u32();
    }
    reader.offset = start + length + (length % 2);
  }
  reader.offset = extraEnd;

  return {
    name: name.trim() || 'Layer',
    top,
    left,
    bottom,
    right,
    channels,
    opacity: opacity / 255,
    blend: PSD_TO_BLEND[blendKey.trim()] ?? 'source-over',
    // Le bit 1 est documenté « visible » mais Photoshop l'écrit à 1 pour un
    // calque *masqué* : c'est un écart connu du format, tous les lecteurs
    // (psd-tools, libpsd, GIMP) l'interprètent comme « caché ».
    visible: (flags & 0x02) === 0,
    locked: (flags & 0x01) !== 0,
    clipping,
    maskRect,
    hasMaskData,
    maskFlags,
    sectionType,
  };
}

/** Convertit un pixel CMJN en RVB (formule d'écran, sans profil). */
function cmykToRgb(c: number, m: number, y: number, k: number): [number, number, number] {
  const ink = 1 - k / 255;
  return [
    Math.round((1 - c / 255) * ink * 255),
    Math.round((1 - m / 255) * ink * 255),
    Math.round((1 - y / 255) * ink * 255),
  ];
}

interface MaskArea {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/**
 * Vérifie qu'un canal RLE tombe juste pour une taille donnée.
 *
 * C'est le seul moyen fiable de retrouver la taille d'un masque dont Photoshop
 * a laissé le rectangle à zéro : la table des lignes doit totaliser exactement
 * la longueur du canal. Les canaux ZIP ou bruts ne sont pas mesurables ici et
 * restent acceptés (on fait alors confiance au rectangle).
 */
function rleSizeMatches(data: Uint8Array, width: number, height: number): boolean {
  if (width <= 0 || height <= 0 || data.length < 2) return false;
  try {
    const reader = new Reader(data);
    if (reader.u16() !== 1) return true;
    if (data.length < 2 + height * 2) return false;
    let total = 2 + height * 2;
    for (let row = 0; row < height; row += 1) total += reader.u16();
    // Photoshop laisse parfois un octet de remplissage en fin de canal.
    return total === data.length || total === data.length - 1;
  } catch {
    return false;
  }
}

/**
 * Choisit le rectangle du masque parmi les hypothèses possibles : rectangle
 * déclaré, puis calque, puis document. Le premier qui tombe juste gagne.
 */
function chooseMaskArea(data: Uint8Array, candidates: MaskArea[]): MaskArea | null {
  const usable = candidates.filter(
    (area, index) =>
      area.right > area.left &&
      area.bottom > area.top &&
      candidates.findIndex(
        (other) =>
          other.top === area.top &&
          other.left === area.left &&
          other.bottom === area.bottom &&
          other.right === area.right,
      ) === index,
  );
  if (usable.length === 0) return null;
  const match = usable.find((area) => rleSizeMatches(data, area.right - area.left, area.bottom - area.top));
  return match ?? usable[0] ?? null;
}

/**
 * Lit un PSD et renvoie un document SuperPhoto : un calque par calque de pixels,
 * groupes dépliés, masques et modes de fusion conservés.
 */
export async function parsePsd(blob: Blob): Promise<PhotoDoc> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const reader = new Reader(bytes);

  if (reader.u32() !== SIGNATURE) throw new Error(t('psd.notPsd'));
  const version = reader.u16();
  if (version !== 1 && version !== 2) throw new Error(t('psd.unsupportedVersion', { n: version }));
  reader.skip(6);

  const channelCount = reader.u16();
  const height = reader.u32();
  const width = reader.u32();
  const depth = reader.u16();
  const colorModeCode = reader.u16();

  if (width <= 0 || height <= 0 || width > 30000 || height > 30000) {
    throw new Error(t('psd.badSize'));
  }
  if (depth !== 8 && depth !== 16) throw new Error(t('psd.unsupportedDepth', { n: depth }));

  const colorMode: ColorMode =
    colorModeCode === PSD_COLOR_MODE.cmyk ? 'cmyk' : colorModeCode === PSD_COLOR_MODE.gray ? 'gray' : 'rgb';
  const isCmyk = colorModeCode === PSD_COLOR_MODE.cmyk;
  const isGray = colorModeCode === PSD_COLOR_MODE.gray;
  if (!isCmyk && !isGray && colorModeCode !== PSD_COLOR_MODE.rgb) {
    throw new Error(t('psd.unsupportedColorMode', { n: colorModeCode }));
  }

  // Données de mode couleur, puis ressources d'image : la seule ressource qui
  // nous intéresse est la résolution (0x03ED), le reste est ignoré.
  const colorDataLength = reader.u32();
  reader.skip(colorDataLength);
  const resourceLength = reader.u32();
  const resourceEnd = Math.min(bytes.length, reader.offset + resourceLength);
  let dpi = 72;
  while (reader.offset + 12 <= resourceEnd) {
    if (reader.ascii(4) !== '8BIM') break;
    const id = reader.u16();
    // Nom Pascal : sa longueur totale (octet de longueur inclus) est paire.
    const nameLength = reader.u8();
    reader.skip(nameLength + ((nameLength + 1) % 2));
    const size = reader.u32();
    const blockStart = reader.offset;
    if (id === 0x03ed && size >= 16) {
      const horizontal = readFixed(reader);
      reader.u16(); // unité de résolution : 1 = pouce, 2 = centimètre
      reader.u16(); // unité d'affichage de la largeur
      readFixed(reader); // résolution verticale
      reader.u16();
      reader.u16();
      if (horizontal >= 1 && horizontal <= 1200) dpi = Math.round(horizontal);
    }
    reader.offset = Math.min(resourceEnd, blockStart + size + (size % 2));
  }
  reader.offset = resourceEnd;

  const layers: Layer[] = [];
  let skipped = 0;
  const layerMaskLength = reader.u32();
  const layerMaskEnd = reader.offset + layerMaskLength;
  if (reader.offset + 4 <= layerMaskEnd) {
    const layerInfoLength = reader.u32();
    const layerInfoEnd = reader.offset + layerInfoLength;
    const count = Math.abs(reader.i16());
    const records: PsdLayerRecord[] = [];
    for (let index = 0; index < count; index += 1) {
      if (reader.offset >= layerInfoEnd) break;
      records.push(parseLayerRecord(reader));
    }

    // Données de canaux : pour chaque calque, chaque canal dans l'ordre.
    for (const record of records) {
      const layerWidth = Math.max(0, record.right - record.left);
      const layerHeight = Math.max(0, record.bottom - record.top);
      const chunks: Array<{ id: number; data: Uint8Array }> = [];
      for (const channel of record.channels) {
        const start = reader.offset;
        const end = Math.min(bytes.length, start + channel.length);
        chunks.push({ id: channel.id, data: bytes.subarray(start, end) });
        reader.offset = end;
      }

      // Un groupe ou un séparateur de section n'a pas de pixels : on le saute.
      if (record.sectionType === 1 || record.sectionType === 2 || record.sectionType === 3) continue;
      // Un calque sans pixels n'a d'intérêt que s'il porte un masque. Sinon
      // c'est un objet dynamique ou un calque vide : on le signale à l'arrivée.
      if ((layerWidth === 0 || layerHeight === 0) && !record.hasMaskData) {
        skipped += 1;
        continue;
      }

      const byId = new Map(chunks.map((chunk) => [chunk.id, chunk.data]));
      const canvas = createCanvas(width, height);
      if (layerWidth > 0 && layerHeight > 0) {
        const ctx = canvasContext(canvas);
        const plane = (id: number): Promise<Uint8Array> => {
          const data = byId.get(id);
          if (!data) return Promise.resolve(new Uint8Array(layerWidth * layerHeight).fill(255));
          return readChannel(data, layerWidth, layerHeight, depth);
        };

        const readPlanes = async (): Promise<Uint8Array> => {
          const result = new Uint8Array(width * height * 4);
          if (isGray) {
            const g = await plane(0);
            for (let y = 0; y < layerHeight; y += 1) {
              for (let x = 0; x < layerWidth; x += 1) {
                const value = g[y * layerWidth + x] ?? 0;
                const index = ((record.top + y) * width + (record.left + x)) * 4;
                result[index] = value;
                result[index + 1] = value;
                result[index + 2] = value;
                result[index + 3] = 255;
              }
            }
          } else if (isCmyk) {
            const [c, m, y1, k] = await Promise.all([plane(0), plane(1), plane(2), plane(3)]);
            for (let row = 0; row < layerHeight; row += 1) {
              for (let x = 0; x < layerWidth; x += 1) {
                const source = row * layerWidth + x;
                const [r, g, b] = cmykToRgb(c[source] ?? 0, m[source] ?? 0, y1[source] ?? 0, k[source] ?? 0);
                const index = ((record.top + row) * width + (record.left + x)) * 4;
                result[index] = r;
                result[index + 1] = g;
                result[index + 2] = b;
                result[index + 3] = 255;
              }
            }
          } else {
            const [r, g, b] = await Promise.all([plane(0), plane(1), plane(2)]);
            const alpha = byId.has(-1) ? await plane(-1) : null;
            for (let row = 0; row < layerHeight; row += 1) {
              for (let x = 0; x < layerWidth; x += 1) {
                const source = row * layerWidth + x;
                const index = ((record.top + row) * width + (record.left + x)) * 4;
                result[index] = r[source] ?? 0;
                result[index + 1] = g[source] ?? 0;
                result[index + 2] = b[source] ?? 0;
                result[index + 3] = alpha ? (alpha[source] ?? 255) : 255;
              }
            }
          }
          return result;
        };

        const pixels = await readPlanes();
        const stride = width * 4;
        // On colle la région du calque directement dans son canvas.
        const temp = createCanvas(layerWidth, layerHeight);
        const tempCtx = canvasContext(temp);
        const image = new ImageData(layerWidth, layerHeight);
        for (let row = 0; row < layerHeight; row += 1) {
          image.data.set(pixels.subarray(row * stride, row * stride + layerWidth * 4), row * layerWidth * 4);
        }
        tempCtx.putImageData(image, 0, 0);
        ctx.drawImage(temp, record.left, record.top);
      }

      const layer: Layer = {
        id: `psd-${layers.length}-${Math.random().toString(36).slice(2, 7)}`,
        name: record.name,
        kind: 'raster',
        visible: record.visible,
        opacity: record.opacity,
        blend: record.blend,
        locked: record.locked,
        canvas,
        clipToBelow: record.clipping || undefined,
      };

      // Masque de fusion : Photoshop écrit le masque utilisateur en -2 et sa
      // version « réelle » en -3 quand un masque vectoriel existe aussi. Le
      // rectangle peut être vide (0,0,0,0) — le masque couvre alors tout le
      // calque — il ne faut donc pas le perdre.
      const maskData = byId.get(-3) ?? byId.get(-2);
      if (maskData && record.hasMaskData) {
        const candidates: MaskArea[] = [];
        if (record.maskRect) candidates.push(record.maskRect);
        if (layerWidth > 0 && layerHeight > 0) {
          candidates.push({ top: record.top, left: record.left, bottom: record.bottom, right: record.right });
        }
        candidates.push({ top: 0, left: 0, bottom: height, right: width });
        const area = chooseMaskArea(maskData, candidates);
        const maskWidth = area ? area.right - area.left : 0;
        const maskHeight = area ? area.bottom - area.top : 0;
        if (area && maskWidth > 0 && maskHeight > 0) {
          try {
            const gray = await readChannel(maskData, maskWidth, maskHeight, depth);
            const inverted = (record.maskFlags & 0x04) !== 0;
            const mask = createCanvas(width, height);
            const maskCtx = canvasContext(mask);
            const image2 = new ImageData(maskWidth, maskHeight);
            for (let index = 0; index < maskWidth * maskHeight; index += 1) {
              const value = gray[index] ?? 255;
              image2.data[index * 4] = 255;
              image2.data[index * 4 + 1] = 255;
              image2.data[index * 4 + 2] = 255;
              image2.data[index * 4 + 3] = inverted ? 255 - value : value;
            }
            const tempMask = createCanvas(maskWidth, maskHeight);
            canvasContext(tempMask).putImageData(image2, 0, 0);
            maskCtx.drawImage(tempMask, area.left, area.top);
            layer.mask = mask;
            // Bit 1 des drapeaux : masque désactivé dans Photoshop.
            layer.maskEnabled = (record.maskFlags & 0x02) === 0;
          } catch {
            // Masque illisible : on garde au moins les pixels du calque.
          }
        }
      }

      layers.push(layer);
    }
  }
  reader.offset = Math.min(bytes.length, layerMaskEnd);

  // Aucun calque exploitable : on retombe sur l'image fusionnée, qui est
  // toujours présente en fin de fichier.
  if (layers.length === 0) {
    const composite = await readComposite(bytes, reader.offset, width, height, channelCount, depth, isCmyk, isGray);
    if (!composite) throw new Error(t('psd.noLayers'));
    layers.push({
      id: 'psd-composite',
      name: t('psd.mergedLayer'),
      kind: 'raster',
      visible: true,
      opacity: 1,
      blend: 'source-over',
      canvas: composite,
    });
  }

  if (layers.length === 0) throw new Error(t('psd.noLayers'));
  const warnings: string[] = [];
  if (skipped > 0) warnings.push(t('msg.psdSkipped', { n: skipped }));
  // Un calque écrêté sans calque de base en dessous n'a rien à découper :
  // Photoshop le laisse tel quel. On le signale au lieu de le rendre invisible.
  let orphans = 0;
  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index];
    if (!layer?.clipToBelow) continue;
    let base = index - 1;
    while (base >= 0 && layers[base]?.clipToBelow) base -= 1;
    if (base < 0) {
      layer.clipToBelow = undefined;
      orphans += 1;
    }
  }
  if (orphans > 0) warnings.push(t('msg.psdClipOrphan', { n: orphans }));
  // Le PSD empile du bas vers le haut ; c'est déjà l'ordre de `doc.layers`.
  return {
    name: 'Photoshop',
    width,
    height,
    dpi,
    background: 'transparent',
    colorMode,
    layers,
    activeLayerId: layers[layers.length - 1]?.id ?? '',
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/** Nombre à virgule fixe 16.16, tel que PSD stocke les résolutions. */
function readFixed(reader: Reader): number {
  return reader.u32() / 65536;
}

/** Image fusionnée, en fin de fichier (elle sert de secours). */
async function readComposite(
  bytes: Uint8Array,
  offset: number,
  width: number,
  height: number,
  channels: number,
  depth: number,
  isCmyk: boolean,
  isGray: boolean,
): Promise<HTMLCanvasElement | null> {
  try {
    const reader = new Reader(bytes, offset);
    const compression = reader.u16();
    const planes: Uint8Array[] = [];
    const rowBytes = width * (depth === 16 ? 2 : 1);
    const total = rowBytes * height;

    if (compression === 0) {
      for (let index = 0; index < channels; index += 1) {
        const start = reader.offset;
        const data = bytes.subarray(start, start + total);
        reader.offset = start + total;
        planes.push(depth === 16 ? narrow16(data, width * height) : data);
      }
    } else if (compression === 1) {
      const counts: number[][] = [];
      for (let index = 0; index < channels; index += 1) {
        const rows: number[] = [];
        for (let row = 0; row < height; row += 1) rows.push(reader.u16());
        counts.push(rows);
      }
      let cursor = reader.offset;
      for (let index = 0; index < channels; index += 1) {
        const raw = new Uint8Array(rowBytes * height);
        for (let row = 0; row < height; row += 1) {
          const count = counts[index]?.[row] ?? 0;
          decodeRow(bytes, cursor, cursor + count, rowBytes, depth, false, raw, row * rowBytes);
          cursor += count;
        }
        planes.push(depth === 16 ? narrow16(raw, width * height) : raw);
      }
    } else {
      return null;
    }

    const canvas = createCanvas(width, height);
    const ctx = canvasContext(canvas);
    const image = new ImageData(width, height);
    for (let index = 0; index < width * height; index += 1) {
      if (isGray) {
        const value = planes[0]?.[index] ?? 0;
        image.data[index * 4] = value;
        image.data[index * 4 + 1] = value;
        image.data[index * 4 + 2] = value;
        image.data[index * 4 + 3] = 255;
      } else if (isCmyk) {
        const [r, g, b] = cmykToRgb(
          planes[0]?.[index] ?? 0,
          planes[1]?.[index] ?? 0,
          planes[2]?.[index] ?? 0,
          planes[3]?.[index] ?? 0,
        );
        image.data[index * 4] = r;
        image.data[index * 4 + 1] = g;
        image.data[index * 4 + 2] = b;
        image.data[index * 4 + 3] = 255;
      } else {
        image.data[index * 4] = planes[0]?.[index] ?? 0;
        image.data[index * 4 + 1] = planes[1]?.[index] ?? 0;
        image.data[index * 4 + 2] = planes[2]?.[index] ?? 0;
        image.data[index * 4 + 3] = planes[3]?.[index] ?? 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  } catch {
    return null;
  }
}

function narrow16(data: Uint8Array, pixels: number): Uint8Array {
  const narrow = new Uint8Array(pixels);
  for (let index = 0; index < pixels; index += 1) narrow[index] = data[index * 2] ?? 0;
  return narrow;
}

/** Vrai si les premiers octets ressemblent à un PSD. */
export function looksLikePsd(head: Uint8Array): boolean {
  return (
    head.length >= 4 &&
    head[0] === 0x38 &&
    head[1] === 0x42 &&
    head[2] === 0x50 &&
    head[3] === 0x53
  );
}

export function isPsdName(name: string): boolean {
  return /\.ps[db]$/i.test(name);
}

// ───────────────────────────────────────────────────────────────────────────
// Écriture
// ───────────────────────────────────────────────────────────────────────────

/** Une ligne compressée en RLE, précédée de sa longueur. */
function rleRows(plane: Uint8Array, width: number, height: number): { table: number[]; data: Uint8Array } {
  const table: number[] = [];
  const parts: Uint8Array[] = [];
  for (let row = 0; row < height; row += 1) {
    const packed = packBits(plane.subarray(row * width, row * width + width));
    table.push(packed.length);
    parts.push(packed);
  }
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const data = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    data.set(part, offset);
    offset += part.length;
  }
  return { table, data };
}

function imageDataOf(canvas: HTMLCanvasElement): ImageData {
  const ctx = canvasContext(canvas);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Écrit un PSD : calques RVB 8 bits, RLE, masques, puis l'image fusionnée.
 * `composite` est fourni par l'appelant pour éviter de recalculer la composition.
 */
export async function serializePsd(doc: PhotoDoc, composite: HTMLCanvasElement): Promise<Blob> {
  const width = doc.width;
  const height = doc.height;
  const writer = new ByteWriter(Math.max(4096, width * height));

  // ── En-tête ──────────────────────────────────────────────────────────────
  writer.ascii('8BPS').u16(1);
  writer.bytes(new Uint8Array(6)); // réservé
  writer.u16(4); // RVB + alpha
  writer.u32(height).u32(width);
  writer.u16(8); // 8 bits par canal
  writer.u16(PSD_COLOR_MODE.rgb);

  // ── Mode couleur (vide) et ressources (résolution) ───────────────────────
  writer.u32(0);
  const resources: ByteWriter = new ByteWriter(256);
  const dpi = Math.max(1, Math.round(doc.dpi));
  resources.ascii('8BIM').u16(0x03ed).u16(0).u32(16);
  resources.fixed16(dpi).u16(1).u16(1).fixed16(dpi).u16(1).u16(1);
  writer.u32(resources.size).bytes(resources.toUint8Array());

  // ── Calques et masques ───────────────────────────────────────────────────
  const layerWriter = new ByteWriter(1024);
  const prepared = doc.layers.map((layer) => {
    const image = imageDataOf(layer.canvas);
    const planes = planarChannels(image);
    const maskPlanes = layer.mask ? planarChannels(imageDataOf(layer.mask)) : null;
    return { layer, planes, maskPlanes };
  });

  const records: ByteWriter = new ByteWriter(4096);
  records.i16(prepared.length);

  for (const entry of prepared) {
    const { layer, planes, maskPlanes } = entry;
    const hasMask = Boolean(maskPlanes);
    const channelCount = hasMask ? 5 : 4;
    records.i32(0).i32(0).i32(height).i32(width);
    records.u16(channelCount);

    // Longueur de chaque canal : compression RLE = 2 + table(2 × lignes) + données.
    const channelPlanes = [planes.r, planes.g, planes.b, planes.a];
    const encoded = channelPlanes.map((plane) => rleRows(plane, width, height));
    const maskEncoded = maskPlanes ? rleRows(maskPlanes.a, width, height) : null;
    const lengths = encoded.map((item) => 2 + item.table.length * 2 + item.data.length);
    if (maskEncoded) lengths.push(2 + maskEncoded.table.length * 2 + maskEncoded.data.length);

    const ids = [0, 1, 2, -1];
    if (hasMask) ids.push(-2);
    for (let index = 0; index < ids.length; index += 1) {
      records.i16(ids[index]!).u32(lengths[index]!);
    }

    records.ascii('8BIM').ascii((BLEND_TO_PSD[layer.blend] ?? 'norm').padEnd(4, ' ').slice(0, 4));
    records.u8(Math.round(Math.min(1, Math.max(0, layer.opacity)) * 255));
    records.u8(layer.clipToBelow ? 1 : 0); // masque d'écretage
    // bit 0 = pixel protégé (verrou), bit 1 = masqué (voir le lecteur),
    // bit 3 = « Photoshop 5.0 et ultérieur », toujours écrit par Photoshop.
    records.u8((layer.visible ? 0 : 0x02) | (layer.locked ? 0x01 : 0) | 0x08);
    records.u8(0);

    // Données supplémentaires : masque, plages de fusion, nom, nom Unicode.
    const extra: ByteWriter = new ByteWriter(256);
    if (maskPlanes) {
      // Drapeaux du masque : bit 1 = désactivé (le masque reste stocké).
      const maskFlags = layer.maskEnabled === false ? 0x02 : 0;
      extra.u32(20).i32(0).i32(0).i32(height).i32(width).u8(0).u8(maskFlags).u16(0);
    } else {
      extra.u32(0);
    }
    extra.u32(0); // plages de fusion
    const name = layer.name.slice(0, 255);
    extra.u8(name.length).ascii(name);
    extra.pad(4);
    // Bloc 'luni' : nom Unicode, pour que Photoshop affiche les accents.
    const unicode: ByteWriter = new ByteWriter(64);
    unicode.u32(name.length);
    for (const character of name) unicode.u16(character.charCodeAt(0));
    const unicodeBytes = unicode.toUint8Array();
    extra.ascii('8BIM').ascii('luni').u32(unicodeBytes.length).bytes(unicodeBytes);
    if (unicodeBytes.length % 2 === 1) extra.u8(0);

    records.u32(extra.size).bytes(extra.toUint8Array());
  }

  // Données de canaux, dans le même ordre que les enregistrements.
  for (const entry of prepared) {
    const planes = [entry.planes.r, entry.planes.g, entry.planes.b, entry.planes.a];
    for (const plane of planes) {
      const { table, data } = rleRows(plane, width, height);
      layerWriter.u16(1);
      for (const count of table) layerWriter.u16(count);
      layerWriter.bytes(data);
    }
    if (entry.maskPlanes) {
      const { table, data } = rleRows(entry.maskPlanes.a, width, height);
      layerWriter.u16(1);
      for (const count of table) layerWriter.u16(count);
      layerWriter.bytes(data);
    }
  }

  const layerInfo: ByteWriter = new ByteWriter(records.size + layerWriter.size + 16);
  layerInfo.bytes(records.toUint8Array());
  layerInfo.bytes(layerWriter.toUint8Array());
  if (layerInfo.size % 2 === 1) layerInfo.u8(0);

  const layerAndMask: ByteWriter = new ByteWriter(layerInfo.size + 32);
  layerAndMask.u32(layerInfo.size).bytes(layerInfo.toUint8Array());
  layerAndMask.u32(0); // masque de fusion global
  writer.u32(layerAndMask.size).bytes(layerAndMask.toUint8Array());

  // ── Image fusionnée ──────────────────────────────────────────────────────
  // Le bloc final a *une seule* marque de compression, suivie de la table des
  // longueurs de **toutes** les lignes de **tous** les canaux (R × V × canaux),
  // puis des données. Répéter `u16(1)` devant chaque canal — comme pour les
  // canaux d'un calque — rend le fichier illisible pour Photoshop comme pour
  // psd-tools : ils lisent une table de 320 entrées là où on n'en écrit que 80.
  const flat = planarChannels(imageDataOf(composite));
  const merged = [flat.r, flat.g, flat.b, flat.a].map((plane) => rleRows(plane, width, height));
  writer.u16(1); // RLE
  for (const channel of merged) {
    for (const count of channel.table) writer.u16(count);
  }
  for (const channel of merged) writer.bytes(channel.data);

  return writer.toBlob(PSD_MIME);
}
