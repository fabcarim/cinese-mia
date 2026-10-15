/* Service worker: l'app funziona offline.
   - Guscio (html, js, css, dati): pronto subito, dalla rete quando c'è, dalla cache offline.
   - Audio e tratti: scaricati dalla pagina in 'cinese-media-v1' (vedi syncMedia in app.js). */
const SHELL = 'cinese-shell-v4';
const MEDIA = 'cinese-media-v1';
const SHELL_FILES = [
  './', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest',
  'vendor/hanzi-writer.min.js',
  'data/words.json', 'data/content.json', 'data/media_index.json',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== MEDIA).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const url = new URL(req.url);
  const isMedia = /\/(audio|strokes)\//.test(url.pathname);

  if (isMedia) {
    // Cache prima: i file hanno ?v=hash, quindi non cambiano mai sotto lo stesso indirizzo.
    e.respondWith(caches.open(MEDIA).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }

  // Guscio: prima la rete (così gli aggiornamenti arrivano subito), la cache se offline
  // o se la rete non risponde entro 3 secondi.
  e.respondWith(caches.open(SHELL).then(async c => {
    const key = req.mode === 'navigate' ? 'index.html' : req;
    const net = fetch(req, { cache: 'no-cache' }).then(res => {
      if (res.ok) c.put(key, res.clone());
      return res;
    }).catch(() => null);
    const timeout = new Promise(r => setTimeout(() => r(null), 3000));
    const res = await Promise.race([net, timeout]);
    if (res) return res;
    const hit = await c.match(key, { ignoreSearch: req.mode === 'navigate' });
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || new Response('Offline', { status: 503 });
  }));
});
