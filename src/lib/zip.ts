/**
 * ZIP minimal, sans dépendance.
 *
 * Sert au format de projet `.spp` : plusieurs images et un JSON dans un seul
 * fichier, que l'on peut renommer en `.zip` et ouvrir avec n'importe quel outil
 * système. L'écriture utilise la méthode « store » (aucune compression) : les
 * calques sont déjà du PNG et le JSON est petit, donc recompresser ne gagne rien
 * et évite de dépendre de `CompressionStream`, absent de certaines webviews.
 *
 * La lecture accepte en revanche `store` **et** `deflate`, pour rester compatible
 * avec un paquet re-zippé par l'utilisateur (Explorer, Finder, 7-Zip…).
 */

export interface ZipEntry {
  /** Chemin dans l'archive, séparateur `/`. */
  name: string;
  data: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    crc = (CRC_TABLE[(crc ^ (data[index] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Date et heure au format MS-DOS, figées pour que deux sauvegardes identiques
 *  produisent le même octet-à-octet (utile pour vérifier une empreinte). */
function dosDateTime(date: Date): { time: number; date: number } {
  const time =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    ((Math.floor(date.getSeconds() / 2)) & 0x1f);
  const day =
    (((date.getFullYear() - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);
  return { time, date: day };
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

/** Construit une archive ZIP (méthode store) à partir des entrées fournies. */
export function createZip(entries: ZipEntry[], when = new Date()): Blob {
  const { time, date } = dosDateTime(when);
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = new Uint8Array(30 + nameBytes.length + size);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, SIG_LOCAL, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true); // noms en UTF-8
    localView.setUint16(8, 0, true); // store
    localView.setUint16(10, time, true);
    localView.setUint16(12, date, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, size, true);
    localView.setUint32(22, size, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    local.set(entry.data, 30 + nameBytes.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, SIG_CENTRAL, true);
    centralView.setUint16(4, 20, true); // version made by
    centralView.setUint16(6, 20, true); // version needed
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, time, true);
    centralView.setUint16(14, date, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, size, true);
    centralView.setUint32(24, size, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((total, part) => total + part.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, SIG_EOCD, true);
  eocdView.setUint16(4, 0, true);
  eocdView.setUint16(6, 0, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, offset, true);
  eocdView.setUint16(20, 0, true);

  const total = offset + centralSize + eocd.length;
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    output.set(part, cursor);
    cursor += part.length;
  }
  return new Blob([output.buffer as ArrayBuffer], { type: 'application/zip' });
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const Stream = (globalThis as { DecompressionStream?: typeof DecompressionStream })
    .DecompressionStream;
  if (!Stream) throw new Error('Ce navigateur ne sait pas décompresser un ZIP.');
  // Copie : les données peuvent être une vue sur un tampon plus grand, et
  // `Blob` refuse les `Uint8Array<ArrayBufferLike>` non détachés.
  const copy = new Uint8Array(data.length);
  copy.set(data);
  const stream = new Blob([copy.buffer as ArrayBuffer]).stream().pipeThrough(new Stream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Lit une archive ZIP et renvoie son contenu indexé par nom de fichier. */
export async function readZip(blob: Blob): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // L'enregistrement de fin peut être suivi d'un commentaire : on remonte.
  let eocd = -1;
  const limit = Math.max(0, bytes.length - 0xffff - 22);
  for (let index = bytes.length - 22; index >= limit; index -= 1) {
    if (view.getUint32(index, true) === SIG_EOCD) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new Error('Ce fichier n’est pas une archive ZIP lisible.');

  const count = view.getUint16(eocd + 10, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const files = new Map<string, Uint8Array>();
  let cursor = directoryOffset;

  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== SIG_CENTRAL) break;
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));

    if (localOffset + 30 <= bytes.length && view.getUint32(localOffset, true) === SIG_LOCAL) {
      // Les longueurs du répertoire central peuvent différer de l'en-tête local :
      // seul l'en-tête local donne la vraie position des données.
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const raw = bytes.subarray(start, start + compressedSize);
      if (!name.endsWith('/')) {
        files.set(name, method === 8 ? await inflateRaw(raw) : new Uint8Array(raw));
      }
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  if (files.size === 0) throw new Error('Cette archive est vide.');
  return files;
}

/** Texte d'une entrée, ou `null` si elle n'existe pas. */
export function readText(files: Map<string, Uint8Array>, name: string): string | null {
  const data = files.get(name);
  return data ? new TextDecoder().decode(data) : null;
}
