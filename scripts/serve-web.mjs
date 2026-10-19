#!/usr/bin/env node
/**
 * Petit serveur pour tester la version web exactement comme après un envoi FTP :
 * le contenu de `dist/` est monté dans un sous-dossier (`/app/` par défaut), donc
 * les liens relatifs sont réellement éprouvés.
 *
 *   npm run preview:web
 *   node scripts/serve-web.mjs --prefix=/superphoto/ --port=8500
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

const argv = process.argv.slice(2);
const readArg = (name, fallback) => {
  const found = argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};

const port = Number(readArg('port', '8400'));
let prefix = readArg('prefix', '/app/');
if (!prefix.startsWith('/')) prefix = `/${prefix}`;
if (!prefix.endsWith('/')) prefix += '/';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  if (!url.pathname.startsWith(prefix)) {
    res.writeHead(302, { Location: prefix });
    res.end();
    return;
  }

  let relative = decodeURIComponent(url.pathname.slice(prefix.length));
  if (relative === '' || relative.endsWith('/')) relative += 'index.html';

  const target = path.join(dist, relative);
  if (!target.startsWith(dist)) {
    res.writeHead(403).end('Interdit');
    return;
  }

  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error('pas un fichier');
    res.writeHead(200, {
      'Content-Type': types[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-store',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(target).pipe(res);
  } catch {
    // Repli SPA : tout ce qui n'existe pas renvoie index.html.
    const html = await readFile(path.join(dist, 'index.html')).catch(() => null);
    if (!html) {
      res.writeHead(404).end('dist/index.html introuvable — lancez npm run build:web');
      return;
    }
    res.writeHead(404, { 'Content-Type': types['.html'] });
    res.end(html);
  }
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Version web : http://127.0.0.1:${port}${prefix}\n`);
});
