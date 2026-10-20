/**
 * BMP — écriture 24 bits(BGR, lignes du bas vers le haut).
 *
 * BMP n'est pas un format de production, mais il reste le seul que certains
 * utilitaires Windows et pas mal de traceurs acceptent sans conversion. Le
 * fichier est trivial : un en-tête de 14 octets, un en-tête d'image de 40, puis
 * les pixels. On écrit donc l'encodeur nous-mêmes plutôt que d'ajouter une
 * dépendance.
 */
import { ByteWriter } from './bytes';
import { canvasContext, createCanvas } from './utils';

const FILE_HEADER = 14;
const INFO_HEADER = 40;

/**
 * Chaque ligne BMP est alignée sur 4 octets. Sans ce remplissage, l'image
 * s'affiche en escalier sur les largeurs non multiples de 4.
 */
export function bmpFromCanvas(source: HTMLCanvasElement, background = '#ffffff'): Blob {
  const width = source.width;
  const height = source.height;
  // BMP 24 bits n'a pas d'alpha : on aplatit d'abord sur le fond demandé.
  const flat = createCanvas(width, height);
  const ctx = canvasContext(flat);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0);
  const data = ctx.getImageData(0, 0, width, height).data;

  const rowBytes = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowBytes * height;
  const fileSize = FILE_HEADER + INFO_HEADER + pixelBytes;
  const writer = new ByteWriter(fileSize);

  writer.u8(0x42).u8(0x4d); // « BM »
  writer.u32(fileSize, true);
  writer.u16(0, true).u16(0, true);
  writer.u32(FILE_HEADER + INFO_HEADER, true);

  writer.u32(INFO_HEADER, true);
  writer.i32(width, true);
  writer.i32(height, true);
  writer.u16(1, true); // plans
  writer.u16(24, true); // bits par pixel
  writer.u32(0, true); // BI_RGB, non compressé
  writer.u32(pixelBytes, true);
  writer.i32(2835, true); // 72 dpi en pixels/mètre
  writer.i32(2835, true);
  writer.u32(0, true);
  writer.u32(0, true);

  const row = new Uint8Array(rowBytes);
  for (let y = height - 1; y >= 0; y -= 1) {
    row.fill(0);
    for (let x = 0; x < width; x += 1) {
      const source4 = (y * width + x) * 4;
      const target = x * 3;
      row[target] = data[source4 + 2] ?? 0;
      row[target + 1] = data[source4 + 1] ?? 0;
      row[target + 2] = data[source4] ?? 0;
    }
    for (let index = 0; index < rowBytes; index += 1) writer.u8(row[index] ?? 0);
  }

  return writer.toBlob('image/bmp');
}
