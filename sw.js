/**
 * Offline support.
 *
 * Precache the whole app, then cache-first. The asset list is explicit because
 * there is no bundler to generate it: if you add a module, add it here and bump
 * VERSION, or clients will keep the old copy. scripts/check-modules.mjs fails
 * the build if a module is missing from this list, so it cannot rot silently.
 *
 * VERSION must be bumped whenever any cached asset changes, stylesheets
 * included. A stale stylesheet is indistinguishable from a bug.
 */

const VERSION = 'v9';
const CACHE = `witness-${VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './404.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './styles/base.css',
  './styles/print.css',
  './app/main.js',
  './app/dom.js',
  './app/forms.js',
  './app/ui.js',
  './app/editor.js',
  './app/room.js',
  './app/room-view.js',
  './app/terms.js',
  './app/search.js',
  './app/hash.js',
  './app/cite.js',
  './app/lint.js',
  './app/parity.js',
  './app/debate.js',
  './app/export.js',
  './app/store.js',
  './data/terms.json',
];

const absolute = (path) => new URL(path, self.location).toString();

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS.map(absolute));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        const cache = await caches.open(CACHE);
        return (await cache.match(absolute('./index.html'))) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    } catch {
      return new Response('Offline, and this file is not cached.', { status: 503, statusText: 'Offline' });
    }
  })());
});
