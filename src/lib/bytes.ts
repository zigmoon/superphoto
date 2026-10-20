/**
 * Petits utilitaires binaires partagés par les formats d'image écrits à la main
 * (PSD, TIFF, EPS).
 *
 * Les canvas ne savent produire que du PNG, du JPEG et du WebP. Pour le TIFF,
 * l'EPS et le PSD, on assemble donc les octets soi-même : ce module fournit le
 * strict nécessaire — écriture big/little-endian, empilement de morceaux et
 * compression PackBits (RLE) utilisée par Photoshop.
 */

/** Écrit dans un tampon de taille croissante, sans allocation par écriture. */
export class ByteWriter {
  private buffer: ArrayBuffer;
  private view: DataView;
  private length = 0;

  constructor(initial = 1024) {
    this.buffer = new ArrayBuffer(initial);
    this.view = new DataView(this.buffer);
  }

  private ensure(extra: number): void {
    if (this.length + extra <= this.buffer.byteLength) return;
    let size = this.buffer.byteLength * 2;
    while (size < this.length + extra) size *= 2;
    const next = new ArrayBuffer(size);
    new Uint8Array(next).set(new Uint8Array(this.buffer, 0, this.length));
    this.buffer = next;
    this.view = new DataView(next);
  }

  get size(): number {
    return this.length;
  }

  u8(value: number): this {
    this.ensure(1);
    this.view.setUint8(this.length, value & 0xff);
    this.length += 1;
    return this;
  }

  u16(value: number, little = false): this {
    this.ensure(2);
    this.view.setUint16(this.length, value & 0xffff, little);
    this.length += 2;
    return this;
  }

  i16(value: number, little = false): this {
    this.ensure(2);
    this.view.setInt16(this.length, value, little);
    this.length += 2;
    return this;
  }

  u32(value: number, little = false): this {
    this.ensure(4);
    this.view.setUint32(this.length, value >>> 0, little);
    this.length += 4;
    return this;
  }

  i32(value: number, little = false): this {
    this.ensure(4);
    this.view.setInt32(this.length, value, little);
    this.length += 4;
    return this;
  }

  /** Nombre à virgule fixe 16.16 (résolutions PSD/TIFF). */
  fixed16(value: number): this {
    return this.u32(Math.round(value * 65536) >>> 0);
  }

  bytes(data: Uint8Array): this {
    this.ensure(data.length);
    new Uint8Array(this.buffer).set(data, this.length);
    this.length += data.length;
    return this;
  }

  ascii(text: string): this {
    const data = new Uint8Array(text.length);
    for (let index = 0; index < text.length; index += 1) data[index] = text.charCodeAt(index) & 0xff;
    return this.bytes(data);
  }

  /** Réserve 4 octets et renvoie leur position, pour un remplissage ultérieur. */
  reserve32(): number {
    const at = this.length;
    this.u32(0);
    return at;
  }

  patch32(at: number, value: number): void {
    this.view.setUint32(at, value >>> 0);
  }

  /** Remplit le tampon à un multiple de 2 ou 4 (blocs PSD). */
  pad(multiple: number): this {
    while (this.length % multiple !== 0) this.u8(0);
    return this;
  }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.buffer).slice(0, this.length);
  }

  toBlob(type: string): Blob {
    const copy = new Uint8Array(this.length);
    copy.set(new Uint8Array(this.buffer, 0, this.length));
    return new Blob([copy.buffer as ArrayBuffer], { type });
  }
}

/**
 * PackBits (compression RLE d'Adobe), sur une ligne.
 * Renvoie les octets dupliqués et les littéraux selon la spécification :
 * `n` (0..127) = n+1 octets littéraux, `-n` (1..127) = 1 octet répété n+1 fois,
 * `-128` = ignoré.
 */
export function packBits(row: Uint8Array): Uint8Array {
  const out: number[] = [];
  const length = row.length;
  let index = 0;
  while (index < length) {
    // Repère une série d'au moins trois octets identiques.
    let run = 1;
    const lead = row[index] ?? 0;
    while (index + run < length && row[index + run] === lead && run < 128) run += 1;
    if (run >= 3) {
      out.push(257 - run, lead);
      index += run;
      continue;
    }
    // Sinon, accumule des littéraux jusqu'à la prochaine série.
    let literal = 0;
    while (index + literal < length && literal < 128) {
      const next = index + literal;
      const value = row[next] ?? 0;
      let repeat = 1;
      while (next + repeat < length && row[next + repeat] === value && repeat < 3) repeat += 1;
      if (repeat >= 3) break;
      literal += 1;
    }
    if (literal === 0) literal = 1;
    out.push(literal - 1);
    for (let offset = 0; offset < literal; offset += 1) out.push(row[index + offset] ?? 0);
    index += literal;
  }
  return Uint8Array.from(out);
}

/** Décompresse une ligne PackBits en écrivant dans `target` à `offset`. */
export function unpackBits(
  data: Uint8Array,
  start: number,
  end: number,
  target: Uint8Array,
  offset: number,
): number {
  let source = start;
  let written = offset;
  while (source < end) {
    const header = (data[source] ?? 0) << 24 >> 24; // signé
    source += 1;
    if (header >= 0) {
      const count = header + 1;
      for (let index = 0; index < count && source < end; index += 1) {
        target[written + index] = data[source + index] ?? 0;
      }
      source += count;
      written += count;
    } else if (header !== -128) {
      const count = 1 - header;
      const value = data[source] ?? 0;
      source += 1;
      for (let index = 0; index < count; index += 1) target[written + index] = value;
      written += count;
    }
  }
  return written;
}

/** Décompresse un flux zlib (PSD compression 2 et 3). */
export async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const Ctor = (globalThis as { DecompressionStream?: typeof DecompressionStream })
    .DecompressionStream;
  if (!Ctor) throw new Error('Ce navigateur ne sait pas décompresser un flux zlib.');
  const copy = new Uint8Array(data.length);
  copy.set(data);
  const stream = new Blob([copy.buffer as ArrayBuffer]).stream().pipeThrough(new Ctor('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Octets d'un canvas, canal par canal (plan séparé, sans alpha). */
export function planarChannels(image: ImageData): {
  r: Uint8Array;
  g: Uint8Array;
  b: Uint8Array;
  a: Uint8Array;
} {
  const size = image.width * image.height;
  const r = new Uint8Array(size);
  const g = new Uint8Array(size);
  const b = new Uint8Array(size);
  const a = new Uint8Array(size);
  const data = image.data;
  for (let index = 0; index < size; index += 1) {
    r[index] = data[index * 4] ?? 0;
    g[index] = data[index * 4 + 1] ?? 0;
    b[index] = data[index * 4 + 2] ?? 0;
    a[index] = data[index * 4 + 3] ?? 0;
  }
  return { r, g, b, a };
}

/** Recompose un `ImageData` à partir de plans séparés. */
export function fromPlanar(
  width: number,
  height: number,
  r: Uint8Array,
  g: Uint8Array,
  b: Uint8Array,
  a?: Uint8Array,
): ImageData {
  const image = new ImageData(width, height);
  const data = image.data;
  const size = width * height;
  for (let index = 0; index < size; index += 1) {
    data[index * 4] = r[index] ?? 0;
    data[index * 4 + 1] = g[index] ?? 0;
    data[index * 4 + 2] = b[index] ?? 0;
    data[index * 4 + 3] = a ? (a[index] ?? 0) : 255;
  }
  return image;
}
