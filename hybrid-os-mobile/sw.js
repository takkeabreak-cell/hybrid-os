// Hybrid OS service worker
//
// Strategy
//  - Your own files (html/css/js/icons): NETWORK-FIRST. When you are online you always get the
//    latest deployed version; if the network fails or takes > 3s, the cached copy is used, so the
//    app still opens instantly offline (gym basement, no signal).
//  - If the server answers with an ERROR (404 because the site was taken down, 5xx, ...) the saved copy
//    is used instead, so an installed app keeps opening even after the hosting is removed.
//
// The old version was cache-first, which would have kept showing your OLD app after every edit.
// Bump CACHE_NAME only if you want to force-clear old caches; normal edits do not need it.

const CACHE_NAME = 'hybrid-os-v3';
const NETWORK_TIMEOUT_MS = 3000;

const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/icon.svg',
  './fonts/fonts.css',
  './fonts/plus-jakarta-sans-latin-wght-normal.woff2',
  './fonts/plus-jakarta-sans-latin-ext-wght-normal.woff2',
  './fonts/jetbrains-mono-latin-wght-normal.woff2',
  './fonts/jetbrains-mono-latin-ext-wght-normal.woff2'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // cache:'reload' skips the browser HTTP cache so we never precache a stale copy
      Promise.all(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' }))))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

function isCacheable(res) {
  return res && (res.ok || res.type === 'opaque');
}

async function fromCache(request) {
  const hit = await caches.match(request, { ignoreSearch: true });
  if (hit) return hit;
  if (request.mode === 'navigate') return caches.match('./index.html');
  return undefined;
}

function networkFirst(request) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (res) => {
      if (!settled) {
        settled = true;
        resolve(res || Response.error());
      }
    };

    // Slow network: fall back to cache, but let the fetch keep going to refresh the cache
    const timer = setTimeout(async () => {
      const hit = await fromCache(request);
      if (hit) done(hit);
    }, NETWORK_TIMEOUT_MS);

    // cache:'no-cache' = always revalidate with the server (GitHub Pages sends max-age=600,
    // which would otherwise let the phone show a 10-minute-old file after you redeploy)
    fetch(request.url, { cache: 'no-cache' })
      .then(async (res) => {
        clearTimeout(timer);
        if (isCacheable(res)) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, copy));
          done(res);
          return;
        }
        // The server answered, but with an error page: prefer our saved copy of the app
        done((await fromCache(request)) || res);
      })
      .catch(async () => {
        clearTimeout(timer);
        done(await fromCache(request));
      });
  });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  }
  // anything else (there should be nothing): let the browser handle it normally
});
