const RELEASE = '89';
const SHELL = 'cm-shell-v' + RELEASE;
const DATA = 'cm-data-v1';
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.jsx', './js/app-loader.js', './js/sw-register.js', './js/akatsuki-client.js',
  './js/akatsuki-location.js', './js/cost-adapter.js', './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-maskable-192.png', './icons/icon-maskable-512.png', './icons/icon.svg',
  './icons/icon-maskable.svg', './icons/favicon-32.png', './icons/apple-touch-icon.png'
];
const releaseScripts = new Set(['js/app.jsx', 'js/app-loader.js', 'js/sw-register.js']
  .map(path => new URL(path, self.registration.scope).href));
const externalAsset = url => /(^|\.)(jsdelivr\.net|unpkg\.com|gstatic\.com|googleapis\.com)$/.test(url.hostname);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    // Bypass the HTTP cache when seeding the new shell, including on a warm installation.
    await shell.addAll(ASSETS.map(path => new Request(new URL(path, self.registration.scope), { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    const shellNumber = name => Number(name.slice('cm-shell-v'.length));
    const oldShells = (await caches.keys())
      .filter(name => /^cm-shell-v\d+$/.test(name) && shellNumber(name) < Number(RELEASE))
      .sort((a, b) => shellNumber(b) - shellNumber(a));
    for (const name of oldShells) {
      const old = await caches.open(name);
      // Keep downloaded CDN dependencies available offline when changing app versions.
      for (const req of await old.keys()) {
        if (externalAsset(new URL(req.url)) && !await shell.match(req)) {
          const hit = await old.match(req);
          if (hit) await shell.put(req, hit);
        }
      }
      await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname.endsWith('supabase.co') && url.pathname.startsWith('/rest/')) {
    event.respondWith((async () => {
      const cache = await caches.open(DATA);
      try {
        const res = await fetch(req);
        if (res.ok) await cache.put(req, res.clone()).catch(() => {});
        return res;
      } catch (error) {
        const saved = await cache.match(req);
        if (saved) return saved;
        throw error;
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const shell = await caches.open(SHELL);
    const clean = url.origin + url.pathname;
    const key = releaseScripts.has(clean) && url.search === '?v=' + RELEASE ? clean : req;
    const cached = await shell.match(key);
    if (cached) return cached;
    // An update link or OAuth callback loads the installed shell with its original URL intact.
    if (req.mode === 'navigate' && (clean === self.registration.scope || clean === new URL('index.html', self.registration.scope).href)) {
      const entry = await shell.match(new URL('index.html', self.registration.scope).href);
      if (entry) return entry;
    }
    const res = await fetch(req);
    if (res.ok && (url.origin === self.location.origin || externalAsset(url))) {
      await shell.put(req, res.clone()).catch(() => {});
    }
    return res;
  })());
});
