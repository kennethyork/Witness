#!/usr/bin/env node
/**
 * A local static server for development and for anyone who wants to run
 * Colophon from a folder without GitHub Pages.
 *
 * Browsers refuse to load ES modules and fetch() over file://, so "just open
 * index.html" does not work for a bundled app. This is the smallest thing that
 * removes that obstacle: no dependencies, node's own http module.
 *
 * It must survive malformed requests. A dev server that dies on `GET //` and
 * leaves the developer staring at connection refused is worse than no server.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = path.join(root, '_site');
const port = Number(process.env.PORT || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

try {
  await stat(siteDir);
} catch {
  console.error('_site/ is missing. Run: npm run build');
  process.exit(1);
}

/** Resolve a request path to a file inside _site/, or null if it escapes. */
function resolveRequestPath(requestUrl) {
  const rawPath = (requestUrl || '/').split('?')[0].split('#')[0];
  let decoded = rawPath;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    // Malformed percent-encoding: fall through and serve the 404.
    return null;
  }

  const resolved = path.resolve(siteDir, `.${decoded}`);
  const relative = path.relative(siteDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

async function send(response, status, body, type = 'text/plain; charset=utf-8') {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  response.end(body);
}

const server = createServer(async (request, response) => {
  try {
    let filePath = resolveRequestPath(request.url);
    if (!filePath) {
      await send(response, 400, 'Bad request path.');
      return;
    }

    let found = true;
    try {
      const info = await stat(filePath);
      if (info.isDirectory()) filePath = path.join(filePath, 'index.html');
    } catch {
      found = false;
    }

    if (found) {
      const body = await readFile(filePath);
      response.writeHead(200, {
        'content-type': TYPES[path.extname(filePath)] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      response.end(body);
      return;
    }

    const notFound = await readFile(path.join(siteDir, '404.html')).catch(() => null);
    if (notFound) {
      response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      response.end(notFound);
    } else {
      await send(response, 404, 'Not found');
    }
  } catch (error) {
    // Never let one bad request take the process down.
    if (!response.headersSent) {
      await send(response, 500, `Server error: ${error.message}`).catch(() => {});
    } else {
      response.end();
    }
  }
});

server.on('clientError', (error, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.listen(port, () => {
  console.log(`Colophon (from _site/) on http://localhost:${port}`);
  console.log('Service worker, clipboard, and offline caching work on localhost; they do not on file://.');
});
